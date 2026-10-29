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
let taxFixtureIds;
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

  const anonymousInvitations = await fetch(baseUrl + "/api/organisation-invitations");
  assert.equal(anonymousInvitations.status,401,"gestão de convites deve exigir sessão");
  const anonymousInvitationCreate = await fetch(baseUrl + "/api/organisation-invitations",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({email:"invited@example.test",role:"accountant"}),
  });
  assert.equal(anonymousInvitationCreate.status,401,"criação de convites deve exigir sessão");
  const invalidInvitationAccept = await fetch(baseUrl + "/api/organisation-invitations/accept",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({token:"a".repeat(64),fullName:"HTTP Test Invitee",password:"CI-invitation-password-long-2026",confirmPassword:"CI-invitation-password-long-2026"}),
  });
  assert.equal(invalidInvitationAccept.status,400,"aceitação deve rejeitar token inexistente");
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

  // Treasury-to-ledger workflow: reject missing mappings, prepare a balanced draft, and remain idempotent.
  const treasuryYear = (await fixtureClient.query(
    "INSERT INTO fiscal_years (accounting_entity_id,label,starts_on,ends_on) VALUES ($1,$2,'2026-01-01','2026-12-31') RETURNING id",
    [adminEntity,"HTTP-TREASURY-"+Date.now()],
  )).rows[0].id;
  const treasuryPeriod = (await fixtureClient.query(
    "INSERT INTO accounting_periods (accounting_entity_id,fiscal_year_id,label,starts_on,ends_on) VALUES ($1,$2,'2026','2026-01-01','2026-12-31') RETURNING id",
    [adminEntity,treasuryYear],
  )).rows[0].id;
  const generalJournal = (await fixtureClient.query(
    "INSERT INTO accounting_journals (accounting_entity_id,code,name) VALUES ($1,'GER','Diário Geral HTTP') ON CONFLICT (accounting_entity_id,code) DO UPDATE SET is_active=TRUE RETURNING id",
    [adminEntity],
  )).rows[0].id;
  const treasuryLedger = (await fixtureClient.query(
    "INSERT INTO chart_of_accounts (accounting_entity_id,code,name,account_type) VALUES ($1,$2,'Banco — teste tesouraria','asset') RETURNING id",
    [adminEntity,"HTTP-BANK-"+Date.now()],
  )).rows[0].id;
  const counterpartLedger = (await fixtureClient.query(
    "INSERT INTO chart_of_accounts (accounting_entity_id,code,name,account_type) VALUES ($1,$2,'Receitas — teste tesouraria','income') RETURNING id",
    [adminEntity,"HTTP-INCOME-"+Date.now()],
  )).rows[0].id;
  const unmappedMovement = (await fixtureClient.query(
    "INSERT INTO treasury_transactions (accounting_entity_id,treasury_account_id,transaction_date,direction,category,description,amount,status,created_by) VALUES ($1,$2,'2026-10-20','inflow','other','Movimento sem mapeamento',50,'recorded',$3) RETURNING id",
    [adminEntity,bankAccount,payload.user.id],
  )).rows[0].id;
  const missingMapping = await fetch(baseUrl+"/api/treasury/post",{
    method:"POST",headers:{cookie:sessionCookie,"content-type":"application/json"},
    body:JSON.stringify({entityId:adminEntity,transactionId:unmappedMovement}),
  });
  assert.equal(missingMapping.status,409,"a tesouraria deve bloquear a preparação sem mapeamento contabilístico");
  const mappingResponse = await fetch(baseUrl+"/api/treasury/mappings",{
    method:"POST",headers:{cookie:sessionCookie,"content-type":"application/json"},
    body:JSON.stringify({entityId:adminEntity,treasuryAccountId:bankAccount,direction:"inflow",category:"customer_receipt",ledgerAccountId:treasuryLedger,counterpartAccountId:counterpartLedger}),
  });
  assert.equal(mappingResponse.status,201,"contabilista autorizado deve poder configurar o mapeamento da tesouraria");
  const postingMovement = (await fixtureClient.query(
    "INSERT INTO treasury_transactions (accounting_entity_id,treasury_account_id,transaction_date,direction,category,description,amount,reference,status,created_by) VALUES ($1,$2,'2026-10-20','inflow','customer_receipt','Recebimento para lançamento automático',1250,'HTTP-POST-001','recorded',$3) RETURNING id",
    [adminEntity,bankAccount,payload.user.id],
  )).rows[0].id;
  const prepared = await fetch(baseUrl+"/api/treasury/post",{
    method:"POST",headers:{cookie:sessionCookie,"content-type":"application/json"},
    body:JSON.stringify({entityId:adminEntity,transactionId:postingMovement}),
  });
  const preparedPayload = await prepared.json();
  assert.equal(prepared.status,201,"movimento mapeado deve gerar rascunho contabilístico");
  assert.equal(preparedPayload.status,"draft","o lançamento gerado deve permanecer em rascunho para revisão");
  const generatedLines = await fixtureClient.query(
    "SELECT line_number,debit,credit,account_id FROM journal_entry_lines WHERE accounting_entity_id=$1 AND entry_id=$2 ORDER BY line_number",
    [adminEntity,preparedPayload.entry.id],
  );
  assert.equal(generatedLines.rowCount,2,"o lançamento gerado deve conter duas linhas");
  assert.equal(Number(generatedLines.rows[0].debit),1250,"a linha de débito deve reflectir o movimento");
  assert.equal(Number(generatedLines.rows[1].credit),1250,"a linha de crédito deve reflectir o movimento");
  assert.equal(generatedLines.rows[0].account_id,treasuryLedger,"o débito de uma entrada deve ir para a conta de tesouraria");
  assert.equal(generatedLines.rows[1].account_id,counterpartLedger,"o crédito deve ir para a conta de contrapartida");
  const repeatedPreparation = await fetch(baseUrl+"/api/treasury/post",{
    method:"POST",headers:{cookie:sessionCookie,"content-type":"application/json"},
    body:JSON.stringify({entityId:adminEntity,transactionId:postingMovement}),
  });
  assert.equal(repeatedPreparation.status,200,"repetir o pedido não deve criar outro lançamento");
  assert.equal((await repeatedPreparation.json()).alreadyPrepared,true,"a API deve sinalizar o lançamento já preparado");
  const linkedMovement = await fixtureClient.query(
    "SELECT journal_entry_id FROM treasury_transactions WHERE accounting_entity_id=$1 AND id=$2",
    [adminEntity,postingMovement],
  );
  assert.equal(linkedMovement.rows[0].journal_entry_id,preparedPayload.entry.id,"o movimento deve manter o vínculo ao rascunho");
  const postingAudit = await fixtureClient.query(
    "SELECT id FROM audit_events WHERE accounting_entity_id=$1 AND event_type='treasury.transaction.journal_draft_created' AND target_id=$2",
    [adminEntity,preparedPayload.entry.id],
  );
  assert.equal(postingAudit.rowCount,1,"a preparação deve registar um evento de auditoria");

  // Versioned tax-rule workflow: draft -> review -> independent approval -> activation -> preview -> retirement.
  const adminOrganisation = (await fixtureClient.query(
    "SELECT organisation_id FROM accounting_entities WHERE id=$1",
    [adminEntity],
  )).rows[0].organisation_id;
  const taxReviewerEmail = "http-tax-reviewer-" + Date.now() + "@example.test";
  const taxReviewerPassword = "CI-tax-reviewer-password-long-123";
  const taxReviewerHash = await hash(taxReviewerPassword, 10);
  const taxReviewerId = (await fixtureClient.query(
    "INSERT INTO app_users (email,full_name,password_hash,status) VALUES ($1,'HTTP Tax Reviewer',$2,'active') RETURNING id",
    [taxReviewerEmail,taxReviewerHash],
  )).rows[0].id;
  await fixtureClient.query(
    "INSERT INTO organisation_memberships (organisation_id,user_id,role) VALUES ($1,$2,'tax_officer')",
    [adminOrganisation,taxReviewerId],
  );
  await fixtureClient.query(
    "INSERT INTO platform_administrators (user_id,granted_by_user_id,note) VALUES ($1,$2,$3)",
    [taxReviewerId,payload.user.id,"Acesso temporário de revisão fiscal no teste HTTP."],
  );
  taxFixtureIds = { organisation: adminOrganisation, reviewerId: taxReviewerId };

  const tenantAdminEmail = "http-tenant-admin-" + Date.now() + "@example.test";
  const tenantAdminPassword = "CI-tenant-admin-password-long-123";
  const tenantAdminHash = await hash(tenantAdminPassword, 10);
  const tenantAdminId = (await fixtureClient.query(
    "INSERT INTO app_users (email,full_name,password_hash,status) VALUES ($1,'HTTP Tenant Superadmin',$2,'active') RETURNING id",
    [tenantAdminEmail,tenantAdminHash],
  )).rows[0].id;
  await fixtureClient.query(
    "INSERT INTO organisation_memberships (organisation_id,user_id,role) VALUES ($1,$2,'superadmin')",
    [fixtureIds.org,tenantAdminId],
  );
  taxFixtureIds.tenantAdminId = tenantAdminId;

  const tenantAdminLogin = await fetch(baseUrl + "/api/auth/login",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({email:tenantAdminEmail,password:tenantAdminPassword}),
  });
  assert.equal(tenantAdminLogin.status,200,"superadministrador de outra organização deve conseguir iniciar sessão");
  const tenantAdminCookie = (tenantAdminLogin.headers.get("set-cookie")||"").split(";")[0];

  const anonymousTaxRules = await fetch(baseUrl + "/api/tax/rules");
  assert.equal(anonymousTaxRules.status,401,"registo de regras fiscais deve exigir sessão");
  const tenantAdminCannotCreateGlobalRule = await fetch(baseUrl + "/api/tax/rules",{
    method:"POST",headers:{cookie:tenantAdminCookie,"content-type":"application/json"},
    body:JSON.stringify({
      ruleKey:"ci.denied-rule-" + Date.now(),taxType:"OTHER",title:"Regra não autorizada",
      calculationMethod:"manual",parameters:{},effectiveFrom:"2026-01-01",
      legalReference:"Fixture de teste sem acesso global",sourceUrl:"https://example.test/denied",
    }),
  });
  assert.equal(tenantAdminCannotCreateGlobalRule.status,403,"superadministrador de uma organização não pode alterar o registo fiscal global");

  const draftRuleResponse = await fetch(baseUrl + "/api/tax/rules",{
    method:"POST",headers:{cookie:sessionCookie,"content-type":"application/json"},
    body:JSON.stringify({
      ruleKey:"ci.test-rule-" + Date.now(),taxType:"OTHER",title:"Regra fiscal de teste CI",
      description:"Regra artificial exclusiva dos testes automatizados; não representa legislação real.",
      calculationMethod:"percentage_of_base",parameters:{ratePercent:10,roundingScale:2},
      effectiveFrom:"2026-01-01",effectiveTo:"2026-12-31",
      legalReference:"Fixture CI — referência fictícia para testes",
      sourceUrl:"https://example.test/ci-tax-rule-fixture",sourcePublishedOn:"2026-01-01",
    }),
  });
  assert.equal(draftRuleResponse.status,201,"superadministrador deve conseguir criar uma versão de teste em rascunho");
  const draftRulePayload = await draftRuleResponse.json();
  const taxRuleId = draftRulePayload.rule.id;
  const taxRuleKey = draftRulePayload.rule.ruleKey;
  taxFixtureIds.ruleId = taxRuleId;
  assert.equal(draftRulePayload.rule.status,"draft","versão nova deve começar em rascunho");

  const calcBeforeApproval = await fetch(baseUrl + "/api/tax/calculate",{
    method:"POST",headers:{cookie:sessionCookie,"content-type":"application/json"},
    body:JSON.stringify({entityId:adminEntity,ruleKey:taxRuleKey,baseAmount:1000,asOfDate:"2026-10-29"}),
  });
  assert.equal(calcBeforeApproval.status,409,"regra não aprovada nunca pode ser usada por defeito");

  const tenantAdminCannotSubmitGlobalRule = await fetch(baseUrl + "/api/tax/rules/" + encodeURIComponent(taxRuleId),{
    method:"PATCH",headers:{cookie:tenantAdminCookie,"content-type":"application/json"},
    body:JSON.stringify({action:"submit_review"}),
  });
  assert.equal(tenantAdminCannotSubmitGlobalRule.status,403,"superadministrador de uma organização não pode gerir o workflow fiscal global");

  const submitRule = await fetch(baseUrl + "/api/tax/rules/" + encodeURIComponent(taxRuleId),{
    method:"PATCH",headers:{cookie:sessionCookie,"content-type":"application/json"},
    body:JSON.stringify({action:"submit_review"}),
  });
  assert.equal(submitRule.status,200,"rascunho deve poder seguir para revisão");
  assert.equal((await submitRule.json()).rule.status,"in_review");

  const selfApproval = await fetch(baseUrl + "/api/tax/rules/" + encodeURIComponent(taxRuleId),{
    method:"PATCH",headers:{cookie:sessionCookie,"content-type":"application/json"},
    body:JSON.stringify({action:"approve",sourceVerifiedOn:new Date().toISOString().slice(0,10),reviewNotes:"Esta tentativa de autoaprovação deve ser rejeitada pelo workflow."}),
  });
  assert.equal(selfApproval.status,403,"autor da regra não pode aprovar a própria versão");

  const reviewerLogin = await fetch(baseUrl + "/api/auth/login",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({email:taxReviewerEmail,password:taxReviewerPassword}),
  });
  assert.equal(reviewerLogin.status,200,"responsável fiscal de teste deve conseguir iniciar sessão");
  const reviewerCookie = (reviewerLogin.headers.get("set-cookie")||"").split(";")[0];
  const approval = await fetch(baseUrl + "/api/tax/rules/" + encodeURIComponent(taxRuleId),{
    method:"PATCH",headers:{cookie:reviewerCookie,"content-type":"application/json"},
    body:JSON.stringify({
      action:"approve",sourceVerifiedOn:new Date().toISOString().slice(0,10),
      reviewNotes:"Fonte de teste conferida para o CI; nenhum diploma real é representado por esta fixture.",
    }),
  });
  assert.equal(approval.status,200,"outro responsável fiscal deve poder aprovar após registar revisão da fonte");
  assert.equal((await approval.json()).rule.status,"approved");

  const activateRule = await fetch(baseUrl + "/api/tax/rules/" + encodeURIComponent(taxRuleId),{
    method:"PATCH",headers:{cookie:sessionCookie,"content-type":"application/json"},
    body:JSON.stringify({action:"activate"}),
  });
  assert.equal(activateRule.status,200,"superadministrador deve activar versão aprovada");
  assert.equal((await activateRule.json()).rule.status,"active");

  const taxPreview = await fetch(baseUrl + "/api/tax/calculate",{
    method:"POST",headers:{cookie:sessionCookie,"content-type":"application/json"},
    body:JSON.stringify({entityId:adminEntity,ruleKey:taxRuleKey,baseAmount:1000,asOfDate:"2026-10-29"}),
  });
  const taxPreviewPayload = await taxPreview.json();
  assert.equal(taxPreview.status,200,"regra activa e em vigência deve permitir simulação: " + JSON.stringify(taxPreviewPayload));
  assert.equal(taxPreviewPayload.preview.amount,100,"simulação deve usar a taxa explicitamente configurada na fixture");
  assert.equal(taxPreviewPayload.preview.version,1);
  assert.match(taxPreviewPayload.notice,/não cria obrigação/i);

  const retireRule = await fetch(baseUrl + "/api/tax/rules/" + encodeURIComponent(taxRuleId),{
    method:"PATCH",headers:{cookie:sessionCookie,"content-type":"application/json"},
    body:JSON.stringify({action:"retire"}),
  });
  assert.equal(retireRule.status,200,"superadministrador deve retirar uma versão activa");
  assert.equal((await retireRule.json()).rule.status,"retired");
  const calcAfterRetirement = await fetch(baseUrl + "/api/tax/calculate",{
    method:"POST",headers:{cookie:sessionCookie,"content-type":"application/json"},
    body:JSON.stringify({entityId:adminEntity,ruleKey:taxRuleKey,baseAmount:1000,asOfDate:"2026-10-29"}),
  });
  assert.equal(calcAfterRetirement.status,409,"versão retirada não pode continuar a ser usada");

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
    if (taxFixtureIds) {
      if (taxFixtureIds.ruleId) {
        await fixtureClient.query("DELETE FROM tax_rule_audit_events WHERE rule_version_id=$1", [taxFixtureIds.ruleId]).catch(() => undefined);
        await fixtureClient.query("DELETE FROM tax_rule_versions WHERE id=$1", [taxFixtureIds.ruleId]).catch(() => undefined);
      }
      if (taxFixtureIds.reviewerId) {
        await fixtureClient.query("DELETE FROM platform_administrators WHERE user_id=$1", [taxFixtureIds.reviewerId]).catch(() => undefined);
        await fixtureClient.query("DELETE FROM organisation_memberships WHERE organisation_id=$1 AND user_id=$2", [taxFixtureIds.organisation,taxFixtureIds.reviewerId]).catch(() => undefined);
        await fixtureClient.query("DELETE FROM app_users WHERE id=$1", [taxFixtureIds.reviewerId]).catch(() => undefined);
      }
      if (taxFixtureIds.tenantAdminId) {
        await fixtureClient.query("DELETE FROM platform_administrators WHERE user_id=$1", [taxFixtureIds.tenantAdminId]).catch(() => undefined);
        await fixtureClient.query("DELETE FROM organisation_memberships WHERE organisation_id=$1 AND user_id=$2", [fixtureIds.org,taxFixtureIds.tenantAdminId]).catch(() => undefined);
        await fixtureClient.query("DELETE FROM app_users WHERE id=$1", [taxFixtureIds.tenantAdminId]).catch(() => undefined);
      }
    }
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
      await fixtureClient.query("DELETE FROM treasury_posting_mappings WHERE accounting_entity_id = $1", [f.adminEntity]).catch(() => undefined);
      await fixtureClient.query("DELETE FROM treasury_transactions WHERE accounting_entity_id = $1", [f.adminEntity]).catch(() => undefined);
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
