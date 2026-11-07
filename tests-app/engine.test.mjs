// Pruebas del motor web: las mismas que TaxCore (Mac), con los mismos valores esperados.
// Ejecutar:  node --test tests-app/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setRuleLoader, loadRuleBook, loadLIRules, municipalityNamed } from '../app/engine/rules.js';
import { clean, round, round5Rp, floorTo } from '../app/engine/money.js';
import * as T from '../app/engine/tariffs.js';
import { calculate, computeBill, resultLine, federalOrCanton } from '../app/engine/calculator.js';
import { tips } from '../app/engine/advisor.js';
import { calculateLI, landessteuer, commute, workCosts, zuschlag } from '../app/engine/liechtenstein.js';
import * as M from '../app/engine/model.js';

const root = new URL('../', import.meta.url);
setRuleLoader(async (name) => JSON.parse(await readFile(new URL(`app/rules/${name}.json`, root), 'utf8')));

const near = (a, b, tol = 0.001) => Math.abs(a - b) <= tol;
const eq = (actual, expected, msg) => assert.ok(near(actual, expected), `${msg ?? ''} ${actual} ≠ ${expected}`);
const date = (y, m, d) => M.dateISO(y, m, d);

// ------------------------------------------------------------ Fechas (compatibles con la Mac)
test('Fechas: medianoche de Zúrich como en la Mac', () => {
  assert.equal(M.dateISO(2019, 3, 1), '2019-02-28T23:00:00Z');   // invierno, UTC+1
  assert.equal(M.dateISO(1987, 9, 12), '1987-09-11T22:00:00Z');  // verano, UTC+2
  assert.deepEqual(M.ymd('2019-02-28T23:00:00Z'), { y: 2019, m: 3, d: 1 });
  assert.equal(M.inputFromIso(M.isoFromInput('2022-05-01')), '2022-05-01');
});

test('Redondeo como Decimal de Swift', () => {
  assert.equal(round(2.5), 3);
  assert.equal(round(-2.5), -3);
  assert.equal(round(1.005, 2), 1.01);
  assert.equal(round5Rp(3.025), 3.05);
  assert.equal(floorTo(80099, 100), 80000);
  assert.equal(clean(0.1 + 0.2), 0.3);
});

// ------------------------------------------------------------ Tarife
test('Bundessteuer 2025 Alleinstehende – Tabellenwerte', async () => {
  const r = await loadRuleBook(2025);
  const cases = [[18500, 25.41], [19000, 29.26], [45000, 268.8], [61300, 710.01], [79200, 1333.69], [82100, 1506.6], [108700, 3262.2],
    [108900, 3277.6], [120600, 4307.2], [130600, 5187.2], [138400, 5873.6], [141600, 6157.4], [144300, 6454.4], [148300, 6894.4],
    [150400, 7125.4], [152400, 7345.4], [185000, 10933.6], [200000, 12913.6], [793400, 91241], [940900, 108203.5]];
  for (const [inc, exp] of cases) {
    const tax = T.federalIncomeTax(inc, 'single', r.federalRules.tarif);
    assert.ok(Math.abs(tax - exp) <= 0.0501, `${inc}: ${tax} ≠ ${exp}`);
  }
});

test('Bundessteuer 2025 Verheiratete – Tabellenwerte', async () => {
  const r = await loadRuleBook(2025);
  const cases = [[33000, 33], [43600, 139], [58100, 331], [61400, 398], [76200, 842], [82100, 1049], [108700, 2252], [120600, 2967],
    [138400, 4293], [150400, 5458], [152400, 5699], [184900, 9924], [940800, 108191], [950000, 109250]];
  for (const [inc, exp] of cases) eq(T.federalIncomeTax(inc, 'joint', r.federalRules.tarif), exp, String(inc));
});

test('Bundessteuer: Abzug pro Kind und Mindestbetrag', async () => {
  const t = (await loadRuleBook(2025)).federalRules.tarif;
  eq(T.federalIncomeTaxNet(100000, 'joint', 2, t), 1290);
  eq(T.federalIncomeTaxNet(31000, 'joint', 0, t), 0);
  eq(T.federalIncomeTaxNet(50000, 'joint', 3, t), 0);
});

