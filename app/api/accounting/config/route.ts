import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  const entityId = request.nextUrl.searchParams.get("entityId");
  if (!entityId) return NextResponse.json({ error: "Indique a empresa." }, { status: 400 });
  try {
    const access = await db.query("SELECT user_can_access_entity($1, $2) AS allowed", [user.id, entityId]);
    if (!access.rows[0]?.allowed) return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 });
    const [periods, journals] = await Promise.all([
      db.query(
        `SELECT p.id, p.label, p.starts_on AS "startsOn", p.ends_on AS "endsOn", p.status,
                fy.label AS "fiscalYear"
         FROM accounting_periods p JOIN fiscal_years fy ON fy.id = p.fiscal_year_id
         WHERE p.accounting_entity_id = $1 ORDER BY p.starts_on DESC LIMIT 60`,
        [entityId],
      ),
      db.query(
        `SELECT id, code, name FROM accounting_journals
         WHERE accounting_entity_id = $1 AND is_active = TRUE ORDER BY code`,
        [entityId],
      ),
    ]);
    return NextResponse.json({ periods: periods.rows, journals: journals.rows });
  } catch (error) {
    console.error("Falha ao carregar configuração contabilística:", error);
    return NextResponse.json({ error: "Não foi possível carregar períodos e diários." }, { status: 500 });
  }
}
