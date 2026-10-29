import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";
import bcrypt from "bcryptjs";

const { Client } = pg;
const { hash } = bcrypt;

const host = "127.0.0.1";
const port = Number(process.env.HTTP_TEST_PORT || 3100);
const baseUrl = `http://${host}:${port}`;
const required = ["DATABASE_URL", "SESSION_SECRET", "ADMIN_EMAIL", "ADMIN_PASSWORD"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Variável obrigatória para testes HTTP ausente: ${name}`);
}

const server = spawn(process.execPath, [
  "node_modules/next/dist/bin/next",
  "start",
  "--hostname", host,
  "--port", String(port),
], { stdio: ["ignore", "pipe", "pipe"], env: process.env });

let serverOutput = "";
let fixtureClient;
let fixtureIds;
server.stdout.on("data", chunk => { serverOutput += chunk.toString(); });
server.stderr.on("data", chunk => { serverOutput += chunk.toString(); });

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Servidor Next.js terminou antes de ficar pronto.\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/auth/me`, { signal: AbortSignal.timeout(1500) });
      if (response.status === 401 || response.status === 200) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Tempo esgotado ao iniciar Next.js.\n${serverOutput}`);
}

try {
  await waitForServer();

  const missingCredentials = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "", password: "" }),
  });
  assert.equal(missingCredentials.status, 400, "login deve rejeitar credenciais vazias");
  const resetUnknown = await fetch(`${baseUrl}/api/auth/password-reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `unknown-${Date.now()}@example.test` }),
  });
  assert.equal(resetUnknown.status, 200, "pedido de recuperação deve responder sem revelar se o e-mail existe");
  const resetMessage = await resetUnknown.json();
  assert.match(resetMessage.message, /Se existir uma conta/i);
  const invalidReset = await fetch(`${baseUrl}/api/auth/password-reset/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "a".repeat(64), password: "CI-password-test-long-enough-123" }),
  });
  assert.equal(invalidReset.status, 400, "token de recuperação inexistente deve ser rejeitado");

  const invalidCredentials = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: "wrong-password-for-http-test" }),
  });
  assert.equal(invalidCredentials.status, 401, "login deve rejeitar palavra-passe incorrecta");

  const anonymousMe = await fetch(`${baseUrl}/api/auth/me`);
  assert.equal(anonymousMe.status, 401, "endpoint de sessão deve rejeitar utilizador anónimo");

  const anonymousCompanies = await fetch(`${baseUrl}/api/companies`);
  assert.equal(anonymousCompanies.status, 401, "listagem de empresas deve exigir sessão");

  const anonymousPdf = await fetch(`${baseUrl}/api/accounting/reports/pdf?entityId=00000000-0000-0000-0000-000000000000`);
  assert.equal(anonymousPdf.status, 401, "exportação PDF deve exigir sessão");
  const anonymousTreasury = await fetch(`${baseUrl}/api/treasury?entityId=00000000-0000-0000-0000-000000000000`);
  assert.equal(anonymousTreasury.status, 401, "tesouraria deve exigir sessão");
  const anonymousTax = await fetch(`${baseUrl}/api/tax/obligations?entityId=00000000-0000-0000-0000-000000000000`);
  assert.equal(anonymousTax.status, 401, "fiscalidade deve exigir sessão");
  const anonymousMappings = await fetch(baseUrl + "/api/treasury/mappings?entityId=00000000-0000-0000-0000-000000000000");
  assert.equal(anonymousMappings.status, 401, "mapeamentos contabilísticos devem exigir sessão");
  const anonymousPosting = await fetch(baseUrl + "/api/treasury/post", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ entityId: "00000000-0000-0000-0000-000000000000", transactionId: "00000000-0000-0000-0000-000000000000" }),
  });
  assert.equal(anonymousPosting.status, 401, "preparação contabilística deve exigir sessão");
  const anonymousStatements = await fetch(baseUrl + "/api/treasury/statements?entityId=00000000-0000-0000-0000-000000000000");
  assert.equal(anonymousStatements.status, 401, "extractos bancários devem exigir sessão");


  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  });
  assert.equal(login.status, 200, "administrador de CI deve conseguir iniciar sessão");
  const payload = await login.json();
  assert.equal(payload.user?.email, process.env.ADMIN_EMAIL.toLowerCase(), "login deve devolver o utilizador autenticado");
  const setCookie = login.headers.get("set-cookie") || "";
  const sessionCookie = setCookie.split(";")[0];
  assert.match(sessionCookie, /^contaexpress_session=/, "login deve emitir cookie de sessão");

  const authenticatedMe = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { cookie: sessionCookie },
  });
  assert.equal(authenticatedMe.status, 200, "cookie válido deve autenticar o utilizador");
  const sessionPayload = await authenticatedMe.json();
  assert.equal(sessionPayload.user?.email, process.env.ADMIN_EMAIL.toLowerCase());

  fixtureClient = new Client({ connectionString: process.env.DATABASE_URL });
  await fixtureClient.connect();
  const fixtureOrg = (await fixtureClient.query("INSERT INTO organisations (legal_name, display_name) VALUES ($1, $1) RETURNING id", [`HTTP security org ${Date.now()}`])).rows[0].id;
  const auditorEmail = `http-auditor-${Date.now()}@example.test`;
  const auditorPassword = "CI-auditor-test-password";
  const auditorHash = await hash(auditorPassword, 10);
  const auditorId = (await fixtureClient.query("INSERT INTO app_users (email, full_name, password_hash, status) VALUES ($1, $2, $3, 'active') RETURNING id", [auditorEmail, "HTTP Auditor Test", auditorHash])).rows[0].id;
  await fixtureClient.query("INSERT INTO organisation_memberships (organisation_id, user_id, role) VALUES ($1, $2, 'auditor')", [fixtureOrg, auditorId]);
  const auditorEntity = (await fixtureClient.query("INSERT INTO accounting_entities (organisation_id, legal_name) VALUES ($1, $2) RETURNING id", [fixtureOrg, "HTTP Auditor Entity"])).rows[0].id;
  await fixtureClient.query("INSERT INTO entity_memberships (accounting_entity_id, user_id, role) VALUES ($1, $2, 'auditor')", [auditorEntity, auditorId]);
  const fiscalYear = (await fixtureClient.query("INSERT INTO fiscal_years (accounting_entity_id, label, starts_on, ends_on) VALUES ($1, 'HTTP-SECURITY', '2026-01-01', '2026-12-31') RETURNING id", [auditorEntity])).rows[0].id;
  const period = (await fixtureClient.query("INSERT INTO accounting_periods (accounting_entity_id, fiscal_year_id, label, starts_on, ends_on) VALUES ($1, $2, 'HTTP-SECURITY', '2026-01-01', '2026-12-31') RETURNING id", [auditorEntity, fiscalYear])).rows[0].id;
  const journal = (await fixtureClient.query("INSERT INTO accounting_journals (accounting_entity_id, code, name) VALUES ($1, 'HTTP', 'HTTP security journal') RETURNING id", [auditorEntity])).rows[0].id;
  const debitAccount = (await fixtureClient.query("INSERT INTO chart_of_accounts (accounting_entity_id, code, name, account_type) VALUES ($1, 'HTTP-1', 'Banco', 'asset') RETURNING id", [auditorEntity])).rows[0].id;
  const creditAccount = (await fixtureClient.query("INSERT INTO chart_of_accounts (accounting_entity_id, code, name, account_type) VALUES ($1, 'HTTP-2', 'Capital', 'equity') RETURNING id", [auditorEntity])).rows[0].id;
  const entry = (await fixtureClient.query("INSERT INTO journal_entries (accounting_entity_id, period_id, journal_id, entry_date, description, created_by) VALUES ($1, $2, $3, '2026-10-20', 'HTTP permission test', $4) RETURNING id", [auditorEntity, period, journal, auditorId])).rows[0].id;
  await fixtureClient.query("INSERT INTO journal_entry_lines (accounting_entity_id, entry_id, line_number, account_id, debit, credit) VALUES ($1, $2, 1, $3, 100, 0), ($1, $2, 2, $4, 0, 100)", [auditorEntity, entry, debitAccount, creditAccount]);
  fixtureIds = { org: fixtureOrg, user: auditorId, entity: auditorEntity, year: fiscalYear, period, journal, debitAccount, creditAccount, entry };

  const crossTenantReport = await fetch(`${baseUrl}/api/accounting/reports?entityId=${encodeURIComponent(auditorEntity)}&report=trial-balance`, { headers: { cookie: sessionCookie } });
  assert.equal(crossTenantReport.status, 403, "a sessão de outra organização não deve consultar relatórios da entidade");

  const auditorLogin = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: auditorEmail, password: auditorPassword }) });
  assert.equal(auditorLogin.status, 200, "auditor de teste deve conseguir iniciar sessão");
  const auditorCookie = (auditorLogin.headers.get("set-cookie") || "").split(";")[0];
  const auditorPost = await fetch(`${baseUrl}/api/accounting/entries/${encodeURIComponent(entry)}/post?entityId=${encodeURIComponent(auditorEntity)}`, { method: "POST", headers: { cookie: auditorCookie } });
  assert.equal(auditorPost.status, 403, "auditor não deve confirmar lançamentos pela API HTTP");

  const authenticatedCompanies = await fetch(`${baseUrl}/api/companies`, {
    headers: { cookie: sessionCookie },
  });
  assert.equal(authenticatedCompanies.status, 200, "utilizador autenticado deve poder listar as suas empresas");
  const companiesPayload = await authenticatedCompanies.json();
  assert.ok(Array.isArray(companiesPayload.companies), "resposta de empresas deve conter uma lista");

  const createCompany = await fetch(`${baseUrl}/api/companies`, {
    method: "POST", headers: { cookie: sessionCookie, "content-type": "application/json" },
    body: JSON.stringify({ legalName: `HTTP PDF Test ${Date.now()}`, countryCode: "MZ", currency: "MZN" }),
  });
  assert.equal(createCompany.status, 201, "administrador autenticado deve conseguir criar empresa de teste");
  const companyPayload = await createCompany.json();
  const pdfResponse = await fetch(`${baseUrl}/api/accounting/reports/pdf?entityId=${encodeURIComponent(companyPayload.company.id)}&report=trial-balance&from=2026-01-01&to=2026-12-31`, {
    headers: { cookie: sessionCookie },
  });
  assert.equal(pdfResponse.status, 200, "exportação PDF deve funcionar para uma empresa autorizada");
  assert.ok((pdfResponse.headers.get("content-type") || "").includes("application/pdf"), "resposta deve indicar content-type PDF");
  const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
  assert.ok(pdfBytes.subarray(0, 8).toString("ascii").startsWith("%PDF-1."), "download deve conter um documento PDF válido");

  const adminEntity = companyPayload.company.id;
  fixtureIds.adminEntity = adminEntity;

  // End-to-end bank reconciliation: import, match, duplicate protection, mismatch and tenant isolation.
  const bankAccount = (await fixtureClient.query(
    "INSERT INTO treasury_accounts (accounting_entity_id,name,account_type,currency,created_by) VALUES ($1,'HTTP Test Bank','bank','MZN',$2) RETURNING id",
    [adminEntity,payload.user.id],
  )).rows[0].id;
  const matchingTransaction = (await fixtureClient.query(
    "INSERT INTO treasury_transactions (accounting_entity_id,treasury_account_id,transaction_date,direction,category,description,amount,reference,status,created_by) VALUES ($1,$2,'2026-10-20','inflow','customer_receipt','HTTP matching receipt',2500,'BANK-REF-001','recorded',$3) RETURNING id",
    [adminEntity,bankAccount,payload.user.id],
  )).rows[0].id;
  const wrongAmountTransaction = (await fixtureClient.query(
    "INSERT INTO treasury_transactions (accounting_entity_id,treasury_account_id,transaction_date,direction,category,description,amount,reference,status,created_by) VALUES ($1,$2,'2026-10-20','outflow','fee','HTTP bank fee',75,'FEE-REF-001','recorded',$3) RETURNING id",
    [adminEntity,bankAccount,payload.user.id],
  )).rows[0].id;

  const crossTenantStatements = await fetch(baseUrl + "/api/treasury/statements?entityId=" + encodeURIComponent(fixtureIds.entity), { headers: { cookie: sessionCookie } });
  assert.equal(crossTenantStatements.status, 403, "extractos de outra entidade não devem ser consultáveis");
  const crossTenantImport = await fetch(baseUrl + "/api/treasury/statements", {
    method:"POST",headers:{cookie:sessionCookie,"content-type":"application/json"},
    body:JSON.stringify({action:"import",entityId:fixtureIds.entity,accountId:bankAccount,fileName:"cross-tenant.csv",rows:[{date:"2026-10-20",description:"Tentativa",amount:1,direction:"inflow"}]}),
  });
  assert.equal(crossTenantImport.status,403,"a importação não deve permitir usar uma conta de outra entidade");

  const invalidStatementDate = await fetch(baseUrl + "/api/treasury/statements", {
    method:"POST",headers:{cookie:sessionCookie,"content-type":"application/json"},
    body:JSON.stringify({action:"import",entityId:adminEntity,accountId:bankAccount,fileName:"invalid-date.csv",rows:[{date:"2026-02-31",description:"Data impossível",amount:10,direction:"inflow"}]}),
  });
  assert.equal(invalidStatementDate.status,400,"datas impossíveis devem ser rejeitadas como erro de validação");

  const statementImport = await fetch(baseUrl + "/api/treasury/statements", {
    method:"POST",headers:{cookie:sessionCookie,"content-type":"application/json"},
    body:JSON.stringify({action:"import",entityId:adminEntity,accountId:bankAccount,fileName:"http-statement.csv",rows:[
      {date:"2026-10-20",description:"Recebimento de cliente",amount:2500,direction:"inflow",reference:"BANK-REF-001"},
      {date:"2026-10-20",description:"Comissão bancária",amount:70,direction:"outflow",reference:"FEE-REF-001"},
    ]}),
  });
  assert.equal(statementImport.status,201,"extracto válido deve ser importado");
  const statementImportPayload=await statementImport.json();
  const statementRows=await fixtureClient.query("SELECT id,line_number,amount FROM bank_statement_lines WHERE accounting_entity_id=$1 AND import_id=$2 ORDER BY line_number",[adminEntity,statementImportPayload.importId]);
  assert.equal(statementRows.rowCount,2,"a importação deve persistir todas as linhas");
  assert.deepEqual(statementRows.rows.map(r=>r.line_number),[1,2],"as linhas do extracto devem manter a sua ordem");
  const matchedLine=statementRows.rows[0].id;
  const mismatchLine=statementRows.rows[1].id;

  const amountMismatch=await fetch(baseUrl + "/api/treasury/statements",{
    method:"POST",headers:{cookie:sessionCookie,"content-type":"application/json"},
    body:JSON.stringify({action:"match",entityId:adminEntity,lineId:mismatchLine,transactionId:wrongAmountTransaction}),
  });
  assert.equal(amountMismatch.status,422,"a reconciliação deve rejeitar diferenças de valor não justificadas");
  const firstMatch=await fetch(baseUrl + "/api/treasury/statements",{
    method:"POST",headers:{cookie:sessionCookie,"content-type":"application/json"},
    body:JSON.stringify({action:"match",entityId:adminEntity,lineId:matchedLine,transactionId:matchingTransaction}),
  });
  assert.equal(firstMatch.status,200,"a correspondência exacta deve ser confirmada");
  const repeatedLineMatch=await fetch(baseUrl + "/api/treasury/statements",{
    method:"POST",headers:{cookie:sessionCookie,"content-type":"application/json"},
    body:JSON.stringify({action:"match",entityId:adminEntity,lineId:matchedLine,transactionId:matchingTransaction}),
  });
  assert.equal(repeatedLineMatch.status,409,"uma linha já reconciliada não deve ser reconciliada novamente");
  const transactionStatus=await fixtureClient.query("SELECT status FROM treasury_transactions WHERE accounting_entity_id=$1 AND id=$2",[adminEntity,matchingTransaction]);
  assert.equal(transactionStatus.rows[0].status,"reconciled","o movimento associado deve ficar reconciliado");
  const statementStatus=await fixtureClient.query("SELECT status,treasury_transaction_id FROM bank_statement_lines WHERE accounting_entity_id=$1 AND id=$2",[adminEntity,matchedLine]);
  assert.equal(statementStatus.rows[0].status,"matched","a linha do extracto deve ficar marcada como correspondida");
  assert.equal(statementStatus.rows[0].treasury_transaction_id,matchingTransaction,"a correspondência deve manter a referência do movimento");

  // Treasury -> ledger integration: authorised preparation, balanced draft, and authorised posting.
  const treasuryYear = (await fixtureClient.query(
    "INSERT INTO fiscal_years (accounting_entity_id,label,starts_on,ends_on) VALUES ($1,'HTTP-TREASURY','2026-01-01','2026-12-31') RETURNING id",
    [adminEntity],
  )).rows[0].id;
  const treasuryPeriod = (await fixtureClient.query(
    "INSERT INTO accounting_periods (accounting_entity_id,fiscal_year_id,label,starts_on,ends_on) VALUES ($1,$2,'HTTP-TREASURY','2026-01-01','2026-12-31') RETURNING id",
    [adminEntity,treasuryYear],
  )).rows[0].id;
  await fixtureClient.query(
    "INSERT INTO accounting_journals (accounting_entity_id,code,name) VALUES ($1,'GER','Diário Geral') ON CONFLICT (accounting_entity_id,code) DO NOTHING",
    [adminEntity],
  );
  const treasuryLedger = (await fixtureClient.query(
    "INSERT INTO chart_of_accounts (accounting_entity_id,code,name,account_type) VALUES ($1,'HTTPTR-1','Banco - integração','asset') RETURNING id",
    [adminEntity],
  )).rows[0].id;
  const treasuryCounterpart = (await fixtureClient.query(
    "INSERT INTO chart_of_accounts (accounting_entity_id,code,name,account_type) VALUES ($1,'HTTPTR-2','Receita - integração','income') RETURNING id",
    [adminEntity],
  )).rows[0].id;
  await fixtureClient.query(
    "INSERT INTO treasury_posting_mappings (accounting_entity_id,treasury_account_id,direction,category,ledger_account_id,counterpart_account_id,created_by) VALUES ($1,$2,'inflow','customer_receipt',$3,$4,$5)",
    [adminEntity,bankAccount,treasuryLedger,treasuryCounterpart,payload.user.id],
  );
  const postingTransaction = (await fixtureClient.query(
    "INSERT INTO treasury_transactions (accounting_entity_id,treasury_account_id,transaction_date,direction,category,description,amount,reference,status,created_by) VALUES ($1,$2,'2026-10-21','inflow','customer_receipt','Recebimento para integração contabilística',1200,'TREASURY-POST-001','recorded',$3) RETURNING id",
    [adminEntity,bankAccount,payload.user.id],
  )).rows[0].id;

  const anonymousPrepare = await fetch(baseUrl + "/api/treasury/post", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ entityId: adminEntity, transactionId: postingTransaction }),
  });
  assert.equal(anonymousPrepare.status, 401, "preparação sem sessão deve ser rejeitada");

  const outsiderPrepare = await fetch(baseUrl + "/api/treasury/post", {
    method: "POST", headers: { cookie: sessionCookie, "content-type": "application/json" },
    body: JSON.stringify({ entityId: fixtureIds.entity, transactionId: postingTransaction }),
  });
  assert.equal(outsiderPrepare.status, 403, "mesmo um superadministrador sem associação à empresa não deve preparar lançamento para ela");

  const prepareEntry = await fetch(baseUrl + "/api/treasury/post", {
    method: "POST", headers: { cookie: sessionCookie, "content-type": "application/json" },
    body: JSON.stringify({ entityId: adminEntity, transactionId: postingTransaction }),
  });
  assert.equal(prepareEntry.status, 201, "utilizador autorizado deve preparar o rascunho contabilístico");
  const preparedPayload = await prepareEntry.json();
  assert.equal(preparedPayload.status, "draft", "a preparação não deve confirmar automaticamente o lançamento");
  const preparedLines = await fixtureClient.query(
    "SELECT debit::numeric AS debit,credit::numeric AS credit,account_id FROM journal_entry_lines WHERE accounting_entity_id=$1 AND entry_id=$2 ORDER BY line_number",
    [adminEntity,preparedPayload.entry.id],
  );
  assert.equal(preparedLines.rowCount, 2, "rascunho deve conter duas linhas");
  assert.equal(Number(preparedLines.rows[0].debit)+Number(preparedLines.rows[1].debit),1200,"débito deve corresponder ao valor do movimento");
  assert.equal(Number(preparedLines.rows[0].credit)+Number(preparedLines.rows[1].credit),1200,"crédito deve corresponder ao valor do movimento");
  assert.equal(preparedLines.rows[0].account_id,treasuryLedger,"entrada deve debitar a conta de tesouraria");
  assert.equal(preparedLines.rows[1].account_id,treasuryCounterpart,"entrada deve creditar a conta de contrapartida");

  const repeatedPrepare = await fetch(baseUrl + "/api/treasury/post", {
    method: "POST", headers: { cookie: sessionCookie, "content-type": "application/json" },
    body: JSON.stringify({ entityId: adminEntity, transactionId: postingTransaction }),
  });
  assert.equal(repeatedPrepare.status, 200, "repetição deve devolver o lançamento existente");
  assert.equal((await repeatedPrepare.json()).alreadyPrepared, true, "repetição não deve criar segundo lançamento");

  const auditorPostTreasuryEntry = await fetch(
    baseUrl + "/api/accounting/entries/" + encodeURIComponent(preparedPayload.entry.id) + "/post?entityId=" + encodeURIComponent(adminEntity),
    { method: "POST", headers: { cookie: auditorCookie } },
  );
  assert.equal(auditorPostTreasuryEntry.status, 403, "auditor não deve confirmar o rascunho criado pela tesouraria");

  const confirmTreasuryEntry = await fetch(
    baseUrl + "/api/accounting/entries/" + encodeURIComponent(preparedPayload.entry.id) + "/post?entityId=" + encodeURIComponent(adminEntity),
    { method: "POST", headers: { cookie: sessionCookie } },
  );
  assert.equal(confirmTreasuryEntry.status, 200, "contabilista autorizado deve confirmar o lançamento preparado");
  const confirmedPayload = await confirmTreasuryEntry.json();
  assert.equal(confirmedPayload.entry.status, "posted", "a API deve devolver o estado confirmado");
  const persistedPosting = await fixtureClient.query(
    "SELECT status,entry_number FROM journal_entries WHERE accounting_entity_id=$1 AND id=$2",
    [adminEntity,preparedPayload.entry.id],
  );
  assert.equal(persistedPosting.rows[0].status, "posted", "a confirmação deve persistir no PostgreSQL");
  assert.ok(persistedPosting.rows[0].entry_number, "o lançamento confirmado deve receber número sequencial");
  const linkedMovement = await fixtureClient.query(
    "SELECT journal_entry_id FROM treasury_transactions WHERE accounting_entity_id=$1 AND id=$2",
    [adminEntity,postingTransaction],
  );
  assert.equal(linkedMovement.rows[0].journal_entry_id,preparedPayload.entry.id, "o movimento de tesouraria deve continuar ligado ao lançamento confirmado");

  const adminYear = (await fixtureClient.query("INSERT INTO fiscal_years (accounting_entity_id, label, starts_on, ends_on) VALUES ($1, 'HTTP-REVERSAL', '2026-01-01', '2026-12-31') RETURNING id", [adminEntity])).rows[0].id;
  const adminPeriod = (await fixtureClient.query("INSERT INTO accounting_periods (accounting_entity_id, fiscal_year_id, label, starts_on, ends_on) VALUES ($1, $2, 'HTTP-REVERSAL', '2026-01-01', '2026-12-31') RETURNING id", [adminEntity, adminYear])).rows[0].id;
  const adminJournal = (await fixtureClient.query("INSERT INTO accounting_journals (accounting_entity_id, code, name) VALUES ($1, 'HTTPREV', 'HTTP reversal test') RETURNING id", [adminEntity])).rows[0].id;
  const adminDebit = (await fixtureClient.query("INSERT INTO chart_of_accounts (accounting_entity_id, code, name, account_type) VALUES ($1, 'HTTPREV-1', 'Banco', 'asset') RETURNING id", [adminEntity])).rows[0].id;
  const adminCredit = (await fixtureClient.query("INSERT INTO chart_of_accounts (accounting_entity_id, code, name, account_type) VALUES ($1, 'HTTPREV-2', 'Capital', 'equity') RETURNING id", [adminEntity])).rows[0].id;
  const originalEntry = (await fixtureClient.query("INSERT INTO journal_entries (accounting_entity_id, period_id, journal_id, entry_date, description, created_by) VALUES ($1, $2, $3, '2026-10-20', 'HTTP concurrent reversal', $4) RETURNING id", [adminEntity, adminPeriod, adminJournal, payload.user.id])).rows[0].id;
  await fixtureClient.query("INSERT INTO journal_entry_lines (accounting_entity_id, entry_id, line_number, account_id, debit, credit) VALUES ($1, $2, 1, $3, 125, 0), ($1, $2, 2, $4, 0, 125)", [adminEntity, originalEntry, adminDebit, adminCredit]);
  const postOriginal = await fetch(`${baseUrl}/api/accounting/entries/${encodeURIComponent(originalEntry)}/post?entityId=${encodeURIComponent(adminEntity)}`, { method: "POST", headers: { cookie: sessionCookie } });
  assert.equal(postOriginal.status, 200, "lançamento de teste deve ser confirmado antes do estorno");
  const reversals = await Promise.all([
    fetch(`${baseUrl}/api/accounting/entries/${encodeURIComponent(originalEntry)}/reverse?entityId=${encodeURIComponent(adminEntity)}`, { method: "POST", headers: { cookie: sessionCookie, "content-type": "application/json" }, body: JSON.stringify({ reversalDate: "2026-10-21" }) }),
    fetch(`${baseUrl}/api/accounting/entries/${encodeURIComponent(originalEntry)}/reverse?entityId=${encodeURIComponent(adminEntity)}`, { method: "POST", headers: { cookie: sessionCookie, "content-type": "application/json" }, body: JSON.stringify({ reversalDate: "2026-10-21" }) }),
  ]);
  const reversalStatuses = reversals.map(response => response.status).sort((a, b) => a - b);
  assert.deepEqual(reversalStatuses, [201, 409], "pedidos simultâneos de estorno devem produzir exactamente um estorno");
  const reversalCount = await fixtureClient.query("SELECT count(*)::int AS count FROM journal_entries WHERE accounting_entity_id = $1 AND reverses_entry_id = $2", [adminEntity, originalEntry]);
  assert.equal(reversalCount.rows[0].count, 1, "a base de dados deve conter apenas um estorno do lançamento original");

  const limitedEmail = `rate-limit-${Date.now()}@example.test`;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.77" },
      body: JSON.stringify({ email: limitedEmail, password: "incorrect-password-for-rate-limit-test" }),
    });
    assert.equal(response.status, 401, `tentativa inválida ${attempt + 1} deve ser recusada antes do limite`);
  }
  const rateLimited = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.77" },
    body: JSON.stringify({ email: limitedEmail, password: "incorrect-password-for-rate-limit-test" }),
  });
  assert.equal(rateLimited.status, 429, "login deve bloquear novas tentativas depois de atingir o limite por e-mail");

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { cookie: sessionCookie },
  });
  assert.equal(logout.status, 200, "logout deve terminar com sucesso");
  assert.match(logout.headers.get("set-cookie") || "", /max-age=0/i, "logout deve instruir o navegador a limpar o cookie de sessão");

  const afterLogout = await fetch(`${baseUrl}/api/auth/me`);
  assert.equal(afterLogout.status, 401, "após logout, a sessão não deve ser reutilizada");

  console.log("HTTP smoke tests: autenticação, sessão, acesso a empresas e logout verificados.");
} finally {
  if (fixtureClient) {
    await fixtureClient.query("SET session_replication_role = replica").catch(() => undefined);
    if (fixtureIds) {
      const f = fixtureIds;
      await fixtureClient.query("DELETE FROM journal_entry_lines WHERE accounting_entity_id = $1", [f.entity]).catch(() => undefined);
      await fixtureClient.query("DELETE FROM journal_entries WHERE accounting_entity_id = $1", [f.entity]).catch(() => undefined);
      await fixtureClient.query("DELETE FROM audit_events WHERE accounting_entity_id = $1", [f.entity]).catch(() => undefined);
      await fixtureClient.query("DELETE FROM chart_of_accounts WHERE accounting_entity_id = $1", [f.entity]).catch(() => undefined);
      await fixtureClient.query("DELETE FROM accounting_journals WHERE accounting_entity_id = $1", [f.entity]).catch(() => undefined);
      await fixtureClient.query("DELETE FROM accounting_periods WHERE accounting_entity_id = $1", [f.entity]).catch(() => undefined);
      await fixtureClient.query("DELETE FROM fiscal_years WHERE accounting_entity_id = $1", [f.entity]).catch(() => undefined);
      await fixtureClient.query("DELETE FROM entity_memberships WHERE accounting_entity_id = $1", [f.entity]).catch(() => undefined);
      await fixtureClient.query("DELETE FROM accounting_entities WHERE id = $1", [f.entity]).catch(() => undefined);
      await fixtureClient.query("DELETE FROM organisation_memberships WHERE organisation_id = $1 AND user_id = $2", [f.org, f.user]).catch(() => undefined);
      await fixtureClient.query("DELETE FROM app_users WHERE id = $1", [f.user]).catch(() => undefined);
      await fixtureClient.query("DELETE FROM organisations WHERE id = $1", [f.org]).catch(() => undefined);
      if (f.adminEntity) {
        await fixtureClient.query("DELETE FROM bank_statement_lines WHERE accounting_entity_id = $1", [f.adminEntity]).catch(() => undefined);
        await fixtureClient.query("DELETE FROM bank_statement_imports WHERE accounting_entity_id = $1", [f.adminEntity]).catch(() => undefined);
        await fixtureClient.query("DELETE FROM treasury_transactions WHERE accounting_entity_id = $1", [f.adminEntity]).catch(() => undefined);
        await fixtureClient.query("DELETE FROM treasury_posting_mappings WHERE accounting_entity_id = $1", [f.adminEntity]).catch(() => undefined);
        await fixtureClient.query("DELETE FROM treasury_accounts WHERE accounting_entity_id = $1", [f.adminEntity]).catch(() => undefined);
      await fixtureClient.query("DELETE FROM journal_entry_lines WHERE accounting_entity_id = $1", [f.adminEntity]).catch(() => undefined);
        await fixtureClient.query("DELETE FROM journal_entries WHERE accounting_entity_id = $1", [f.adminEntity]).catch(() => undefined);
        await fixtureClient.query("DELETE FROM audit_events WHERE accounting_entity_id = $1", [f.adminEntity]).catch(() => undefined);
        await fixtureClient.query("DELETE FROM chart_of_accounts WHERE accounting_entity_id = $1", [f.adminEntity]).catch(() => undefined);
        await fixtureClient.query("DELETE FROM accounting_journals WHERE accounting_entity_id = $1", [f.adminEntity]).catch(() => undefined);
        await fixtureClient.query("DELETE FROM accounting_periods WHERE accounting_entity_id = $1", [f.adminEntity]).catch(() => undefined);
        await fixtureClient.query("DELETE FROM fiscal_years WHERE accounting_entity_id = $1", [f.adminEntity]).catch(() => undefined);
        await fixtureClient.query("DELETE FROM accounting_entities WHERE id = $1", [f.adminEntity]).catch(() => undefined);
      }
    }
    await fixtureClient.query("SET session_replication_role = origin").catch(() => undefined);
    await fixtureClient.end().catch(() => undefined);
  }
  server.kill("SIGTERM");
  await new Promise(resolve => {
    if (server.exitCode !== null || server.signalCode !== null) return resolve();
    const timeout = setTimeout(() => { server.kill("SIGKILL"); resolve(); }, 5000);
    server.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
}
