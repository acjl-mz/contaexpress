import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";
import { hash } from "bcryptjs";

const { Client } = pg;

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
