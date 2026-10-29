import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateTrialBalance,
  calculateIncomeStatement,
  calculateBalanceSheet,
} from "../lib/accounting/report-calculations.mjs";

test("trial balance totals debit and credit equally and calculates account balances", () => {
  const result = calculateTrialBalance([
    { code: "101", name: "Banco", accountType: "asset", debit: "1000.00", credit: "250.00" },
    { code: "601", name: "Gastos", accountType: "expense", debit: "250.00", credit: "0.00" },
    { code: "701", name: "Rendimentos", accountType: "income", debit: "0.00", credit: "1000.00" },
    { code: "999", name: "Sem movimentos", accountType: "equity", debit: 0, credit: 0 },
  ]);
  assert.equal(result.accounts.length, 3);
  assert.deepEqual(result.totals, { debit: 1250, credit: 1250, debitBalance: 1000, creditBalance: 1000 });
  assert.equal(result.accounts[0].debitBalance, 750);
  assert.equal(result.accounts[0].creditBalance, 0);
});

test("income statement calculates income, expenses and net result", () => {
  const result = calculateIncomeStatement([
    { code: "701", accountType: "income", debit: 50, credit: 1050 },
    { code: "601", accountType: "expense", debit: 400, credit: 25 },
    { code: "602", accountType: "expense", debit: 0, credit: 0 },
  ]);
  assert.equal(result.accounts.length, 2);
  assert.deepEqual(result.totals, { income: 1000, expenses: 375, netResult: 625 });
});

test("balance sheet reconciles assets with liabilities, equity and accumulated result", () => {
  const result = calculateBalanceSheet([
    { code: "1", accountType: "asset", debit: 1500, credit: 200 },
    { code: "2", accountType: "liability", debit: 100, credit: 500 },
    { code: "5", accountType: "equity", debit: 0, credit: 575 },
  ], 125);
  assert.deepEqual(result.totals, {
    assets: 1300,
    liabilities: 400,
    equity: 575,
    accumulatedResult: 125,
    liabilitiesAndEquity: 1100,
    difference: 200,
  });
});

test("balance sheet reports zero difference when the accounting equation balances", () => {
  const result = calculateBalanceSheet([
    { accountType: "asset", debit: 1000, credit: 0 },
    { accountType: "liability", debit: 0, credit: 300 },
    { accountType: "equity", debit: 0, credit: 500 },
  ], 200);
  assert.equal(result.totals.difference, 0);
});

test("calculations round monetary amounts to two decimal places", () => {
  const result = calculateIncomeStatement([
    { accountType: "income", debit: 0, credit: 10.105 },
    { accountType: "expense", debit: 2.104, credit: 0 },
  ]);
  assert.equal(result.totals.income, 10.11);
  assert.equal(result.totals.expenses, 2.1);
  assert.equal(result.totals.netResult, 8.01);
});
