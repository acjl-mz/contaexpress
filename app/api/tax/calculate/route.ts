import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { calculateTaxAmount, isRuleEffectiveOn } from "@/lib/tax/rule-engine.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRealDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export async function POST(request: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para simular um cálculo fiscal." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const entityId = typeof body?.entityId === "string" ? body.entityId.trim() : "";
  const ruleKey = typeof body?.ruleKey === "string" ? body.ruleKey.trim().toLowerCase() : "";
  const baseAmount = typeof body?.baseAmount === "number" ? body.baseAmount : Number.NaN;
  const asOfDate = body?.asOfDate;

  if (!entityId || !/^[a-z][a-z0-9._-]{2,79}$/.test(ruleKey) || !Number.isFinite(baseAmount) || baseAmount < 0 || baseAmount > 1_000_000_000_000 || !isRealDate(asOfDate)) {
    return NextResponse.json({ error: "Indique a empresa, chave da regra, base não negativa e data de apuramento válida." }, { status: 400 });
  }

  try {
    const access = await db.query("SELECT user_can_access_entity($1,$2) AS allowed", [user.id, entityId]);
    if (!access.rows[0]?.allowed) return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 });

    const result = await db.query(
      `SELECT id, rule_key AS "ruleKey", version, tax_type AS "taxType", title,
          calculation_method AS "calculationMethod", parameters,
          effective_from AS "effectiveFrom", effective_to AS "effectiveTo",
          legal_reference AS "legalReference", source_url AS "sourceUrl",
          source_verified_on AS "sourceVerifiedOn", status
       FROM tax_rule_versions
       WHERE rule_key=$1 AND status='active'
         AND effective_from <= $2::date
         AND (effective_to IS NULL OR effective_to >= $2::date)
       ORDER BY version DESC LIMIT 2`,
      [ruleKey, asOfDate],
    );
    if (!result.rowCount) {
      return NextResponse.json({ error: "Não existe uma versão fiscal activa e validada para esta regra e data. O sistema não aplicou qualquer taxa por defeito." }, { status: 409 });
    }
    if (result.rowCount > 1 || !isRuleEffectiveOn(result.rows[0], asOfDate)) {
      return NextResponse.json({ error: "Foram encontradas versões fiscais activas ambíguas. O cálculo foi bloqueado para evitar um resultado incerto." }, { status: 409 });
    }

    const rule = result.rows[0];
    let amount;
    try {
      amount = calculateTaxAmount(rule, baseAmount);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Esta regra não permite cálculo automático." }, { status: 422 });
    }

    await db.query(
      "INSERT INTO tax_rule_audit_events (rule_version_id,actor_user_id,event_type,details) VALUES ($1,$2,'calculation_preview',$3::jsonb)",
      [rule.id, user.id, JSON.stringify({ entityId, baseAmount, asOfDate, amount, ruleKey, version: rule.version })],
    );

    return NextResponse.json({
      preview: { ruleKey, version: rule.version, taxType: rule.taxType, title: rule.title, baseAmount, amount, currency: "MZN", asOfDate },
      source: { legalReference: rule.legalReference, url: rule.sourceUrl, verifiedOn: rule.sourceVerifiedOn },
      notice: "Simulação de apoio. Não cria obrigação, lançamento contabilístico ou declaração fiscal e não substitui validação profissional.",
    });
  } catch (error) {
    console.error("Falha ao simular cálculo fiscal:", error);
    return NextResponse.json({ error: "Não foi possível concluir a simulação fiscal." }, { status: 500 });
  }
}
