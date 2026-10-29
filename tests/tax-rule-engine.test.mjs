import test from "node:test";
import assert from "node:assert/strict";
import { calculateTaxAmount, isRuleEffectiveOn, validateRuleParameters } from "../lib/tax/rule-engine.mjs";

const activeRule = (calculationMethod, parameters, overrides = {}) => ({
  status: "active",
  calculation_method: calculationMethod,
  parameters,
  effective_from: "2026-01-01",
  effective_to: null,
  ...overrides,
});

test("percentage rule validates parameters and rounds to configured scale", () => {
  assert.equal(validateRuleParameters("percentage_of_base", { ratePercent: 16, roundingScale: 2 }), null);
  assert.equal(calculateTaxAmount(activeRule("percentage_of_base", { ratePercent: 16 }), 1000), 160);
  assert.equal(calculateTaxAmount(activeRule("percentage_of_base", { ratePercent: 16 }), 10.17), 1.63);
  assert.match(validateRuleParameters("percentage_of_base", { ratePercent: -1 }), /ratePercent/);
});

test("fixed amount rule calculates only from explicitly configured parameters", () => {
  assert.equal(calculateTaxAmount(activeRule("fixed_amount", { amount: 250 }), 0), 250);
  assert.match(validateRuleParameters("fixed_amount", { amount: -1 }), /amount/);
});

test("progressive brackets apply marginal rates and require an open final bracket", () => {
  const parameters = { brackets: [
    { upTo: 100, ratePercent: 10 },
    { upTo: 500, ratePercent: 20 },
    { upTo: null, ratePercent: 30 },
  ] };
  assert.equal(validateRuleParameters("progressive_brackets", parameters), null);
  assert.equal(calculateTaxAmount(activeRule("progressive_brackets", parameters), 650), 135);
  assert.match(validateRuleParameters("progressive_brackets", { brackets: [{ upTo: 100, ratePercent: 10 }] }), /último escalão/);
  assert.match(validateRuleParameters("progressive_brackets", { brackets: [
    { upTo: 500, ratePercent: 10 }, { upTo: 200, ratePercent: 15 }, { upTo: null, ratePercent: 20 },
  ] }), /crescentes/);
});

test("manual rules cannot be calculated automatically", () => {
  assert.equal(validateRuleParameters("manual", {}), null);
  assert.throws(() => calculateTaxAmount(activeRule("manual", {}), 500), /apuramento manual/);
});

test("only active rules within their effective period may be selected", () => {
  const rule = activeRule("percentage_of_base", { ratePercent: 10 }, { effective_to: "2026-12-31" });
  assert.equal(isRuleEffectiveOn(rule, "2026-01-01"), true);
  assert.equal(isRuleEffectiveOn(rule, "2026-12-31"), true);
  assert.equal(isRuleEffectiveOn(rule, "2027-01-01"), false);
  assert.equal(isRuleEffectiveOn({ ...rule, status: "approved" }, "2026-02-01"), false);
  assert.equal(isRuleEffectiveOn(rule, "2026-02-31"), false, "datas impossíveis não devem seleccionar uma regra");
  const databaseRule = activeRule("percentage_of_base", { ratePercent: 10 }, {
    effective_from: new Date("2026-01-01T00:00:00.000Z"),
    effective_to: new Date("2026-12-31T00:00:00.000Z"),
  });
  assert.equal(isRuleEffectiveOn(databaseRule, "2026-10-29"), true, "datas devolvidas pelo PostgreSQL também devem ser normalizadas");
});

test("the engine rejects unapproved rules and invalid monetary inputs", () => {
  assert.throws(() => calculateTaxAmount({ ...activeRule("percentage_of_base", { ratePercent: 10 }), status: "approved" }, 100), /activas/);
  assert.throws(() => calculateTaxAmount(activeRule("percentage_of_base", { ratePercent: 10 }), -5), /não negativo/);
  assert.throws(() => calculateTaxAmount(activeRule("percentage_of_base", { ratePercent: 10 }), Infinity), /não negativo/);
});
