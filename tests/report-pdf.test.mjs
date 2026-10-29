import test from "node:test";
import assert from "node:assert/strict";
import { renderReportPdf } from "../lib/accounting/report-pdf.mjs";

test("PDF report has valid signature, xref and key accounting values", () => {
  const pdf = renderReportPdf({
    title: "Balancete — ContaExpress",
    entityId: "empresa-teste",
    report: "trial-balance",
    from: "2026-01-01",
    to: "2026-01-31",
    accounts: [
      { code: "11", name: "Banco", debit: 2500, credit: 0, debitBalance: 2500, creditBalance: 0 },
      { code: "5", name: "Capital", debit: 0, credit: 2500, debitBalance: 0, creditBalance: 2500 },
    ],
    totals: { debit: 2500, credit: 2500, debitBalance: 2500, creditBalance: 2500 },
  });
  const text = pdf.toString("ascii");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.includes("xref"));
  assert.ok(text.includes("%%EOF"));
  assert.ok(text.includes("2500.00"));
  assert.ok(text.includes("Banco"));
  assert.ok(text.includes("Capital"));
  assert.ok(text.includes("/Type /Catalog"));
});

test("PDF renderer paginates long reports and escapes PDF text", () => {
  const accounts = Array.from({ length: 100 }, (_, index) => ({
    code: String(index + 1),
    name: index === 0 ? "Conta (principal) \\ teste" : `Conta ${index + 1}`,
    debit: 10,
    credit: 10,
  }));
  const text = renderReportPdf({ title: "Relatorio", entityId: "e", report: "trial-balance", accounts }).toString("ascii");
  assert.match(text, /\/Count 3/);
  assert.ok(text.includes("\\(principal\\)"));
  assert.ok(text.includes("\\\\ teste"));
});