test('Kanton SG: Vollsplitting entspricht Satz des halben Einkommens', async () => {
  const r = await loadRuleBook(2025);
  for (let income = 20000; income <= 500000; income += 12300) {
    const joint = T.sgSimpleIncomeTax(income, 'joint', r.sgTariff);
    const half = floorTo(Math.trunc(income / 2), 100);
    const single = T.sgSimpleIncomeTax(half, 'single', r.sgTariff);
    const viaRate = round((single / half) * income, 2);
    assert.ok(Math.abs(joint - viaRate) <= 1, `${income}: ${joint} vs ${viaRate}`);
  }
});

test('Kanton SG: Abrundung auf 100 Franken', async () => {
  const r = await loadRuleBook(2025);
  const a = T.sgSimpleIncomeTax(80099, 'joint', r.sgTariff);
  const b = T.sgSimpleIncomeTax(80000, 'joint', r.sgTariff);
  eq(a, b); eq(b, 3488);
});

test('Bundessteuer 2026 – Eckwerte', async () => {
  const t = (await loadRuleBook(2026)).federalRules.tarif;
  eq(T.federalIncomeTax(82100, 'single', t), 1502.95);
  eq(T.federalIncomeTax(794000, 'single', t), 91310);
  eq(T.federalIncomeTax(941400, 'joint', t), 108261);
  eq(T.federalIncomeTax(108700, 'joint', t), 2251);
});

// ------------------------------------------------------------ ESTV-Referenz (2’088 Fälle)
test('Steuerbeträge stimmen mit dem ESTV-Rechner überein', async () => {
  const { cases } = JSON.parse(await readFile(new URL('tests-app/fixtures/estv-simple.json', root), 'utf8'));
  assert.ok(cases.length > 2000);
  const mismatches = [];
  let compared = 0, known = 0;
  for (const fx of cases) {
    const rules = await loadRuleBook(fx.year);
    const c = M.newTaxCase(fx.year);
    c.municipality = fx.municipality;
    c.civilStatus = fx.relationship === 2 ? 'verheiratet' : 'ledig';
    const conf = fx.confession === 'roemisch-katholisch' ? 'roemischKatholisch' : fx.confession === 'evangelisch-reformiert' ? 'evangelischReformiert' : 'keine';
    c.person1.confession = conf; c.person2.confession = conf;
    c.children = Array.from({ length: fx.children }, () => ({ ...M.newChild(), education: 'schule' }));
    const m = municipalityNamed(rules.municipalities, fx.municipality);
    const bill = computeBill(rules, c, fx.income, fx.income, fx.fortune, m, m?.parishes[0] ?? null, fx.children);
    const flatFrom = M.tariffKind(c) === 'single' ? rules.sgTariff.singleFlatFrom : rules.sgTariff.jointFlatFrom;
    const above = fx.income > flatFrom;
    const check = (key, ours, cantonalIncome = false) => {
      const theirs = fx.estv[key];
      if (theirs === undefined) return;
      compared++;
      if (Math.abs(ours - theirs) <= 1.01) return;
      if (cantonalIncome && above) { assert.ok(Math.abs(ours - theirs) < theirs * 0.0005); known++; return; }
      mismatches.push(`${fx.year} ${fx.municipality} rel=${fx.relationship} kids=${fx.children} inc=${fx.income} fort=${fx.fortune}: ${key} ours=${ours} estv=${theirs}`);
    };
    check('IncomeSimpleTaxCanton', bill.simpleIncomeTax, true);
    check('IncomeTaxCanton', bill.cantonIncome, true);
    check('IncomeTaxCity', bill.municipalityIncome, true);
    check('IncomeTaxChurch', bill.churchIncome, true);
    check('FortuneTaxCanton', bill.cantonWealth);
    check('FortuneTaxCity', bill.municipalityWealth);
    check('FortuneTaxChurch', bill.churchWealth);
    check('IncomeTaxFed', bill.federal);
  }
  console.log(`ESTV-Vergleich: ${compared} Werte, ${mismatches.length} Abweichungen, ${known} bekannte (8,5%-Regel)`);
  assert.equal(mismatches.length, 0, mismatches.slice(0, 20).join('\n'));
});

