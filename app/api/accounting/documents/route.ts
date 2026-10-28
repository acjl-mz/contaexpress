import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;
const MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function safeFilename(value: string) {
  const leaf = value.replace(/\\/g, "/").split("/").pop() ?? "";
  return leaf.replace(/[\\r\\n\\0]/g, "").trim().slice(0, 240) || "documento";
}

export async function GET(request: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  const entityId = request.nextUrl.searchParams.get("entityId");
  if (!entityId) return NextResponse.json({ error: "Indique a empresa." }, { status: 400 });
  try {
    const access = await db.query("SELECT user_can_access_entity($1, $2) AS allowed", [user.id, entityId]);
    if (!access.rows[0]?.allowed) return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 });
    const result = await db.query(
      `SELECT d.id, d.original_filename AS "filename", d.mime_type AS "mimeType",
              d.file_size_bytes AS "fileSizeBytes", d.sha256,
              d.journal_entry_id AS "journalEntryId", e.entry_number AS "entryNumber",
              d.description, d.created_at AS "createdAt", u.full_name AS "uploadedBy"
       FROM accounting_documents d
       LEFT JOIN journal_entries e ON e.id = d.journal_entry_id AND e.accounting_entity_id = d.accounting_entity_id
       JOIN app_users u ON u.id = d.uploaded_by
       WHERE d.accounting_entity_id = $1
       ORDER BY d.created_at DESC LIMIT 250`,
      [entityId],
    );
    return NextResponse.json({ documents: result.rows });
  } catch (error) {
    console.error("Falha ao listar documentos:", error);
    return NextResponse.json({ error: "Não foi possível carregar os documentos." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  if (!["superadmin", "client_manager", "accountant", "document_manager"].includes(user.role)) {
    return NextResponse.json({ error: "Não tem permissão para arquivar documentos." }, { status: 403 });
  }

  try {
    const form = await request.formData();
    const entityId = typeof form.get("entityId") === "string" ? String(form.get("entityId")) : "";
    const entryIdValue = form.get("journalEntryId");
    const entryId = typeof entryIdValue === "string" && entryIdValue.trim() ? entryIdValue.trim() : null;
    const descriptionValue = form.get("description");
    const description = typeof descriptionValue === "string" ? descriptionValue.trim().slice(0, 500) || null : null;
    const upload = form.get("file");

    if (!entityId || !(upload instanceof File)) {
      return NextResponse.json({ error: "Seleccione a empresa e um ficheiro." }, { status: 400 });
    }
    if (upload.size < 1 || upload.size > MAX_BYTES) {
      return NextResponse.json({ error: "O ficheiro deve ter no máximo 8 MB e não pode estar vazio." }, { status: 400 });
    }
    if (!MIME_TYPES.has(upload.type)) {
      return NextResponse.json({ error: "Formato não permitido. Utilize PDF, JPG, PNG, CSV, XLSX ou DOCX." }, { status: 400 });
    }

    const access = await db.query("SELECT user_can_access_entity($1, $2) AS allowed", [user.id, entityId]);
    if (!access.rows[0]?.allowed) return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 });

    if (entryId) {
      const entry = await db.query(
        "SELECT id FROM journal_entries WHERE id = $1 AND accounting_entity_id = $2",
        [entryId, entityId],
      );
      if (!entry.rowCount) return NextResponse.json({ error: "O lançamento indicado não pertence a esta empresa." }, { status: 400 });
    }

    const bytes = Buffer.from(await upload.arrayBuffer());
    if (upload.type === "application/pdf" && bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      return NextResponse.json({ error: "O conteúdo não corresponde a um ficheiro PDF válido." }, { status: 400 });
    }
    if (upload.type === "image/png" && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      return NextResponse.json({ error: "O conteúdo não corresponde a uma imagem PNG válida." }, { status: 400 });
    }
    if (upload.type === "image/jpeg" && !(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) {
      return NextResponse.json({ error: "O conteúdo não corresponde a uma imagem JPEG válida." }, { status: 400 });
    }

    const filename = safeFilename(upload.name);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const result = await db.query(
      `INSERT INTO accounting_documents
         (accounting_entity_id, journal_entry_id, original_filename, mime_type, file_size_bytes, sha256, file_data, description, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, original_filename AS filename, mime_type AS "mimeType",
                 file_size_bytes AS "fileSizeBytes", created_at AS "createdAt"`,
      [entityId, entryId, filename, upload.type, bytes.length, sha256, bytes, description, user.id],
    );
    await db.query(
      `INSERT INTO audit_events (organisation_id, accounting_entity_id, actor_user_id, event_type, target_type, target_id, details)
       SELECT organisation_id, $1, $2, 'accounting_document.uploaded', 'accounting_document', $3, $4::jsonb
       FROM accounting_entities WHERE id = $1`,
      [entityId, user.id, result.rows[0].id, JSON.stringify({ filename, fileSizeBytes: bytes.length, mimeType: upload.type, sha256 })],
    );
    return NextResponse.json({ document: result.rows[0] }, { status: 201 });
  } catch (error) {
    console.error("Falha ao arquivar documento:", error);
    return NextResponse.json({ error: "Não foi possível arquivar o documento." }, { status: 500 });
  }
}
