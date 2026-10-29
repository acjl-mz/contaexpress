import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const { Client } = pg;

test("PostgreSQL report queries reconcile posted balances and respect date boundaries", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is required for PostgreSQL integration tests");
    return;
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const org = (await client.query(
      "INSERT INTO organisations (legal_name, display_name) VALUES ($1, $2) RETURNING id",
      ["ContaExpress Report Integration Test", "ContaExpress Report IT"],
    )).rows[0].id;
    const user = (await client.query(
      "INSERT INTO app_users (email, full_name, status) VALUES ($1, $2, 'active') RETURNING id",
      [`ci-report-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, "CI Report Test"],
    )).rows[0].id;
    await client.query(
      "INSERT INTO organisation_memberships (organisation_id, user_id, role) VALUES ($1, $2, 'accountant')",
      [org, user],
    );
    const entity = (await client.query(
      "INSERT INTO accounting_entities (organisation_id, legal_name) VALUES ($1, $2) RETURNING id",
      [org, "ContaExpress Report IT Entity"],
    )).rows[0].id;
    const fiscalYear = (await client.query(
      "INSERT INTO fiscal_years (accounting_entity_id, label, starts_on, ends_on) VALUES ($1, $2, '2026-01-01', '2026-12-31') RETURNING id",
      [entity, "FY-2026-REPORT-IT"],
    )).rows[0].id;
    const period = (await client.query(
      "INSERT INTO accounting_periods (accounting_entity_id, fiscal_year_id, label, starts_on, ends_on) VALUES ($1, $2, $3, '2026-01-01', '2026-12-31') RETURNING id",
      [entity, fiscalYear, "2026-REPORT-IT"],
    )).rows[0].id;
    const journal = (await client.query(
      "INSERT INTO accounting_journals (accounting_entity_id, code, name) VALUES ($1, 'RPT', 'Report Integration Journal') RETURNING id",
      [entity],
    )).rows[0].id;

    const accounts = {};
    for (const [code, name, type] of [
      ["R-101", "Banco de teste", "asset"],
      ["R-201", "Fornecedores", "liability"],
      ["R-501", "Capital", "equity"],
      ["R-701", "Rendimentos", "income"],
      ["R-601", "Gastos", "expense"],
    ]) {
      accounts[type] = (await client.query(
        "INSERT INTO chart_of_accounts (accounting_entity_id, code, name, account_type) VALUES ($1, $2, $3, $4) RETURNING id",
        [entity, code, name, type],
      )).rows[0].id;
    }

    async function addEntry(date, description, lines, post = true) {
      const entry = (await client.query(
        "INSERT INTO journal_entries (accounting_entity_id, period_id, journal_id, entry_date, description, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
        [entity, period, journal, date, description, user],
      )).rows[0].id;
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        await client.query(
          "INSERT INTO journal_entry_lines (accounting_entity_id, entry_id, line_number, account_id, debit, credit) VALUES ($1, $2, $3, $4, $5, $6)",
          [entity, entry, i + 1, accounts[line.type], line.debit, line.credit],
        );
      }
      if (post) await client.query("SELECT * FROM post_journal_entry($1, $2)", [entry, user]);
      return entry;
    }

    await addEntry("2026-10-01", "Capital inicial", [
      { type: "asset", debit: 1000, credit: 0 },
      { type: "equity", debit: 0, credit: 1000 },
    ]);
    await addEntry("2026-10-02", "Compra a crédito", [
      { type: "expense", debit: 200, credit: 0 },
      { type: "liability", debit: 0, credit: 200 },
    ]);
    await addEntry("2026-10-03", "Venda recebida", [
      { type: "asset", debit: 500, credit: 0 },
      { type: "income", debit: 0, credit: 500 },
    ]);
    await addEntry("2026-10-02", "Rascunho não contabilizado", [
      { type: "expense", debit: 999, credit: 0 },
      { type: "liability", debit: 0, credit: 999 },
    ], false);

    const trial = await client.query(
      `SELECT a.account_type AS "accountType",
              COALESCE(SUM(l.debit), 0)::numeric(20,2) AS debit,
              COALESCE(SUM(l.credit), 0)::numeric(20,2) AS credit
       FROM chart_of_accounts a
       LEFT JOIN journal_entries e ON e.accounting_entity_id = a.accounting_entity_id
         AND e.status IN ('posted', 'reversed')
         AND ($2::date IS NULL OR e.entry_date >= $2::date)
         AND ($3::date IS NULL OR e.entry_date <= $3::date)
       LEFT JOIN journal_entry_lines l ON l.entry_id = e.id AND l.accounting_entity_id = e.accounting_entity_id
         AND l.account_id = a.id
       WHERE a.accounting_entity_id = $1
       GROUP BY a.id, a.account_type ORDER BY a.account_type`,
      [entity, "2026-10-01", "2026-10-31"],
    );
    const trialDebit = trial.rows.reduce((sum, row) => sum + Number(row.debit), 0);
    const trialCredit = trial.rows.reduce((sum, row) => sum + Number(row.credit), 0);
    assert.equal(trialDebit, 1700);
    assert.equal(trialCredit, 1700);

    const income = await client.query(
      `SELECT a.account_type AS "accountType",
              COALESCE(SUM(l.debit), 0)::numeric(20,2) AS debit,
              COALESCE(SUM(l.credit), 0)::numeric(20,2) AS credit
       FROM chart_of_accounts a
       LEFT JOIN journal_entries e ON e.accounting_entity_id = a.accounting_entity_id
         AND e.status IN ('posted', 'reversed')
         AND ($2::date IS NULL OR e.entry_date >= $2::date)
         AND ($3::date IS NULL OR e.entry_date <= $3::date)
       LEFT JOIN journal_entry_lines l ON l.entry_id = e.id AND l.accounting_entity_id = e.accounting_entity_id
         AND l.account_id = a.id
       WHERE a.accounting_entity_id = $1 AND a.account_type IN ('income', 'expense')
       GROUP BY a.id, a.account_type ORDER BY a.account_type`,
      [entity, "2026-10-01", "2026-10-31"],
    );
    const incomeTotal = income.rows.filter(row => row.accountType === "income")
      .reduce((sum, row) => sum + Number(row.credit) - Number(row.debit), 0);
    const expenseTotal = income.rows.filter(row => row.accountType === "expense")
      .reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0);
    assert.equal(incomeTotal, 500);
    assert.equal(expenseTotal, 200);
    assert.equal(incomeTotal - expenseTotal, 300);

    const balance = await client.query(
      `SELECT a.account_type AS "accountType",
              COALESCE(SUM(l.debit), 0)::numeric(20,2) AS debit,
              COALESCE(SUM(l.credit), 0)::numeric(20,2) AS credit
       FROM chart_of_accounts a
       LEFT JOIN journal_entries e ON e.accounting_entity_id = a.accounting_entity_id
         AND e.status IN ('posted', 'reversed') AND e.entry_date <= $2::date
       LEFT JOIN journal_entry_lines l ON l.entry_id = e.id AND l.accounting_entity_id = e.accounting_entity_id
         AND l.account_id = a.id
       WHERE a.accounting_entity_id = $1 AND a.account_type IN ('asset', 'liability', 'equity')
       GROUP BY a.id, a.account_type ORDER BY a.account_type`,
      [entity, "2026-10-31"],
    );
    const sumType = (type, fn) => balance.rows.filter(row => row.accountType === type)
      .reduce((sum, row) => sum + fn(Number(row.debit), Number(row.credit)), 0);
    const assets = sumType("asset", (debit, credit) => debit - credit);
    const liabilities = sumType("liability", (debit, credit) => credit - debit);
    const equity = sumType("equity", (debit, credit) => credit - debit);
    assert.equal(assets, 1500);
    assert.equal(liabilities, 200);
    assert.equal(equity, 1000);
    assert.equal(assets - liabilities - equity - (incomeTotal - expenseTotal), 0);

    const beforePeriod = await client.query(
      `SELECT COALESCE(SUM(l.debit - l.credit), 0)::numeric(20,2) AS balance
       FROM journal_entry_lines l
       JOIN journal_entries e ON e.id = l.entry_id AND e.accounting_entity_id = l.accounting_entity_id
       WHERE l.accounting_entity_id = $1 AND l.account_id = $2
         AND e.status IN ('posted', 'reversed') AND e.entry_date < $3::date`,
      [entity, accounts.asset, "2026-10-02"],
    );
    assert.equal(Number(beforePeriod.rows[0].balance), 1000);

    const boundedIncome = await client.query(
      `SELECT COALESCE(SUM(l.credit - l.debit), 0)::numeric(20,2) AS total
       FROM journal_entry_lines l
       JOIN journal_entries e ON e.id = l.entry_id AND e.accounting_entity_id = l.accounting_entity_id
       JOIN chart_of_accounts a ON a.id = l.account_id AND a.accounting_entity_id = l.accounting_entity_id
       WHERE l.accounting_entity_id = $1 AND a.account_type = 'income'
         AND e.status IN ('posted', 'reversed') AND e.entry_date >= $2::date AND e.entry_date <= $3::date`,
      [entity, "2026-10-03", "2026-10-03"],
    );
    assert.equal(Number(boundedIncome.rows[0].total), 500);
  } finally {
    try { await client.query("ROLLBACK"); } finally { await client.end(); }
  }
});