// ------------------------------------------------------------ Steuerberechnung
function sampleFamily(year = 2025) {
  const c = M.newTaxCase(year);
  c.municipality = 'Sevelen'; c.civilStatus = 'verheiratet';
  Object.assign(c.person1, { firstName: 'Martin', lastName: 'Muster', birthDate: date(1985, 4, 2), confession: 'keine' });
  Object.assign(c.person2, { firstName: 'Anna', lastName: 'Muster', birthDate: date(1987, 9, 12), confession: 'keine' });
  c.income1.salaries = [{ ...M.newSalary(), employer: 'Werk AG', grossSalary: 97000, socialContributions: 6000, pensionContributions: 6000 }];
  c.income2.salaries = [{ ...M.newSalary(), employer: 'Praxis GmbH', grossSalary: 33000, socialContributions: 2000, pensionContributions: 1000 }];
  c.deductions1.work.publicTransportCost = 1200;
  c.deductions1.work.meals = 'auswaerts'; c.deductions1.work.mealDays = 200;
  c.deductions2.work.useBicycle = true; c.deductions2.work.bicycleCost = 700;
  c.deductions1.pillar3a = 7258; c.deductions2.pillar3a = 3000;
  c.children = [
    { ...M.newChild(), firstName: 'Lena', birthDate: date(2019, 3, 1), education: 'schule' },
    { ...M.newChild(), firstName: 'Tim', birthDate: date(2022, 5, 1), education: 'vorschule', childcareCosts: 8000 },
  ];
  c.householdDeductions.healthInsurancePremiums = 9000;
  c.securities = [{ ...M.newSecurity(), kind: 'konto', institution: 'Bank', taxValue: 40000, incomeWithoutWithholding: 50 }];
  c.householdDeductions.medicalCosts = [{ ...M.newMedicalCost(), provider: 'Zahnarzt', gross: 1500 }];
  c.householdDeductions.donations = [{ ...M.newDonation(), recipient: 'Glückskette', amount: 300 }];
  return c;
}

test('Familie Muster 2025 – alle Ziffern', async () => {
  const rules = await loadRuleBook(2025);
  const r = calculate(rules, sampleFamily());
  const k = (code) => resultLine(r, code)?.canton ?? -1;
  const b = (code) => { const l = resultLine(r, code); return l ? federalOrCanton(l) : -1; };
  const exp = [['100', 85000], ['102', 30000], ['146', 50], ['168', 115050], ['438', 6600], ['488', 3100], ['208', 7258], ['210', 3000],
    ['600', 9000], ['258', 8000], ['226', 500], ['230', 37458], ['234', 77592], ['240', 0], ['244', 300], ['248', 77292],
    ['252', 7600], ['254', 10800], ['268', 58892], ['338', 0]];
  for (const [code, v] of exp) eq(k(code), v, `Kanton ${code}`);
  const expB = [['438', 6750], ['488', 2700], ['600', 5100], ['226', 12150], ['230', 44958], ['234', 70092], ['248', 69792], ['268', 53392]];
  for (const [code, v] of expB) eq(b(code), v, `Bund ${code}`);
  eq(r.bill.federal, 0);
  const simple = T.sgSimpleIncomeTax(58892, 'joint', rules.sgTariff);
  eq(r.bill.simpleIncomeTax, simple);
  eq(r.bill.cantonIncome, round5Rp((simple * 105) / 100));
  eq(r.bill.municipalityIncome, round5Rp((simple * 118) / 100));
});

test('Einelternfamilie: Vollsplitting und Elterntarif', async () => {
  const rules = await loadRuleBook(2025);
  const c = M.newTaxCase(2025);
  c.civilStatus = 'geschieden'; c.municipality = 'Sevelen';
  c.income1.salaries = [{ ...M.newSalary(), grossSalary: 80000, socialContributions: 5000, pensionContributions: 5000 }];
  c.children = [{ ...M.newChild(), education: 'schule', birthDate: date(2015, 1, 1) }];
  const r = calculate(rules, c);
  assert.equal(r.bill.kind, 'joint');
  eq(resultLine(r, '332').canton, 0);
  eq(resultLine(r, '330').canton, 75000);
  eq(resultLine(r, '334').canton, 20000);
  assert.ok(r.bill.federalChildReduction > 0);
});

test('Gemischte Ehe: Kirchensteuer je zur Hälfte', async () => {
  const rules = await loadRuleBook(2025);
  const c = sampleFamily();
  c.person1.confession = 'roemischKatholisch'; c.person2.confession = 'keine';
  eq(calculate(rules, c).bill.churchRate, 10);
  c.person2.confession = 'evangelischReformiert';
  eq(calculate(rules, c).bill.churchRate, 22);
});

