import test from "node:test";
import assert from "node:assert/strict";
import { validIsoDate, validDateRange } from "../lib/accounting/report-validation.mjs";

test("accepts valid ISO calendar dates, including leap day", () => {
  assert.equal(validIsoDate("2024-02-29"), true);
  assert.equal(validIsoDate("2026-10-29"), true);
});

test("rejects impossible dates and non-ISO values", () => {
  for (const value of ["2025-02-29", "2026-02-31", "2026-13-01", "2026-00-10", "10/29/2026", "", null]) {
    assert.equal(validIsoDate(value), false, String(value));
  }
});

test("accepts open-ended and ordered ranges", () => {
  assert.equal(validDateRange(null, null), true);
  assert.equal(validDateRange("2026-01-01", null), true);
  assert.equal(validDateRange(null, "2026-12-31"), true);
  assert.equal(validDateRange("2026-01-01", "2026-12-31"), true);
});

test("rejects invalid and reversed date ranges", () => {
  assert.equal(validDateRange("2026-12-31", "2026-01-01"), false);
  assert.equal(validDateRange("2026-02-30", "2026-03-01"), false);
  assert.equal(validDateRange(null, "2026-02-30"), false);
});
