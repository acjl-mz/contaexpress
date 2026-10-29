const METHODS = new Set(["percentage_of_base", "fixed_amount", "progressive_brackets", "manual"]);
const MAX_AMOUNT = 1_000_000_000_000;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validNumber(value, min = 0, max = MAX_AMOUNT) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function scaleFor(parameters) {
  const scale = parameters?.roundingScale ?? 2;
  return Number.isInteger(scale) && scale >= 0 && scale <= 4 ? scale : null;
}

export function validateRuleParameters(method, parameters) {
  if (!METHODS.has(method)) return "Método de cálculo desconhecido.";
  if (!isPlainObject(parameters)) return "Os parâmetros devem ser um objecto JSON.";

  if (method === "manual") return Object.keys(parameters).length === 0 ? null : "O método manual não aceita parâmetros de cálculo.";

  if (scaleFor(parameters) === null) return "roundingScale deve ser um inteiro entre 0 e 4.";

  if (method === "percentage_of_base") {
    if (!validNumber(parameters.ratePercent, 0, 1000)) return "ratePercent deve ser um número entre 0 e 1000.";
    return null;
  }

  if (method === "fixed_amount") {
    if (!validNumber(parameters.amount)) return "amount deve ser um número não negativo.";
    return null;
  }

  const brackets = parameters.brackets;
  if (!Array.isArray(brackets) || brackets.length === 0 || brackets.length > 100) return "Indique entre 1 e 100 escalões.";
  let previous = 0;
  for (let index = 0; index < brackets.length; index += 1) {
    const bracket = brackets[index];
    if (!isPlainObject(bracket) || !validNumber(bracket.ratePercent, 0, 1000)) return "Cada escalão deve ter ratePercent válido.";
    const isLast = index === brackets.length - 1;
    if (isLast) {
      if (bracket.upTo !== null) return "O último escalão deve usar upTo: null para representar o limite aberto.";
    } else {
      if (!validNumber(bracket.upTo, Number.MIN_VALUE) || bracket.upTo <= previous) return "Os limites dos escalões devem ser positivos e crescentes.";
      previous = bracket.upTo;
    }
  }
  return null;
}

function roundAmount(value, scale) {
  const factor = 10 ** scale;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Pure arithmetic helper only. The caller must first select an active,
 * source-verified rule whose effective period contains the calculation date.
 * It deliberately does not encode Mozambican tax rates or legal assumptions.
 */
export function calculateTaxAmount(rule, baseAmount) {
  if (!rule || rule.status !== "active") throw new Error("Só podem ser usadas regras fiscais activas.");
  if (!validNumber(baseAmount)) throw new Error("A base de cálculo deve ser um número não negativo.");
  const method = rule.calculation_method ?? rule.calculationMethod;
  const parameters = rule.parameters ?? {};
  const invalid = validateRuleParameters(method, parameters);
  if (invalid) throw new Error(invalid);
  if (method === "manual") throw new Error("Esta regra exige apuramento manual e não pode calcular automaticamente.");

  let amount;
  if (method === "percentage_of_base") {
    amount = baseAmount * Number(parameters.ratePercent) / 100;
  } else if (method === "fixed_amount") {
    amount = Number(parameters.amount);
  } else {
    amount = 0;
    let lower = 0;
    for (const bracket of parameters.brackets) {
      const upper = bracket.upTo === null ? baseAmount : Math.min(baseAmount, Number(bracket.upTo));
      const taxableSlice = Math.max(0, upper - lower);
      amount += taxableSlice * Number(bracket.ratePercent) / 100;
      if (bracket.upTo === null || baseAmount <= Number(bracket.upTo)) break;
      lower = Number(bracket.upTo);
    }
  }
  const scale = scaleFor(parameters);
  if (scale === null || !Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT) throw new Error("O resultado do cálculo está fora dos limites permitidos.");
  return roundAmount(amount, scale);
}

function isRealIsoDate(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date + "T00:00:00.000Z");
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
}

export function isRuleEffectiveOn(rule, date) {
  if (!rule || rule.status !== "active" || !isRealIsoDate(date)) return false;
  const from = String(rule.effective_from ?? rule.effectiveFrom ?? "").slice(0, 10);
  const toValue = rule.effective_to ?? rule.effectiveTo;
  const to = toValue === null || toValue === undefined ? null : String(toValue).slice(0, 10);
  return from <= date && (to === null || to >= date);
}
