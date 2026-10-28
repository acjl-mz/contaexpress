export function validIsoDate(value) {
  if (typeof value !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validDateRange(from, to) {
  if (from !== null && !validIsoDate(from)) return false;
  if (to !== null && !validIsoDate(to)) return false;
  return !(from !== null && to !== null && from > to);
}
