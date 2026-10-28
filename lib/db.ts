import { Pool } from "pg";

declare global {
  // Reuse a single pool across requests and Next.js development hot reloads.
  var contaExpressPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL não está configurada. Configure a variável de ambiente antes de aceder à base de dados.");
  }

  return new Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
  });
}

function getPool(): Pool {
  if (!global.contaExpressPool) {
    global.contaExpressPool = createPool();
  }
  return global.contaExpressPool;
}

// Do not initialise PostgreSQL while Next.js imports route modules during build.
// The pool is created on first actual database operation at runtime.
export const db = new Proxy({} as Pool, {
  get(_target, property) {
    if (property === "then") return undefined;
    const pool = getPool();
    const value: unknown = Reflect.get(pool, property, pool);
    return typeof value === "function" ? value.bind(pool) : value;
  },
});
