import { NextRequest, NextResponse } from "next/server";
import { canManageCompanies, getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

function clean(value: unknown, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  try {
    const result = await db.query(
      `SELECT e.id, e.legal_name AS "legalName", e.tax_number AS "taxNumber",
              e.country_code AS "countryCode", e.functional_currency AS currency,
              e.status, e.created_at AS "createdAt"
       FROM accounting_entities e
       JOIN organisations o ON o.id = e.organisation_id
       WHERE e.organisation_id = $1 AND e.status <> 'archived'
         AND user_can_access_entity($2, e.id)
       ORDER BY e.created_at DESC`,
      [user.organisationId, user.id],
    );
    return NextResponse.json({ companies: result.rows });
  } catch (error) {
    console.error("Falha ao listar empresas:", error);
    return NextResponse.json({ error: "Não foi possível carregar as empresas." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  if (!canManageCompanies(user.role)) return NextResponse.json({ error: "Não tem permissão para registar empresas." }, { status: 403 });

  try {
    const body = await request.json();
    const legalName = clean(body.legalName, 180);
    const taxNumber = clean(body.taxNumber, 80) || null;
    const countryCode = clean(body.countryCode, 2).toUpperCase() || "MZ";
    const currency = clean(body.currency, 3).toUpperCase() || "MZN";

    if (legalName.length < 2) return NextResponse.json({ error: "A denominação da empresa é obrigatória." }, { status: 400 });
    if (!/^[A-Z]{2}$/.test(countryCode)) return NextResponse.json({ error: "O código do país deve conter duas letras." }, { status: 400 });
    if (!/^[A-Z]{3}$/.test(currency)) return NextResponse.json({ error: "A moeda deve conter três letras." }, { status: 400 });

    const client = await db.connect();
    let company;
    try {
      await client.query("BEGIN");
      const org = await client.query("SELECT id FROM organisations WHERE id = $1 AND status = 'active' FOR UPDATE", [user.organisationId]);
      if (!org.rowCount) throw new Error("Organização indisponível.");
      const created = await client.query(
        `INSERT INTO accounting_entities (organisation_id, legal_name, tax_number, country_code, functional_currency)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, legal_name AS "legalName", tax_number AS "taxNumber", country_code AS "countryCode", functional_currency AS currency, status, created_at AS "createdAt"`,
        [user.organisationId, legalName, taxNumber, countryCode, currency],
      );
      company = created.rows[0];
      await client.query(
        `INSERT INTO audit_events (organisation_id, accounting_entity_id, actor_user_id, event_type, target_type, target_id, details)
         VALUES ($1, $2, $3, 'company.created', 'accounting_entity', $5, $4::jsonb)`,
        [user.organisationId, company.id, user.id, JSON.stringify({ legalName, countryCode, currency }), String(company.id)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return NextResponse.json({ company }, { status: 201 });
  } catch (error) {
    console.error("Falha ao registar empresa:", error);
    return NextResponse.json({ error: "Não foi possível registar a empresa." }, { status: 500 });
  }
}
