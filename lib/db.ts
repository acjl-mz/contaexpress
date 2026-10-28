import { Pool } from "pg";

declare global {
  // Reuse a single pool during Next.js development hot reloads.
  var contaExpressPool: Pool | undefined;
}

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL não está configurada.");
  return new Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
  });
}

export const db = global.contaExpressPool ?? createPool();
if (process.env.NODE_ENV !== "production") global.contaExpressPool = db;
