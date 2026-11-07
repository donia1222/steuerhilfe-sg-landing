// Steuerhilfe · Geldbeträge und Rundung (Port von TaxCore/Money.swift).
// Swift rechnet mit Decimal; hier sind es Zahlen. Damit die Fliesskomma-Reste
// (0.1 + 0.2 = 0.30000000000000004) keine Rundung kippen, wird vor jeder Rundung
// auf 15 gültige Stellen bereinigt. Die Tests vergleichen jeden Franken mit dem Mac.

/** Fliesskomma-Rest entfernen. */
export const clean = (x) => (Number.isFinite(x) ? Number(x.toPrecision(15)) : 0);

/** Kaufmännisch runden (bei .5 weg von null), wie NSDecimalNumber .plain. */
export function round(x, places = 0) {
  const v = clean(x);
  const s = v < 0 ? -1 : 1;
  const a = Math.abs(v);
  return clean(s * Number(Math.round(Number(`${a}e${places}`)) + `e-${places}`));
}

/** Abrunden auf `places` Stellen (Richtung minus unendlich), wie .down. */
export function roundDown(x, places = 0) {
  const v = clean(x);
  return clean(Number(Math.floor(Number(`${v}e${places}`)) + `e-${places}`));
}

/** Auf ein Vielfaches von `step` abschneiden (z.B. steuerbares Einkommen auf 100 Fr.). */
export function floorTo(x, step) {
  if (!(step > 0)) return clean(x);
  return clean(Math.floor(clean(x / step)) * step);
}

/** Auf 5 Rappen abrunden (Bundessteuer). */
export const floor5Rp = (x) => clean(Math.floor(clean(x * 20)) / 20);
/** Auf 5 Rappen runden (kaufmännisch). */
export const round5Rp = (x) => clean(round(x * 20) / 20);

export const nonNeg = (x) => (x > 0 ? clean(x) : 0);
export const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
export const sum = (arr, f = (v) => v) => clean(arr.reduce((s, v) => s + (Number(f(v)) || 0), 0));

/** Schweizer Darstellung: 12’345 bzw. 12’345.50 */
export function chf(value, decimals = 0, withCurrency = false) {
  const v = round(value, decimals);
  const neg = v < 0;
  const [int, frac] = Math.abs(v).toFixed(decimals).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '’');
  const s = (neg ? '-' : '') + grouped + (frac ? `.${frac}` : '');
  return withCurrency ? `CHF ${s}` : s;
}