test('Vermögen: Sozialabzüge und Fahrzeug-Abschreibung', async () => {
  const rules = await loadRuleBook(2025);
  const c = sampleFamily();
  c.securities[0].taxValue = 300000;
  c.vehicles = [{ ...M.newVehicle(), purchasePrice: 40000, purchaseYear: 2022 }];
  const r = calculate(rules, c);
  eq(resultLine(r, '306').canton, 16000);
  eq(resultLine(r, '322').canton, 316000);
  eq(resultLine(r, '338').canton, 126000);
  eq(r.bill.simpleWealthTax, (126000 * 1.7) / 1000);
});

test('Säule 3a über dem Maximum wird begrenzt', async () => {
  const rules = await loadRuleBook(2025);
  const c = sampleFamily();
  c.deductions1.pillar3a = 9000;
  const r = calculate(rules, c);
  eq(resultLine(r, '208').canton, 7258);
  assert.ok(r.notices.some((n) => n.id === '3a-max-0'));
});

test('Kapitalleistung wird getrennt besteuert', async () => {
  const rules = await loadRuleBook(2025);
  const c = sampleFamily();
  c.capitalPayments = [{ ...M.newCapitalPayment(), kind: 'saeule3a', amount: 100000 }];
  const t = calculate(rules, c).capitalPaymentTax;
  eq(t.canton, 4460);
  eq(t.federal, 363.2);
});

test('Tipps werden mit echter Ersparnis beziffert', async () => {
  const rules = await loadRuleBook(2025);
  const c = sampleFamily();
  const t = tips(rules, c, calculate(rules, c)).find((x) => x.id === 'tipp-3a-1');
  assert.ok(t && t.saving > 0);
});

test('Verrechnungssteuer-Rückerstattung 35%', async () => {
  const rules = await loadRuleBook(2025);
  const c = sampleFamily();
  c.securities.push({ ...M.newSecurity(), kind: 'wertschrift', taxValue: 10000, incomeWithWithholding: 400 });
  eq(calculate(rules, c).withholdingTaxRefund, 140);
});

test('Steuerjahr 2026: höherer Kilometeransatz', async () => {
  const rules = await loadRuleBook(2026);
  const c = sampleFamily(2026);
  c.deductions1.work = M.newWorkExpenses();
  c.deductions1.work.carKmOneWay = 10; c.deductions1.work.carWorkDays = 200;
  const r = calculate(rules, c);
  eq(resultLine(r, '438').canton, 5400);
  eq(federalOrCanton(resultLine(r, '438')), 5550);
});

// ------------------------------------------------------------ Liechtenstein
test('LI: amtliches Beispiel der Wegleitung 2025', async () => {
  const r = await loadLIRules(2025);
  const land = landessteuer(r, 80000, 'alleinerziehend');
  eq(land, 1694);
  eq(round5Rp((land * 150) / 100), 2541);
});

test('LI: Tarif ohne Sprünge', async () => {
  const r = await loadLIRules(2025);
  for (const kind of ['alleinstehend', 'alleinerziehend', 'verheiratet']) {
    for (const s of r.tarif[kind].slice(0, -1)) {
      const below = landessteuer(r, s.bis, kind), above = landessteuer(r, s.bis + 1, kind);
      assert.ok(Math.abs(above - below) <= 1, `${kind} bei ${s.bis}: ${below} → ${above}`);
    }
  }
});

test('LI: Grundfreibeträge', async () => {
  const r = await loadLIRules(2025);
  eq(landessteuer(r, 15855, 'alleinstehend'), 0);
  eq(landessteuer(r, 23783, 'alleinerziehend'), 0);
  eq(landessteuer(r, 31710, 'verheiratet'), 0);
  eq(landessteuer(r, 120000, 'alleinstehend'), 4399);
  eq(landessteuer(r, 120000, 'verheiratet'), 2792);
});

test('LI: Gemeindezuschläge 2025', async () => {
  const r = await loadLIRules(2025);
  const exp = { Vaduz: 150, Triesen: 150, Balzers: 150, Triesenberg: 150, Schaan: 150, Planken: 150, Eschen: 160, Mauren: 160, Gamprin: 150, Ruggell: 160, Schellenberg: 150 };
  assert.equal(r.gemeinden.length, 11);
  for (const [g, z] of Object.entries(exp)) eq(zuschlag(r, g), z, g);
});

