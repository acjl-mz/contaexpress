const clean = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "?");
const escapePdf = (value) => clean(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : String(value ?? "");
}

export function renderReportPdf({ title, entityId, report, from, to, asOf, accounts = [], journalLines = [], lines = [], totals = {} }) {
  const reportRows = accounts.length ? accounts : journalLines.length ? journalLines : lines;
  const displayRows = reportRows.map((row) => {
    const date = row.entryDate ? String(row.entryDate).slice(0, 10) : "";
    const code = row.code ?? row.accountCode ?? row.account_code ?? "";
    const name = row.name ?? row.accountName ?? row.entryDescription ?? row.description ?? "";
    const debit = row.debit === undefined ? "" : money(row.debit);
    const credit = row.credit === undefined ? "" : money(row.credit);
    const balance = row.balance ?? row.debitBalance ?? row.creditBalance ?? row.runningBalance;
    return [date, code, name, debit, credit, balance === undefined ? "" : money(balance)].filter(Boolean).join(" | ").slice(0, 115);
  });
  const totalLine = Object.entries(totals).map(([key, value]) => `${key}: ${money(value)}`).join(" | ");
  const metadata = [
    `Empresa/entidade: ${entityId}`,
    `Relatorio: ${report}`,
    `Periodo: ${from || "inicio"} a ${to || asOf || "actual"}`,
    `Linhas: ${displayRows.length}`,
    "",
    ...displayRows,
    "",
    `Totais: ${totalLine || "sem totais"}`,
    "",
    `Gerado pelo ContaExpress em ${new Date().toISOString()}`,
  ];
  const linesPerPage = 46;
  const chunks = [];
  for (let i = 0; i < metadata.length; i += linesPerPage) chunks.push(metadata.slice(i, i + linesPerPage));
  if (!chunks.length) chunks.push(["Sem dados para apresentar."]);

  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalogId = add("");
  const pagesId = add("");
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds = [];

  for (let pageIndex = 0; pageIndex < chunks.length; pageIndex++) {
    const pageLines = [clean(title || "Relatorio ContaExpress"), ...chunks[pageIndex]];
    let stream = "BT\n/F1 14 Tf\n50 790 Td\n(" + escapePdf(pageLines[0]) + ") Tj\n/F1 8 Tf\n";
    for (const line of pageLines.slice(1)) stream += "0 -15 Td\n(" + escapePdf(line) + ") Tj\n";
    stream += "ET";
    const streamId = add(`<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`);
    const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${streamId} 0 R >>`);
    pageIds.push(pageId);
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n%CEPDF\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}
