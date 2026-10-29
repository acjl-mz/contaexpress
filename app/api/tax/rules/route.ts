import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { validateRuleParameters } from "@/lib/tax/rule-engine.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WRITE_ROLES = new Set(["superadmin", "tax_officer"]);
const TAX_TYPES = new Set(["IVA", "IRPS", "IRPC", "ISPC", "INSS", "IRRM", "OTHER"]);
const METHODS = new Set(["percentage_of_base", "fixed_amount", "progressive_brackets", "manual"]);
const STATUSES = new Set(["draft", "in_review", "approved", "active", "retired"]);
const clean = (value: unknown, max = 300) => typeof value === "string" ? value.trim().slice(0, max) : "";
const isPlatformAdmin = async (userId: string) => {
  const result = await db.query("SELECT EXISTS (SELECT 1 FROM platform_administrators WHERE user_id=$1) AS allowed", [userId]);
  return Boolean(result.rows[0]?.allowed);
};

function isRealDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export async function GET(request: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para consultar o registo fiscal." }, { status: 401 });

  const status = request.nextUrl.searchParams.get("status");
  const taxType = request.nextUrl.searchParams.get("taxType");
  if (status && !STATUSES.has(status)) return NextResponse.json({ error: "Estado fiscal inválido." }, { status: 400 });
  if (taxType && !TAX_TYPES.has(taxType)) return NextResponse.json({ error: "Tipo de imposto inválido." }, { status: 400 });

  try {
    const result = await db.query(
      `SELECT id, rule_key AS "ruleKey", version, jurisdiction, tax_type AS "taxType", title, description,
        calculation_method AS "calculationMethod", parameters, effective_from AS "effectiveFrom",
        effective_to AS "effectiveTo", legal_reference AS "legalReference", source_url AS "sourceUrl",
        source_published_on AS "sourcePublishedOn", source_verified_on AS "sourceVerifiedOn",
        status, review_notes AS "reviewNotes", created_by AS "createdBy", reviewed_by AS "reviewedBy",
        reviewed_at AS "reviewedAt", approved_by AS "approvedBy", approved_at AS "approvedAt",
        activated_by AS "activatedBy", activated_at AS "activatedAt", retired_at AS "retiredAt",
        created_at AS "createdAt", updated_at AS "updatedAt"
       FROM tax_rule_versions
       WHERE ($1::text IS NULL OR status = $1)
         AND ($2::text IS NULL OR tax_type = $2)
       ORDER BY rule_key, version DESC
       LIMIT 500`,
      [status, taxType],
    );
    return NextResponse.json({ rules: result.rows, permissions: { canManage: await isPlatformAdmin(user.id) } });
  } catch (error) {
    console.error("Falha ao consultar regras fiscais versionadas:", error);
    return NextResponse.json({ error: "Não foi possível carregar o registo de regras fiscais." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para registar uma regra fiscal." }, { status: 401 });
  if (!WRITE_ROLES.has(user.role)) return NextResponse.json({ error: "Só os responsáveis fiscais autorizados podem criar versões de regras." }, { status: 403 });
  if (!await isPlatformAdmin(user.id)) return NextResponse.json({ error: "O registo de regras fiscais é global. É necessário um acesso explícito de administração da plataforma." }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Corpo do pedido inválido." }, { status: 400 });

  const ruleKey = clean(body.ruleKey, 80).toLowerCase();
  const taxType = clean(body.taxType, 20);
  const title = clean(body.title, 180);
  const description = clean(body.description, 2000) || null;
  const calculationMethod = clean(body.calculationMethod, 40);
  const effectiveFrom = body.effectiveFrom;
  const effectiveTo = body.effectiveTo === "" || body.effectiveTo == null ? null : body.effectiveTo;
  const legalReference = clean(body.legalReference, 300);
  const sourceUrl = clean(body.sourceUrl, 1000);
  const sourcePublishedOn = body.sourcePublishedOn === "" || body.sourcePublishedOn == null ? null : body.sourcePublishedOn;
  const parameters = body.parameters;

  if (!/^[a-z][a-z0-9._-]{2,79}$/.test(ruleKey)) return NextResponse.json({ error: "A chave deve começar por uma letra minúscula e conter apenas letras, números, ponto, hífen ou underscore." }, { status: 400 });
  if (!TAX_TYPES.has(taxType) || title.length < 3 || !METHODS.has(calculationMethod)) return NextResponse.json({ error: "Verifique o tipo de imposto, título e método de cálculo." }, { status: 400 });
  if (!isRealDate(effectiveFrom) || (effectiveTo !== null && !isRealDate(effectiveTo)) || (effectiveTo !== null && effectiveTo < effectiveFrom)) {
    return NextResponse.json({ error: "Indique um intervalo de vigência válido." }, { status: 400 });
  }
  if (sourcePublishedOn !== null && !isRealDate(sourcePublishedOn)) return NextResponse.json({ error: "A data de publicação da fonte é inválida." }, { status: 400 });
  if (legalReference.length < 6 || !/^https:\/\//i.test(sourceUrl)) {
    return NextResponse.json({ error: "Indique a referência normativa e um endereço HTTPS da fonte." }, { status: 400 });
  }
  const parameterError = validateRuleParameters(calculationMethod, parameters);
  if (parameterError) return NextResponse.json({ error: parameterError }, { status: 400 });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["tax-rule-version:" + ruleKey]);
    const versionResult = await client.query("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM tax_rule_versions WHERE rule_key = $1", [ruleKey]);
    const version = Number(versionResult.rows[0].version);
    const result = await client.query(
      `INSERT INTO tax_rule_versions
        (rule_key, version, tax_type, title, description, calculation_method, parameters,
         effective_from, effective_to, legal_reference, source_url, source_published_on, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::date,$9::date,$10,$11,$12::date,$13)
       RETURNING id, rule_key AS "ruleKey", version, tax_type AS "taxType", title,
         calculation_method AS "calculationMethod", parameters, effective_from AS "effectiveFrom",
         effective_to AS "effectiveTo", legal_reference AS "legalReference", source_url AS "sourceUrl",
         status, created_at AS "createdAt"`,
      [ruleKey, version, taxType, title, description, calculationMethod, JSON.stringify(parameters), effectiveFrom, effectiveTo, legalReference, sourceUrl, sourcePublishedOn, user.id],
    );
    const rule = result.rows[0];
    await client.query(
      "INSERT INTO tax_rule_audit_events (rule_version_id,actor_user_id,event_type,details) VALUES ($1,$2,'created',$3::jsonb)",
      [rule.id, user.id, JSON.stringify({ ruleKey, version, taxType, calculationMethod, effectiveFrom, effectiveTo })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ rule, message: "Rascunho criado. Ainda não pode ser usado em cálculos fiscais." }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Falha ao criar versão de regra fiscal:", error);
    return NextResponse.json({ error: "Não foi possível criar a versão. Verifique a chave, os dados e as permissões." }, { status: 400 });
  } finally {
    client.release();
  }
}