test('LI: Fahrkosten Tabelle und Kilometer', async () => {
  const r = await loadLIRules(2025);
  const k = { ...M.newLICommute(), from: 'Balzers', to: 'Schaan', workDays: 110 };
  eq(commute(r, k), 1335);
  k.workDays = 300; eq(commute(r, k), 2670);
  const a = { ...M.newLICommute(), mode: 'ausland', kmPerDay: 60, workDays: 220 };
  eq(commute(r, a), 6280);
  a.kmPerDay = 500; eq(commute(r, a), 5000 + 34000 * 0.4);
});

test('LI: Gewinnungskosten mindestens die Pauschale', async () => {
  const r = await loadLIRules(2025);
  eq(workCosts(r, 80000, M.newLICommute()).total, 1600);
  eq(workCosts(r, 1000, M.newLICommute()).total, 1000);
  eq(workCosts(r, 0, M.newLICommute()).total, 0);
  eq(workCosts(r, 80000, { ...M.newLICommute(), from: 'Balzers', to: 'Ruggell', mealDays: 220 }).total, 5790);
});

test('LI: ganzer Fall, alleinerziehend mit einem Kind in Vaduz', async () => {
  const r = await loadLIRules(2025);
  const c = M.newTaxCase(2025);
  c.region = 'li'; c.municipality = 'Vaduz'; c.civilStatus = 'geschieden';
  c.children = [{ ...M.newChild(), birthDate: date(2015, 5, 1), education: 'schule' }];
  c.income1.salaries = [{ ...M.newSalary(), grossSalary: 100000, socialContributions: 4700, pensionContributions: 5000 }];
  c.cash = 50000;
  const res = calculateLI(r, c);
  const v = (code) => resultLine(res, code)?.canton ?? -1;
  eq(v('568'), 2000); eq(v('570'), 102000); eq(v('670'), 28400); eq(v('680'), 73600);
  const land = landessteuer(r, 73600, 'alleinerziehend');
  eq(land, 0.04 * 73600 - 1506);
  eq(res.bill.cantonIncome, land);
  eq(res.bill.municipalityIncome, round5Rp((land * 150) / 100));
  eq(res.bill.federal, 0);
});

// 07/11/2026 · Revisión independiente: hijo fuera de casa con pensión y pauschale 10% en obra nueva.
// Valores calculados también con TaxCore (Swift): idénticos.
test('Kind ausser Haus mit Unterhaltsbeiträgen und Neubau-Pauschale (wie Swift)', async () => {
  const M = await import('../app/engine/model.js');
  const { calculate, billTotals } = await import('../app/engine/calculator.js');
  const { loadRuleBook } = await import('../app/engine/rules.js');
  const rules = await loadRuleBook(2025);
  const base = (civil) => { const c = M.newTaxCase(2025); c.civilStatus = civil; c.municipality = 'Sevelen';
    c.person1.firstName = 'P'; c.person1.birthDate = M.dateISO(1980, 1, 1);
    c.income1.salaries = [{ ...M.newSalary(), grossSalary: 90000, socialContributions: 5800, pensionContributions: 4500 }]; return c; };
  const kid = (y, edu, home) => ({ ...M.newChild(), firstName: 'K', birthDate: M.dateISO(y, 5, 1), education: edu, livesInHousehold: home });
  const total = (c) => billTotals(calculate(rules, c).bill).total;
  let c = base('geschieden'); c.children = [kid(2015, 'schule', false)]; c.householdDeductions.alimonyPaidChildren = 12000;
  assert.equal(M.tariffKind(c), 'single'); assert.equal(total(c), 9367.9);
  c = base('geschieden'); c.children = [kid(2015, 'schule', true)]; assert.equal(total(c), 5821.7);
  c = base('geschieden'); c.children = [kid(2015, 'schule', false), kid(2017, 'schule', true)]; c.householdDeductions.alimonyPaidChildren = 12000;
  assert.equal(M.deductibleChildren(c).length, 1); assert.equal(total(c), 3882.95);
  c = base('ledig'); c.children = [kid(2004, 'ausbildung', false)]; assert.equal(M.tariffKind(c), 'single'); assert.equal(total(c), 9505.6);
  c = base('ledig'); c.realEstate = [{ ...M.newRealEstate(), imputedRentalValue: 24000, taxValue: 500000, buildingYear: 2020 }]; assert.equal(total(c), 17896.55);
  c.realEstate[0].buildingYear = 2005; assert.equal(total(c), 17435.6);
});
