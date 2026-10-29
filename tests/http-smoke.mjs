import assert from "node:assert/strict";
import { spawn } from "node:child_process";

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

  const authenticatedCompanies = await fetch(`${baseUrl}/api/companies`, {
    headers: { cookie: sessionCookie },
  });
  assert.equal(authenticatedCompanies.status, 200, "utilizador autenticado deve poder listar as suas empresas");
  const companiesPayload = await authenticatedCompanies.json();
  assert.ok(Array.isArray(companiesPayload.companies), "resposta de empresas deve conter uma lista");

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { cookie: sessionCookie },
  });
  assert.equal(logout.status, 200, "logout deve terminar com sucesso");

  const afterLogout = await fetch(`${baseUrl}/api/auth/me`);
  assert.equal(afterLogout.status, 401, "após logout, a sessão não deve ser reutilizada");

  console.log("HTTP smoke tests: 8 verificações aprovadas.");
} finally {
  server.kill("SIGTERM");
  await new Promise(resolve => {
    if (server.exitCode !== null || server.signalCode !== null) return resolve();
    const timeout = setTimeout(() => { server.kill("SIGKILL"); resolve(); }, 5000);
    server.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
}
