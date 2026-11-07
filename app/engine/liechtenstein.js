// Steuerhilfe · Steuerberechnung Liechtenstein (Port von TaxCore/Calc/LiechtensteinCalculator.swift).
// Liefert dasselbe Ergebnis-Format wie der St.Galler Rechner: Landessteuer in «canton»,
// Gemeindesteuer in «municipality», keine Bundessteuer.
import { clean, round, floorTo, nonNeg, sum, round5Rp, chf } from './money.js';
import { isJoint, isSingleParent, deductibleChildren, tariffKind as chTariffKind, liExtras, displayName, persons as personsOf, selfPaid } from './model.js';
import { line, notice, newWorkBreakdown, workTotal, ageAtEndOf } from './calculator.js';

export const zuschlag = (rules, gemeinde) => rules.gemeinden.find((g) => g.name === gemeinde)?.zuschlag ?? null;

/** Amtliche Fahrkosten für 220 Tage zwischen zwei Orten in Liechtenstein. */
export function fahrkostenInland(rules, von, nach) {
  const i = rules.fahrkostenOrte.indexOf(von);
  const j = rules.fahrkostenOrte.indexOf(nach);
  return i < 0 || j < 0 ? null : rules.fahrkostenMatrix[i][j];
}

/** Landessteuer nach Art. 19 SteG. kind: alleinstehend | alleinerziehend | verheiratet */
export function landessteuer(rules, x, kind) {
  const stufen = rules.tarif[kind];
  if (!(x > 0)) return 0;
  const s = stufen.find((st) => st.bis === null || st.bis === undefined || x <= st.bis);
  if (!s) return 0;
  return round5Rp(nonNeg(s.satz * x - s.abzug));
}

export const liTariffKind = (c) => (isJoint(c) ? 'verheiratet' : isSingleParent(c) ? 'alleinerziehend' : 'alleinstehend');

/** Fahrkosten nach Pos. 2 Hilfsformular A2. */
export function commute(rules, k) {
  const days = Math.min(Math.max(k.workDays, 0), rules.fahrMaxTage);
  let gross;
  if (k.mode === 'ausland') {
    const km = Math.min(k.kmPerDay, rules.fahrMaxKmProTag) * days;
    const first = Math.min(km, 10000);
    gross = (first * rules.fahrRappenBis10000) / 100 + ((km - first) * rules.fahrRappenUeber10000) / 100;
  } else {
    const full = fahrkostenInland(rules, k.from, k.to);
    if (full === null) return 0;
    gross = (full * days) / rules.fahrMaxTage;
  }
  return round(nonNeg(gross - k.reimbursed), 0);
}

export const meals = (rules, k) => Math.min(Math.max(k.mealDays, 0) * rules.verpflegungProTag, rules.verpflegungMax);

/** Ziffer 16.1: mindestens die Pauschale (gekürzt, wenn der Lohn kleiner ist). */
export function workCosts(rules, salary, k) {
  if (!(salary > 0)) return { total: 0, breakdown: newWorkBreakdown() };
  const b = newWorkBreakdown();
  b.commute = commute(rules, k);
  b.meals = meals(rules, k);
  const flat = Math.min(rules.gewinnungskostenPauschal, salary);
  if (b.commute + b.meals < flat) b.other = clean(flat - b.commute - b.meals);
  return { total: workTotal(b), breakdown: b };
}

export function vehicleValue(rules, v, year) {
  if (v.taxValueOverride !== undefined && v.taxValueOverride !== null) return v.taxValueOverride;
  const years = Math.max(0, year - (v.purchaseYear ?? year));
  let value = v.purchasePrice;
  for (let i = 0; i < years; i++) value = (value * (100 - rules.fahrzeugAbschreibungProzent)) / 100;
  return round(value, 0);
}

