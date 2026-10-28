import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  const { id } = await context.params;
  const entityId = request.nextUrl.searchParams.get("entityId");
  if (!entityId) return NextResponse.json({ error: "Indique a empresa." }, { status: 400 });

  try {
    const access = await db.query("SELECT user_can_access_entity($1, $2) AS allowed", [user.id, entityId]);
    if (!access.rows[0]?.allowed) return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 });
    const result = await db.query(
      `SELECT original_filename, mime_type, file_data
       FROM accounting_documents
       WHERE id = $1 AND accounting_entity_id = $2`,
      [id, entityId],
    );
    const document = result.rows[0];
    if (!document) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });

    const filename = String(document.original_filename).replace(/[\\r\\n\\0"]/g, "_");
    const asciiFallback = filename.replace(/[^\\x20-\\x7E]/g, "_");
    return new NextResponse(new Uint8Array(document.file_data), {
      status: 200,
      headers: {
        "Content-Type": document.mime_type,
        "Content-Length": String(document.file_data.length),
        "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("Falha ao descarregar documento:", error);
    return NextResponse.json({ error: "Não foi possível descarregar o documento." }, { status: 500 });
  }
}
