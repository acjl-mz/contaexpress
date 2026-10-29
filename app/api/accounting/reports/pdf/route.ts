import { NextRequest, NextResponse } from "next/server";
import { GET as getReport } from "../route";
import { renderReportPdf } from "@/lib/accounting/report-pdf.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = new URLSearchParams(request.nextUrl.searchParams);
  if (!params.get("entityId")) return NextResponse.json({ error: "Indique a empresa." }, { status: 400 });
  const report = params.get("report") || "trial-balance";
  const allowed = ["trial-balance", "ledger", "journal", "balance-sheet", "income-statement"];
  if (!allowed.includes(report)) return NextResponse.json({ error: "Tipo de relatório inválido." }, { status: 400 });

  try {
    const upstreamUrl = new URL(request.url);
    upstreamUrl.pathname = "/api/accounting/reports";
    upstreamUrl.search = params.toString();
    const upstreamRequest = new NextRequest(upstreamUrl, {
      headers: { cookie: request.headers.get("cookie") || "" },
    });
    const upstream = await getReport(upstreamRequest);
    if (!upstream.ok) {
      const payload = await upstream.json().catch(() => ({ error: "Não foi possível gerar o relatório." }));
      return NextResponse.json(payload, { status: upstream.status });
    }
    const data = await upstream.json();
    const pdf = renderReportPdf({
      title: report.replace(/-/g, " ").toUpperCase() + " — ContaExpress",
      entityId: params.get("entityId"),
      report,
      from: params.get("from") || undefined,
      to: params.get("to") || undefined,
      ...data,
    });
    const filename = `contaexpress-${report}-${params.get("to") || new Date().toISOString().slice(0, 10)}.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Falha ao exportar relatório PDF:", error);
    return NextResponse.json({ error: "Não foi possível gerar o PDF do relatório." }, { status: 500 });
  }
}