export function calculateLI(rules, c) {
  const li = liExtras(c);
  const notices = [];
  const isLI = (re) => ['FL', 'LI'].includes(String(re.canton).toUpperCase());

  // Vermögen per 1. Januar (Seite 2)
  const estateLI = sum(c.realEstate.filter(isLI), (r) => r.taxValue);
  const estateAbroad = sum(c.realEstate.filter((r) => !isLI(r)), (r) => r.taxValue);
  const accounts = clean(sum(c.securities.filter((s) => ['konto', 'krypto', 'anderes'].includes(s.kind)), (s) => s.taxValue) + c.cash);
  const securities = sum(c.securities.filter((s) => ['wertschrift', 'steuerauszug'].includes(s.kind)), (s) => s.taxValue);
  const loans = sum(c.securities.filter((s) => s.kind === 'darlehen'), (s) => s.taxValue);
  const lifeIns = sum(c.insurances, (p) => p.surrenderValue);
  const goods = li.householdGoods;
  const vehicles = sum(c.vehicles, (v) => vehicleValue(rules, v, c.year));
  const goodsTotal = clean(goods + vehicles);
  const goodsFree = Math.min(goodsTotal, isJoint(c) ? rules.hausratFahrzeugFreibetragVerheiratet : rules.hausratFahrzeugFreibetragUebrige);
  const goodsNet = clean(goodsTotal - goodsFree);
  const totalAssets = clean(estateLI + estateAbroad + c.businessAssets + accounts + securities + loans + lifeIns + c.undividedEstatesWealth + goodsNet + c.otherAssets);
  const debts = sum(c.debts.filter((d) => !d.isBusiness), (d) => d.amount);
  const netWealth = nonNeg(totalAssets - debts);
  const wealthRounded = floorTo(netWealth, 100);
  const sollertrag = round((wealthRounded * rules.sollertragProzent) / 100, 0);

  const wealthLines = [
    line('700', '1.1', 'Grundeigentum in Liechtenstein (Steuerschätzwert)', estateLI, 'income'),
    line('705', '1.2', 'Grundeigentum im Ausland', estateAbroad, 'income', { form: 'Hilfsformular A1' }),
    line('710', '2.1', 'Aktiven in inländischen Betrieben', c.businessAssets, 'income'),
    line('730', '3.1', 'Bank- und Postkontoguthaben, Bargeld', accounts, 'income', { form: 'Hilfsformular A1' }),
    line('735', '3.2', 'Wertschriften, Gold und Edelmetalle', securities, 'income', { form: 'Hilfsformular A1' }),
    line('745', '3.4', 'Darlehens- und Ausschüttungsguthaben', loans, 'income', { form: 'Hilfsformular A1' }),
    line('755', '3.6', 'Rückkaufsfähige Lebensversicherungen', lifeIns, 'income', { form: 'Hilfsformular A1' }),
    line('760', '3.7', 'Unverteilte Erbschaften, Nutzniessung', c.undividedEstatesWealth, 'income'),
    line('769', '3.81', 'Hausrat', goods, 'income'),
    line('770', '3.82', 'Fahrzeuge (35 % Abschreibung pro Jahr)', vehicles, 'income', { form: 'Hilfsformular A1' }),
    line('771', '3.83', 'Total Hausrat und Fahrzeuge', goodsTotal, 'subtotal'),
    line('772', '3.84', './. Freibetrag', goodsFree, 'deduction'),
    line('780', '3.9', 'Übrige Vermögenswerte', c.otherAssets, 'income'),
    line('800', '4', 'Total der Vermögenswerte', totalAssets, 'subtotal'),
    line('820', '5', 'Schulden', debts, 'deduction', { form: 'Hilfsformular A1' }),
    line('880', '6', 'Gesamtvermögen', netWealth, 'total'),
    line('885', '7.1', `Sollertrag: 4 % von ${chf(wealthRounded)}`, sollertrag, 'info',
      { note: 'Das Vermögen wird nicht separat besteuert: 4 % davon zählen als Erwerb (Ziffer 14.6).' }),
  ];

  // Erwerb (Seite 3)
  const p2 = isJoint(c);
  const gross = (i) => sum(i.salaries, (s) => s.grossSalary);
  const sal1 = gross(c.income1), sal2 = p2 ? gross(c.income2) : 0;
  const board1 = c.income1.boardFees, board2 = p2 ? c.income2.boardFees : 0;
  const self1 = clean(c.income1.selfEmployment + c.income1.partnership);
  const self2 = p2 ? clean(c.income2.selfEmployment + c.income2.partnership) : 0;
  const ahv = clean(c.income1.ahvPension + (p2 ? c.income2.ahvPension : 0));
  const pensions = clean(sum(c.income1.pensions, (p) => p.amount) + (p2 ? sum(c.income2.pensions, (p) => p.amount) : 0));
  const allowances = clean(c.income1.dailyAllowances + c.income1.unemployment + (p2 ? c.income2.dailyAllowances + c.income2.unemployment : 0));
  const alimonyIn = clean(c.householdIncome.alimonyReceivedSelf + c.householdIncome.alimonyReceivedChildren);
  const other = clean(c.householdIncome.otherIncome + c.householdIncome.familyAllowancesDirect);
  const income = clean(sal1 + sal2 + board1 + board2 + self1 + self2 + ahv + pensions + allowances + alimonyIn + other + sollertrag);

  const n1 = displayName(c.person1), n2 = displayName(c.person2);
  const incomeLines = [
    line('400', '11.11', `Erwerb gemäss Lohnausweis (brutto) – ${n1}`, sal1, 'income'),
    line('420', '11.31', `Organentschädigungen – ${n1}`, board1, 'income'),
    line('450', '12.11', `Erwerb aus selbständiger Tätigkeit – ${n1}`, self1, 'income', { form: 'Hilfsformular D' }),
  ];
  if (p2) {
    incomeLines.splice(1, 0, line('405', '11.12', `Erwerb gemäss Lohnausweis (brutto) – ${n2}`, sal2, 'income'));
    incomeLines.splice(3, 0, line('425', '11.32', `Organentschädigungen – ${n2}`, board2, 'income'));
    incomeLines.push(line('451', '12.12', `Erwerb aus selbständiger Tätigkeit – ${n2}`, self2, 'income', { form: 'Hilfsformular D' }));
  }
  incomeLines.push(
    line('525', '13.1', 'AHV- und IV-Renten', ahv, 'income'),
    line('530', '13.2', 'Renten aus beruflicher Vorsorge und Pensionen', pensions, 'income'),
    line('538', '13.4', 'Taggelder (ALV, Krankenkasse, Unfallversicherung)', allowances, 'income'),
    line('550', '14.1', 'Unterhaltsbeiträge', alimonyIn, 'income', { form: 'Hilfsformular B' }),
    line('566', '14.5', 'Übriger Erwerb', other, 'income'),
    line('568', '14.6', 'Sollertrag (aus Ziffer 7)', sollertrag, 'income'),
    line('570', '15', 'Total Erwerb', income, 'total'),
  );

  // Abzüge
  const w1 = workCosts(rules, sal1, li.commute1);
  const w2 = p2 ? workCosts(rules, sal2, li.commute2) : { total: 0, breakdown: newWorkBreakdown() };
  const work = clean(w1.total + w2.total);

  const salariesAll = [...c.income1.salaries, ...(p2 ? c.income2.salaries : [])];
  const social = sum(salariesAll, (s) => s.socialContributions);
  const pensionPaid = clean(sum(salariesAll, (s) => s.pensionContributions + s.pensionBuyIn) + c.deductions1.pensionBuyIn + (p2 ? c.deductions2.pensionBuyIn : 0));
  const pensionBase = clean(sal1 + sal2 + board1 + board2 + self1 + self2 + allowances);
  const pensionMax = clean((pensionBase * rules.pensionskasseMaxProzent) / 100);
  const pension = Math.min(pensionPaid, pensionMax);
  if (pensionPaid > pensionMax) {
    notices.push(notice('li-pk-max', 'info', 'Pensionskasse über 18 %', `Abziehbar sind höchstens 18 % des Erwerbs (${chf(pensionMax)}).`, { area: 'abzuege' }));
  }
  const kidsList = deductibleChildren(c);
  const kidPrivate = sum(kidsList, (ch) => {
    const age = ageAtEndOf(ch.birthDate, c.year) ?? 0;
    return age <= 16 ? rules.privatKindBis16 : age <= 20 ? rules.privatKind17bis20 : rules.privatKindAb21;
  });
  const privateIns = clean((p2 ? rules.privatVerheiratet : rules.privatAlleinstehend) + kidPrivate);
  const insurance = clean(social + pension + privateIns);

  const kids = kidsList.length * rules.kinderabzug;
  const hd = c.householdDeductions;
  const alimonyOut = clean(hd.alimonyPaidPartner + hd.alimonyPaidChildren);
  const kidEducation = sum(kidsList.filter((ch) => ch.education === 'ausbildung'), (ch) => Math.min(nonNeg(ch.educationCosts - ch.scholarships), rules.ausbildungKindMax));
  const people = personsOf(c).length + kidsList.length;
  const medical = Math.min(sum(hd.medicalCosts, selfPaid), rules.krankheitMaxProPerson * people);
  const giftBase = nonNeg(income - work);
  const giftsPaid = sum(hd.donations.filter((d) => !d.isPoliticalParty && d.amount >= rules.spendeMinEinzel), (d) => d.amount);
  const gifts = round(Math.min(giftsPaid, (giftBase * rules.spendenMaxProzent) / 100), 0);
  const education = clean(Math.min(c.deductions1.furtherEducation, rules.weiterbildungMax) + (p2 ? Math.min(c.deductions2.furtherEducation, rules.weiterbildungMax) : 0));
  const pensionFree = round((ahv * rules.rentenFreibetragProzent) / 100, 0);

  const deductions = clean(work + insurance + kids + alimonyOut + kidEducation + medical + gifts + education + pensionFree);
  const taxable = floorTo(nonNeg(income - deductions), 10);

  const dedLines = [
    line('580', '16.1', 'Gewinnungskosten (mindestens Pauschale CHF 1’600 pro Person)', work, 'deduction', { form: 'Hilfsformular A2' }),
    line('610', '17', 'Versicherungsbeiträge', insurance, 'deduction',
      { note: `AHV/IV/FAK/ALV/NBU ${chf(social)} · Pensionskasse ${chf(pension)} · private Versicherungen ${chf(privateIns)}`, form: 'Hilfsformular A2' }),
    line('625', '18.1', `Kinderabzug (${kidsList.length} × CHF 12’700)`, kids, 'deduction'),
    line('630', '18.2', 'Unterhaltsbeiträge', alimonyOut, 'deduction', { form: 'Hilfsformular B' }),
    line('635', '18.3', 'Ausbildungskosten für Kinder', kidEducation, 'deduction', { form: 'Hilfsformular A3' }),
    line('640', '18.4', 'Krankheits-, Unfall- und Zahnarztkosten', medical, 'deduction', { form: 'Hilfsformular A2' }),
    line('645', '18.5', 'Freiwillige Geldleistungen', gifts, 'deduction', { form: 'Hilfsformular A2' }),
    line('646', '18.6', 'Berufsorientierte Aus- und Weiterbildung', education, 'deduction', { form: 'Hilfsformular A2' }),
    line('650', '19', 'Freibetrag 70 % auf AHV/IV-Renten', pensionFree, 'deduction'),
    line('670', '20', 'Total der Abzüge', deductions, 'total'),
    line('680', '21', 'Steuerbarer Gesamterwerb', taxable, 'total'),
  ];

  // Steuer
  const land = landessteuer(rules, taxable, liTariffKind(c));
  const z = zuschlag(rules, c.municipality);
  if (z === null) {
    notices.push(notice('li-gemeinde', 'error', 'Gemeinde wählen', 'Bitte die Wohngemeinde in Liechtenstein wählen – der Gemeindezuschlag fehlt.', { area: 'familie' }));
  }
  const rate = z ?? 150;
  const gemeinde = round5Rp((land * rate) / 100);
  if (rules.vorlaeufig) {
    notices.push(notice('li-vorlaeufig', 'info', `Gemeindezuschlag ${rules.jahr} vorläufig`,
      `Die Gemeinden legen den Zuschlag für ${rules.jahr} Ende Jahr fest. Bis dahin rechnet Steuerhilfe mit dem Vorjahr.`));
  }

  const bill = {
    kind: chTariffKind(c), taxableIncomeCanton: taxable, taxableIncomeFederal: 0, taxableWealth: netWealth,
    simpleIncomeTax: land, simpleIncomeRatePercent: taxable > 0 ? round((land / taxable) * 100, 3) : 0, simpleWealthTax: 0,
    cantonRate: 100, municipalityRate: rate, churchRate: 0,
    cantonIncome: land, municipalityIncome: gemeinde, churchIncome: 0, cantonWealth: 0, municipalityWealth: 0, churchWealth: 0,
    federalBeforeChildReduction: 0, federalChildReduction: 0, federal: 0,
  };

  return {
    year: c.year,
    sections: [
      { title: `Vermögen per 1. Januar ${c.year}`, page: 2, lines: wealthLines },
      { title: 'Erwerb im In- und Ausland', page: 3, lines: incomeLines },
      { title: 'Abzüge und steuerfreie Beträge', page: 3, lines: dedLines },
    ],
    bill,
    work: { canton: [w1.breakdown, w2.breakdown] },
    insurance: { canton: { paid: insurance, maximum: insurance, deduction: insurance } },
    withholdingTaxRefund: 0, withholdingIncomeA: 0, capitalPaymentTax: null,
    notices, municipality: null, parish: null,
  };
}
