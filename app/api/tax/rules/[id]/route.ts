import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
const REVIEW_ROLES = new Set(["superadmin", "tax_officer"]);

function isRealDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para actualizar o estado da regra." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action : "";
  if (!["submit_review", "approve", "activate", "retire"].includes(action)) {
    return NextResponse.json({ error: "Acção de workflow fiscal inválida." }, { status: 400 });
  }
  if (["submit_review", "approve"].includes(action) && !REVIEW_ROLES.has(user.role)) {
    return NextResponse.json({ error: "Não tem permissão para submeter ou rever regras fiscais." }, { status: 403 });
  }
  if (["activate", "retire"].includes(action) && user.role !== "superadmin") {
    return NextResponse.json({ error: "A activação e retirada de regras fiscais requerem perfil de superadministrador." }, { status: 403 });
  }

  const { id } = await context.params;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const selected = await client.query(
      `SELECT id, rule_key AS "ruleKey", version, status, created_by AS "createdBy",
          effective_from AS "effectiveFrom", effective_to AS "effectiveTo"
       FROM tax_rule_versions WHERE id=$1 FOR UPDATE`,
      [id],
    );
    if (!selected.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Versão de regra fiscal não encontrada." }, { status: 404 });
    }
    const rule = selected.rows[0];
    let updated;
    let eventType;

    if (action === "submit_review") {
      if (rule.status !== "draft") {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Só é possível submeter um rascunho para revisão." }, { status: 409 });
      }
      updated = await client.query(
        `UPDATE tax_rule_versions SET status='in_review'
         WHERE id=$1 RETURNING id,status,rule_key AS "ruleKey",version`,
        [id],
      );
      eventType = "submitted_for_review";
    } else if (action === "approve") {
      const sourceVerifiedOn = body?.sourceVerifiedOn;
      const reviewNotes = typeof body?.reviewNotes === "string" ? body.reviewNotes.trim().slice(0, 3000) : "";
      if (rule.status !== "in_review") {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Só é possível aprovar uma regra que esteja em revisão." }, { status: 409 });
      }
      if (rule.createdBy === user.id) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "A pessoa que criou a versão não pode aprová-la." }, { status: 403 });
      }
      if (!isRealDate(sourceVerifiedOn) || sourceVerifiedOn > new Date().toISOString().slice(0, 10) || reviewNotes.length < 30) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "A aprovação exige uma data de verificação não futura e nota de revisão com pelo menos 30 caracteres." }, { status: 400 });
      }
      updated = await client.query(
        `UPDATE tax_rule_versions SET status='approved',source_verified_on=$2::date,
          review_notes=$3,reviewed_by=$4,reviewed_at=now(),approved_by=$4,approved_at=now()
         WHERE id=$1 RETURNING id,status,rule_key AS "ruleKey",version,source_verified_on AS "sourceVerifiedOn"`,
        [id, sourceVerifiedOn, reviewNotes, user.id],
      );
      eventType = "approved";
    } else if (action === "activate") {
      if (rule.status !== "approved") {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Só é possível activar uma versão aprovada." }, { status: 409 });
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["tax-rule-active:" + rule.ruleKey]);
      const overlaps = await client.query(
        `SELECT id FROM tax_rule_versions
         WHERE rule_key=$1 AND status='active' AND id<>$2
           AND (effective_to IS NULL OR effective_to >= $3::date)
           AND ($4::date IS NULL OR effective_from <= $4::date)
         LIMIT 1`,
        [rule.ruleKey, id, rule.effectiveFrom, rule.effectiveTo],
      );
      if (overlaps.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Já existe uma versão activa com período de vigência sobreposto. Retire ou ajuste a versão anterior através de novo versionamento." }, { status: 409 });
      }
      updated = await client.query(
        `UPDATE tax_rule_versions SET status='active',activated_by=$2,activated_at=now()
         WHERE id=$1 RETURNING id,status,rule_key AS "ruleKey",version,activated_at AS "activatedAt"`,
        [id, user.id],
      );
      eventType = "activated";
    } else {
      if (rule.status !== "active") {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Só é possível retirar uma versão activa." }, { status: 409 });
      }
      updated = await client.query(
        `UPDATE tax_rule_versions SET status='retired',retired_at=now()
         WHERE id=$1 RETURNING id,status,rule_key AS "ruleKey",version,retired_at AS "retiredAt"`,
        [id],
      );
      eventType = "retired";
    }

    await client.query(
      "INSERT INTO tax_rule_audit_events (rule_version_id,actor_user_id,event_type,details) VALUES ($1,$2,$3,$4::jsonb)",
      [id, user.id, eventType, JSON.stringify({ action, previousStatus: rule.status, nextStatus: updated.rows[0].status, ruleKey: rule.ruleKey, version: rule.version })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ rule: updated.rows[0], message: "Estado da versão fiscal actualizado." });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Falha na transição de estado da regra fiscal:", error);
    return NextResponse.json({ error: "Não foi possível alterar o estado. Verifique as regras de aprovação e o período de vigência." }, { status: 400 });
  } finally {
    client.release();
  }
}
