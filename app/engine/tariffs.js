// Steuerhilfe · Tarife (Port von TaxCore/Calc/Tariffs.swift).
import { clean, round, floorTo, floor5Rp, nonNeg } from './money.js';

// ---- Kanton St.Gallen ----

/** Einfache Steuer vom Einkommen nach der amtlichen Tariftabelle (100er-Schritte). */
export function sgSimpleIncomeTax(taxable, kind, t) {
  const income = floorTo(taxable, t.step);
  if (income < t.from) return 0;
  const flatFrom = kind === 'single' ? t.singleFlatFrom : t.jointFlatFrom;
  if (income > flatFrom) return round(income * t.flatRateAbove, 2);
  const idx = Math.trunc(clean((income - t.from) / t.step));
  const column = kind === 'single' ? t.single : t.joint;
  if (idx < column.length) return column[idx];
  return round(income * t.flatRateAbove, 2);
}

/** Satz der einfachen Steuer (als Anteil, nicht Prozent). */
export function sgSimpleIncomeRate(taxable, kind, t) {
  const income = floorTo(taxable, t.step);
  if (!(income > 0)) return 0;
  return clean(sgSimpleIncomeTax(income, kind, t) / income);
}

/** Einfache Vermögenssteuer (Promille vom steuerbaren Vermögen). */
export const sgSimpleWealthTax = (taxable, promille) => round((nonNeg(taxable) * promille) / 1000, 2);

// ---- Direkte Bundessteuer ----

/** Jahressteuer nach Art. 36 DBG (vor Abzug pro Kind). */
export function federalIncomeTax(taxable, kind, tariff) {
  const income = floorTo(taxable, 100);
  const brackets = kind === 'single' ? tariff.alleinstehend : tariff.verheiratet;
  const flatFrom = kind === 'single' ? tariff.alleinstehendFlatAb : tariff.verheiratetFlatAb;
  if (income >= flatFrom) return floor5Rp(income * tariff.flatSatz);
  let bracket = null;
  for (const b of brackets) if (income >= b.ab) bracket = b;
  if (!bracket) return 0;
  const steps = clean((income - bracket.ab) / 100);
  return floor5Rp(bracket.steuer + steps * bracket.proHundert);
}

/** Bundessteuer inkl. Abzug pro Kind und Mindestbetrag. */
export function federalIncomeTaxNet(taxable, kind, children, tariff) {
  let tax = federalIncomeTax(taxable, kind, tariff);
  tax = nonNeg(tax - children * tariff.abzugProKind);
  if (tax < tariff.minimum) return 0;
  return tax;
}
