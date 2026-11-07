// Steuerhilfe · Steuerberechnung St.Gallen + direkte Bundessteuer
// (Port von TaxCore/Calc/Calculator.swift, Results.swift und Checks.swift).
// Jede Zeile trägt die amtliche Ziffer und die E-Tax-Feldnummer wie in der Mac-App.
import { clean, round, nonNeg, clamp, sum, round5Rp, floor5Rp, chf } from './money.js';
import { sgSimpleIncomeTax, sgSimpleIncomeRate, sgSimpleWealthTax, federalIncomeTax, federalIncomeTaxNet } from './tariffs.js';
import { municipalityNamed } from './rules.js';
import { ymd, isJoint, deductibleChildren, tariffKind, netSalary, selfPaid } from './model.js';

// ---------------------------------------------------------------- Ergebnis-Bausteine

/** Eine Zeile der Berechnung. `federal` nur, wenn der Bund anders rechnet. */
export function line(code, ziffer, label, canton, kind, opts = {}) {
  const l = { code, ziffer, label, canton: clean(canton), kind };
  if (opts.federal !== undefined && opts.federal !== null) l.federal = clean(opts.federal);
  if (opts.note) l.note = opts.note;
  if (opts.form) l.form = opts.form;
  return l;
}
export const federalOrCanton = (l) => (l.federal !== undefined ? l.federal : l.canton);
export const differsFederally = (l) => l.federal !== undefined && l.federal !== l.canton;

export const notice = (id, level, title, message, extra = {}) => ({ id, level, title, message, ...extra });

export const newWorkBreakdown = () => ({ commute: 0, commuteUncapped: 0, meals: 0, other: 0, weeklyStay: 0, sideJob: 0 });
export const workTotal = (b) => clean(b.commute + b.meals + b.other + b.weeklyStay + b.sideJob);

/** Hilfsfunktionen für ein Ergebnis */
export const resultFields = (r) => r.sections.flatMap((s) => s.lines).filter((l) => l.code);
export const resultLine = (r, code) => resultFields(r).find((l) => l.code === code) || null;
export const resultValue = (r, code) => resultLine(r, code)?.canton ?? 0;

export function billTotals(b) {
  const cantonTotal = clean(b.cantonIncome + b.cantonWealth);
  const municipalityTotal = clean(b.municipalityIncome + b.municipalityWealth);
  const churchTotal = clean(b.churchIncome + b.churchWealth);
  const cantonAndMunicipalityTotal = clean(cantonTotal + municipalityTotal + churchTotal);
  return {
    cantonTotal, municipalityTotal, churchTotal, cantonAndMunicipalityTotal,
    total: clean(cantonAndMunicipalityTotal + b.federal),
    totalRate: clean(b.cantonRate + b.municipalityRate + b.churchRate),
  };
}

// ---------------------------------------------------------------- Alter

/** Alter am 31. Dezember des Jahres. */
export function ageAtEndOf(birthISO, year) {
  const b = ymd(birthISO);
  return b ? year - b.y : null;
}

/** Vorschlag Kinder-Kategorie (Kanton SG: Kindergarten ab 4 Jahren, Stichtag 31. Juli). */
/** Pauschale Liegenschaftsunterhalt: 10% bis 10 Jahre alt (zu Beginn der Steuerperiode), sonst 20%. Wie Swift. */
export function flatMaintenanceRate(re, year, rules) {
  const built = Number(re.buildingYear);
  if (built > 1000 && year - built <= 10) return rules.pauschalabzugSatzNeubau ?? 0.10;
  return rules.pauschalabzugSatz;
}

export function suggestedEducation(birthISO, year) {
  const b = ymd(birthISO);
  if (!b) return 'schule';
  const cutoff = [year - 4, 7, 31];
  const after = b.y > cutoff[0] || (b.y === cutoff[0] && (b.m > cutoff[1] || (b.m === cutoff[1] && b.d > cutoff[2])));
  if (after) return 'vorschule';
  return (ageAtEndOf(birthISO, year) ?? 0) >= 16 ? 'ausbildung' : 'schule';
}

// ---------------------------------------------------------------- Berufskosten (Formular 4)

export function workExpenses(w, salaries, p) {
  const r = newWorkBreakdown();
  const main = salaries.filter((s) => s.isMainEmployment);
  const side = salaries.filter((s) => !s.isMainEmployment);
  const mainNet = sum(main, netSalary);
  const sideNet = sum(side, netSalary);
  if (!(mainNet > 0) && !(sideNet > 0)) return r;

  if (mainNet > 0) {
    const freeTransport = main.some((s) => s.fieldF);
    if (!freeTransport) {
      let commute = nonNeg(w.publicTransportCost);
      if (w.useBicycle) commute += Math.min(nonNeg(w.bicycleCost), p.veloMax);
      if (w.carKmOneWay > 0 && w.carWorkDays > 0) {
        const days = Math.min(w.carWorkDays, p.arbeitstageMax);
        const rate = w.carIsMotorbike ? p.motorradProKm : p.autoProKm;
        commute += round(w.carKmOneWay * w.carTripsPerDay * days * rate, 0);
      }
      r.commuteUncapped = clean(commute);
      r.commute = Math.min(clean(commute), p.fahrkostenMax);
    }
    const canteen = main.some((s) => s.fieldG);
    const days = Math.min(Math.max(w.mealDays, 0), p.arbeitstageMax);
    switch (w.meals) {
      case 'auswaerts':
        r.meals = canteen ? Math.min(clean(days * p.verpflegungVerbilligtProTag), p.verpflegungVerbilligtMax)
                          : Math.min(clean(days * p.verpflegungProTag), p.verpflegungMax);
        break;
      case 'verbilligt': r.meals = Math.min(clean(days * p.verpflegungVerbilligtProTag), p.verpflegungVerbilligtMax); break;
      case 'schicht': r.meals = Math.min(clean(days * p.schichtProTag), p.schichtMax); break;
      default: break;
    }
    const hasFlatExpenses = main.some((s) => s.flatRateExpenses > 0);
    if (w.useActualOtherCosts) {
      r.other = nonNeg(w.actualOtherCosts);
    } else if (!hasFlatExpenses) {
      const pauschal = p.uebrigePauschalBasis + mainNet * p.uebrigePauschalSatz;
      r.other = round(clamp(clean(pauschal), p.uebrigePauschalMin, p.uebrigePauschalMax), 0);
      if (p.uebrigePauschalMin > 0) r.other = Math.min(r.other, mainNet);
    }
    if (w.weeklyStay) {
      const room = clamp(w.weeklyStayRoomPerMonth, 0, p.wochenaufenthaltZimmerMaxProMonat) * Math.max(w.weeklyStayMonths, 0);
      const d = Math.max(w.weeklyStayDays, 0);
      const food = w.weeklyStayMealsReduced
        ? Math.min(clean(d * p.wochenaufenthaltVerpflegungVerbilligtProTag), p.wochenaufenthaltVerpflegungVerbilligtMax)
        : Math.min(clean(d * p.wochenaufenthaltVerpflegungProTag), p.wochenaufenthaltVerpflegungMax);
      r.weeklyStay = clean(room + food);
    }
  }
  if (sideNet > 0) {
    if (w.sideJobUseActual) r.sideJob = Math.min(nonNeg(w.sideJobActualCosts), sideNet);
    else if (sideNet <= p.nebenerwerbMin) r.sideJob = sideNet;
    else r.sideJob = round(clamp(clean(sideNet * p.nebenerwerbSatz), p.nebenerwerbMin, p.nebenerwerbMax), 0);
  }
  return r;
}

// ---------------------------------------------------------------- Hauptberechnung

export function calculate(rules, c) {
  const kp = rules.cantonal;
  const bp = rules.federal;
  const ex = rules.cantonalExtra;
  const joint = isJoint(c);
  const notices = [];

  const persons = joint
    ? [[c.person1, c.income1, c.deductions1], [c.person2, c.income2, c.deductions2]]
    : [[c.person1, c.income1, c.deductions1]];
  const childrenDeductible = deductibleChildren(c);
  const childCount = childrenDeductible.length;

  // ---------------- Seite 2: Einkünfte ----------------
  const income = [];
  const personLine = (codes, ziffer, label, value, form) => {
    persons.forEach(([, inc], i) => income.push(line(codes[i], ziffer, `${label} – Person ${i + 1}`, value(inc), 'income', { form })));
  };
  personLine(['100', '102'], '1.1', 'Haupterwerb (Nettolohn)', (inc) => sum(inc.salaries.filter((s) => s.isMainEmployment), netSalary), 'Lohnausweis');
  personLine(['104', '106'], '1.2', 'Nebenerwerb (Nettolohn)', (inc) => sum(inc.salaries.filter((s) => !s.isMainEmployment), netSalary), 'Lohnausweis');
  personLine(['108', '110'], '1.3', 'Sitzungsgelder, VR-Honorare', (inc) => inc.boardFees);
  personLine(['112', '114'], '2.1', 'Selbständige Erwerbstätigkeit', (inc) => inc.selfEmployment);
  personLine(['120', '122'], '2.2', 'Kollektiv-/Kommanditgesellschaften', (inc) => inc.partnership);
  personLine(['126', '128'], '3.1', 'AHV/IV-Renten', (inc) => inc.ahvPension, 'Bescheinigung');
  personLine(['130', '132'], '3.2', 'Renten / Pensionen (steuerbarer Teil)', (inc) => sum(inc.pensions, (p) => round((p.amount * p.taxablePercent) / 100, 0)), 'Bescheinigung');
  personLine(['134', '136'], '3.3', 'Erwerbsausfall / Taggelder', (inc) => inc.dailyAllowances, 'Bescheinigung');
  personLine(['138', '140'], '3.4', 'Arbeitslosentaggelder', (inc) => inc.unemployment, 'Bescheinigung');
  income.push(line('142', '3.5', 'Direkt ausbezahlte Familienzulagen', c.householdIncome.familyAllowancesDirect, 'income'));

  // Wertschriften (Formular 2)
  const privateSecurities = c.securities.filter((s) => s.code !== 'G' && s.code !== 'BG');
  const nonBP = privateSecurities.filter((s) => s.code !== 'BP');
  const incomeA = sum(nonBP, (s) => s.incomeWithWithholding);
  const incomeB = sum(nonBP, (s) => s.incomeWithoutWithholding);
  const bpIncome = clean(sum(privateSecurities.filter((s) => s.code === 'BP'), (s) => s.incomeWithWithholding + s.incomeWithoutWithholding)
    + c.householdIncome.qualifiedParticipationIncome);
  const securitiesIncome = clean(incomeA + incomeB);
  income.push(line('146', '4.1', 'Erträge aus Wertschriften und Guthaben', securitiesIncome, 'income', { form: 'Formular 2' }));
  income.push(line('147', '4.2', 'Erträge aus Beteiligungen ab 10% (Privatvermögen)', bpIncome, 'income', { form: 'Formular 2' }));
  const partialTaxation = round(bpIncome * 0.3, 0);
  income.push(line('150', '4.4', 'Abzug Teilbesteuerung Beteiligungserträge (30%)', -partialTaxation, 'income'));

  // Liegenschaften (Formular 7)
  let propertyIncome = 0, propertyCosts = 0, propertyValue = 0;
  for (const re of c.realEstate) {
    let eigen = 0;
    if (re.use !== 'vermietet') {
      eigen = re.imputedRentalValue;
      if (re.isPrimaryResidence) eigen -= round(eigen * ex.liegenschaften.eigenmietwertReduktion, 0);
      if (re.isPrimaryResidence && re.unusedRooms > 0 && re.rooms > 0) {
        eigen -= round((eigen * re.unusedRooms) / (re.rooms + 2), 0);
      }
    }
    const gross = clean(eigen + re.rentalIncome);
    propertyIncome += gross;
    propertyCosts += re.useFlatRateMaintenance ? round(gross * flatMaintenanceRate(re, c.year, ex.liegenschaften), 0) : re.actualMaintenanceCosts;
    propertyValue += re.taxValue;
  }
  propertyIncome = clean(propertyIncome); propertyCosts = clean(propertyCosts); propertyValue = clean(propertyValue);
  if (c.realEstate.length) {
    notices.push(notice('eigenmietwert-bund', 'info', 'Eigenmietwert Bundessteuer',
      'Die Berechnung verwendet für die Bundessteuer denselben Eigenmietwert wie für den Kanton. Die Veranlagungsbehörde nimmt allfällige Anpassungen von Amtes wegen vor.', { area: 'vermoegen' }));
  }
  const hi = c.householdIncome;
  income.push(line('712', '5', 'Ertrag aus Liegenschaften', propertyIncome, 'income', { form: 'Formular 7' }));
  income.push(line('154', '6.1', 'Unterhaltsbeiträge für sich', hi.alimonyReceivedSelf, 'income'));
  income.push(line('156', '6.1', 'Unterhaltsbeiträge für minderjährige Kinder', hi.alimonyReceivedChildren, 'income'));
  income.push(line('158', '6.2', 'Ertrag aus unverteilten Erbschaften', hi.undividedEstates, 'income'));
  income.push(line('162', '6.3', 'Übrige Einkünfte', hi.otherIncome, 'income', { note: hi.otherIncomeDescription || undefined }));
  const totalIncome = sum(income.filter((l) => l.kind === 'income'), (l) => l.canton);
  income.push(line('168', '7', 'Total der Einkünfte', totalIncome, 'total'));
  if (hi.simplifiedSettlementIncome > 0) {
    income.push(line('290', '8.1', 'Vereinfacht abgerechnete Einkünfte (nur Information)', hi.simplifiedSettlementIncome, 'info'));
  }

  // ---------------- Seite 3: Abzüge ----------------
  const ded = [];
  let dedK = 0, dedB = 0;
  const addDed = (code, z, label, k, b, opts = {}) => {
    const bv = b === undefined || b === null ? k : b;
    ded.push(line(code, z, label, k, 'deduction', { ...opts, federal: b === undefined || b === null ? undefined : bv }));
    dedK = clean(dedK + k); dedB = clean(dedB + bv);
  };

  // 10. Berufskosten
  const workK = [], workB = [];
  persons.forEach(([, inc, d], i) => {
    const k = workExpenses(d.work, inc.salaries, kp.berufskosten);
    const b = workExpenses(d.work, inc.salaries, bp.berufskosten);
    workK.push(k); workB.push(b);
    addDed(i === 0 ? '438' : '488', i === 0 ? '10.1' : '10.2', `Berufskosten Person ${i + 1}`, workTotal(k), workTotal(b), { form: 'Formular 4' });
  });

  // 11. Schuldzinsen
  const privateInterest = sum(c.debts.filter((d) => !d.isBusiness), (d) => d.interest);
  const interestCap = clean(securitiesIncome + bpIncome + propertyIncome + kp.privateSchuldzinsenZuschlag);
  const interest = Math.min(privateInterest, interestCap);
  if (privateInterest > interestCap) {
    notices.push(notice('schuldzinsen-limit', 'warning', 'Schuldzinsen begrenzt',
      `Private Schuldzinsen sind nur bis zum Vermögensertrag plus Fr. 50’000 abziehbar. Abgezogen werden ${chf(interest)}.`, { area: 'vermoegen' }));
  }
  addDed('500', '11', 'Schuldzinsen', interest, undefined, { form: 'Formular 5' });

  // 12. Unterhaltsbeiträge
  const hd = c.householdDeductions;
  addDed('200', '12.1', 'Unterhaltsbeiträge an Geschiedene/Getrennte', hd.alimonyPaidPartner);
  addDed('202', '12.2', 'Unterhaltsbeiträge für minderjährige Kinder', hd.alimonyPaidChildren);
  addDed('204', '12.3', 'Rentenleistungen', hd.annuityPayments);

  // 13. Vorsorge
  let has3aOrBVG = false;
  persons.forEach(([person, inc, d], i) => {
    const earned = clean(sum(inc.salaries, netSalary) + inc.selfEmployment + inc.partnership + inc.boardFees);
    const max3a = person.hasPensionFund ? kp.saeule3a.mitPensionskasse
      : Math.min(round(earned * kp.saeule3a.ohnePensionskasseSatz, 0), kp.saeule3a.ohnePensionskasseMax);
    let paid3a = nonNeg(d.pillar3a);
    if (earned <= 0 && paid3a > 0) {
      notices.push(notice(`3a-ohne-erwerb-${i}`, 'warning', 'Säule 3a ohne Erwerbseinkommen',
        `Beiträge an die Säule 3a sind nur mit AHV-pflichtigem Erwerbseinkommen abziehbar (Person ${i + 1}).`, { area: 'abzuege' }));
      paid3a = 0;
    }
    const a3 = Math.min(paid3a, max3a);
    if (d.pillar3a > max3a) {
      notices.push(notice(`3a-max-${i}`, 'warning', 'Säule 3a über Maximum',
        `Person ${i + 1}: Abziehbar sind höchstens ${chf(max3a)}. Der Mehrbetrag muss zurückgefordert werden.`, { area: 'abzuege' }));
    }
    addDed(i === 0 ? '208' : '210', '13.1', `Säule 3a Person ${i + 1}`, a3, undefined, { form: 'Bescheinigung' });
    if (c.year >= 2026 && d.pillar3aBuyIn > 0) {
      const buyIn = Math.min(d.pillar3aBuyIn, kp.saeule3a.mitPensionskasse);
      addDed(i === 0 ? '212' : '214', '13.1', `Einkauf Säule 3a Person ${i + 1}`, buyIn, undefined, { form: 'Bescheinigung' });
      if (d.pillar3aBuyIn > buyIn) {
        notices.push(notice(`3a-einkauf-${i}`, 'warning', 'Einkauf Säule 3a begrenzt',
          'Ein 3a-Einkauf ist pro Jahr höchstens im Umfang des kleinen 3a-Maximums abziehbar.', { area: 'abzuege' }));
      }
    }
    const bvgBuyIn = nonNeg(d.pensionBuyIn);
    addDed(i === 0 ? '218' : '219', '13.2', `Säule 2 (BVG) Einkäufe Person ${i + 1}`, bvgBuyIn, undefined, { form: 'Bescheinigung' });
    const bvgFromSalary = clean(sum(inc.salaries, (s) => s.pensionContributions) + sum(inc.salaries, (s) => s.pensionBuyIn));
    if (a3 > 0 || bvgBuyIn > 0 || bvgFromSalary > 0 || (person.hasPensionFund && earned > 0)) has3aOrBVG = true;
  });

  // 14. Versicherungsprämien und Sparzinsen (Formular 6)
  const savingsInterest = sum(privateSecurities.filter((s) => s.kind === 'konto' && s.isSavingsAccount), (s) => s.incomeWithWithholding + s.incomeWithoutWithholding);
  const premiumsPaid = nonNeg(hd.healthInsurancePremiums + hd.accidentInsurancePremiums + hd.lifeInsurancePremiums + savingsInterest - hd.premiumReduction);
  const insuranceMax = (v) => {
    const base = joint ? v.gemeinsam : v.alleinstehend;
    const extra = has3aOrBVG ? 0 : (joint ? v.zuschlagOhneVorsorgeGemeinsam : v.zuschlagOhneVorsorgeAlleinstehend);
    return clean(base + extra + childCount * v.proKind + hd.supportedPersons * v.proUnterstuetztePerson);
  };
  const insK = { paid: premiumsPaid, maximum: insuranceMax(kp.versicherungen) };
  const insB = { paid: premiumsPaid, maximum: insuranceMax(bp.versicherungen) };
  insK.deduction = Math.min(insK.paid, insK.maximum);
  insB.deduction = Math.min(insB.paid, insB.maximum);
  addDed('600', '14', 'Versicherungsprämien und Sparzinsen', insK.deduction, insB.deduction, { form: 'Formular 6' });

  // 15. Liegenschaftsunterhalt
  addDed('716', '15', 'Unterhalts- und Verwaltungskosten Liegenschaften', propertyCosts, undefined, { form: 'Formular 7' });

  // 16.1 Verwaltungskosten Wertschriften
  const managed = sum(privateSecurities.filter((s) => s.managedByThirdParty), (s) => s.taxValue);
  const flatAdmin = Math.min(round((managed * kp.verwaltungskostenPromille) / 1000, 0), kp.verwaltungskostenMax);
  const hasActualAdmin = hd.actualAssetManagementCosts !== undefined && hd.actualAssetManagementCosts !== null;
  const adminCosts = hasActualAdmin ? hd.actualAssetManagementCosts : flatAdmin;
  addDed('220', '16.1', 'Verwaltungskosten Wertschriften', adminCosts, undefined,
    { note: !hasActualAdmin && flatAdmin > 0 ? 'Pauschale 2‰ des fremdverwalteten Wertschriftenvermögens' : undefined });

  // 16.2 Kinderbetreuung
  const childcare = (p) => sum(c.children.filter((ch) => {
    if (!ch.livesInHousehold) return false;
    const age = ageAtEndOf(ch.birthDate, c.year - 1);
    return age === null ? true : age < p.kinderbetreuungAltersgrenze;
  }), (ch) => Math.min(nonNeg(ch.childcareCosts - ch.childcareDaysWithMealsIncluded * p.kinderbetreuungVerpflegungKuerzungProTag), p.kinderbetreuungMax));
  addDed('258', '16.2', 'Kinderbetreuungskosten bei Drittbetreuung', childcare(kp), childcare(bp), { form: 'Formular 10' });

  // 16.3 Parteispenden
  const party = sum(hd.donations.filter((d) => d.isPoliticalParty), (d) => d.amount);
  addDed('555', '16.3', 'Parteispenden',
    Math.min(party, joint ? kp.parteispendenGemeinsam : kp.parteispendenAlleinstehend),
    Math.min(party, joint ? bp.parteispendenGemeinsam : bp.parteispendenAlleinstehend), { form: 'Formular 5' });

  // 16.4 Aus- und Weiterbildung
  persons.forEach(([person, inc, d], i) => {
    let k;
    if (d.furtherEducationFlatRate && d.furtherEducation <= kp.weiterbildungPauschal
      && person.employment === 'unselbstaendig' && inc.salaries.some((s) => s.isMainEmployment)) {
      k = kp.weiterbildungPauschal;
    } else {
      k = Math.min(d.furtherEducation, kp.weiterbildungMax);
    }
    const b = Math.min(d.furtherEducation, bp.weiterbildungMax);
    addDed(i === 0 ? '223' : '224', '16.4', `Berufsorientierte Aus-/Weiterbildung Person ${i + 1}`, k, b);
  });

  // 16.5 Übrige Abzüge
  addDed('222', '16.5', 'Übrige Abzüge', hd.otherDeductions, undefined, { note: hd.otherDeductionsDescription || undefined });

  // 17. Zweiverdienerabzug
  let zweiK = 0, zweiB = 0;
  if (joint) {
    const earnedOf = (i) => {
      const [, inc, d] = persons[i];
      const gross = clean(sum(inc.salaries, netSalary) + inc.selfEmployment + inc.partnership + inc.boardFees);
      const pension = clean(Math.min(d.pillar3a, kp.saeule3a.ohnePensionskasseMax) + d.pensionBuyIn);
      return [nonNeg(gross - workTotal(workK[i]) - pension), nonNeg(gross - workTotal(workB[i]) - pension)];
    };
    const e1 = earnedOf(0), e2 = earnedOf(1);
    const earnsSomething = (inc) => clean(sum(inc.salaries, netSalary) + inc.selfEmployment + inc.partnership) > 0;
    const bothEarn = earnsSomething(persons[0][1]) && earnsSomething(persons[1][1]);
    if (bothEarn || hd.significantCooperation) {
      zweiK = kp.zweiverdiener.betrag;
      const lower = Math.min(e1[1], e2[1]);
      zweiB = bothEarn
        ? Math.min(Math.max(round(lower * bp.zweiverdiener.satz, 0), Math.min(bp.zweiverdiener.min, lower)), bp.zweiverdiener.max)
        : bp.zweiverdiener.min;
    }
  }
  addDed('226', '17', 'Zweiverdienerabzug', zweiK, zweiB);
  ded.push(line('230', '18', 'Total der Abzüge', dedK, 'total', { federal: dedB }));

  // ---------------- Einkommensberechnung ----------------
  const calc = [];
  const netK = clean(totalIncome - dedK);
  const netB = clean(totalIncome - dedB);
  calc.push(line('234', '20', 'Nettoeinkommen', netK, 'subtotal', { federal: netB }));

  // 21.1 Krankheitskosten
  const medical = clean(sum(hd.medicalCosts.filter((m) => !m.isDisabilityRelated), selfPaid) + (hd.dietFlatRate ? kp.diaetPauschale : 0));
  const sbK = round(nonNeg(netK) * kp.krankheitSelbstbehaltSatz, 0);
  const sbB = round(nonNeg(netB) * bp.krankheitSelbstbehaltSatz, 0);
  const medK = nonNeg(medical - sbK);
  const medB = nonNeg(medical - sbB);
  calc.push(line('650', '21.1', 'Krankheits- und Unfallkosten (Total)', medical, 'info', { form: 'Formular 6' }));
  calc.push(line('238', '21.1', 'abzüglich Selbstbehalt', -sbK, 'info', { federal: -sbB, note: 'Kanton 2%, Bund 5% des Nettoeinkommens' }));
  calc.push(line('240', '21.1', 'Abzug Krankheits- und Unfallkosten', medK, 'deduction', { federal: medB }));
  if (medical > 0 && medK === 0) {
    notices.push(notice('krankheit-selbstbehalt', 'info', 'Krankheitskosten unter dem Selbstbehalt',
      `Die selbst bezahlten Krankheitskosten (${chf(medical)}) liegen unter dem Selbstbehalt von ${chf(sbK)}. Es ergibt sich kein Abzug.`, { area: 'abzuege' }));
  }

  // 21.2 Behinderungsbedingte Kosten
  const disability = clean(sum(hd.medicalCosts.filter((m) => m.isDisabilityRelated), selfPaid) + hd.disabilityFlatRate);
  calc.push(line('235', '21.2', 'Behinderungsbedingte Kosten', disability, 'deduction', { form: 'Formular 6' }));

  // 21.3 Freiwillige Zuwendungen
  const gifts = sum(hd.donations.filter((d) => !d.isPoliticalParty), (d) => d.amount);
  const giftDeduction = (p, net) => (gifts >= p.freiwilligeZuwendungenMin ? Math.min(gifts, round(nonNeg(net) * p.freiwilligeZuwendungenMaxSatz, 0)) : 0);
  const giftK = giftDeduction(kp, netK), giftB = giftDeduction(bp, netB);
  calc.push(line('244', '21.3', 'Freiwillige Zuwendungen', giftK, 'deduction', { federal: giftB, form: 'Formular 5' }));
  if (gifts > 0 && gifts < kp.freiwilligeZuwendungenMin) {
    notices.push(notice('spenden-min', 'info', 'Spenden unter Fr. 100', 'Freiwillige Zuwendungen sind erst ab gesamthaft Fr. 100 pro Jahr abziehbar.', { area: 'abzuege' }));
  }

  const reinK = clean(netK - medK - disability - giftK);
  const reinB = clean(netB - medB - disability - giftB);
  calc.push(line('248', '22', 'Reineinkommen', reinK, 'subtotal', { federal: reinB }));

  // 23. Sozialabzüge
  const pre = childrenDeductible.filter((ch) => ch.education === 'vorschule').length;
  const schoolKids = childrenDeductible.filter((ch) => ch.education === 'schule' || ch.education === 'ausbildung');
  const school = schoolKids.length;
  const childK1 = pre * kp.kinderabzugVorschule;
  const childK2 = school * kp.kinderabzugAusbildung;
  const childB = childCount * bp.kinderabzugEinheitlich;
  const eduK = sum(schoolKids, (ch) => Math.min(nonNeg(ch.educationCosts - kp.ausbildungskostenSelbstbehalt - ch.scholarships), kp.ausbildungskostenMax));
  calc.push(line('252', '23.1', `Kinderabzug Vorschulalter (${pre} × ${chf(kp.kinderabzugVorschule)})`, childK1, 'deduction', { federal: pre * bp.kinderabzugEinheitlich }));
  calc.push(line('254', '23.2', `Kinderabzug Schule/Ausbildung (${school} × ${chf(kp.kinderabzugAusbildung)})`, childK2, 'deduction', { federal: school * bp.kinderabzugEinheitlich }));
  calc.push(line('256', '23.3', 'Ausbildungskosten für Kinder', eduK, 'deduction', { federal: 0, form: 'Formular 10' }));
  const supportB = hd.supportedPersons * bp.unterstuetzungsabzug;
  calc.push(line('264', '23.4', 'Abzug für unterstützte Personen (nur Bund)', 0, 'deduction', { federal: supportB }));
  const marriedB = joint ? bp.verheiratetenabzug : 0;
  calc.push(line('', '', 'Verheiratetenabzug (nur Bund)', 0, 'deduction', { federal: marriedB }));
  if (hd.alimonyPaidChildren > 0 && deductibleChildren(c).some((ch) => ch.livesInHousehold !== false)) {
    notices.push(notice('kinderabzug-unterhalt', 'warning', 'Kinderabzug und Unterhaltsbeiträge',
      'Sie ziehen Unterhaltsbeiträge für Kinder ab. Für ein Kind, das nicht bei Ihnen wohnt, gibt es dafür keinen Kinderabzug: Schalten Sie bei diesem Kind «Lebt in meinem Haushalt» aus.', { area: 'familie' }));
  }
  const taxableK = nonNeg(reinK - childK1 - childK2 - eduK);
  const taxableB = nonNeg(reinB - childB - supportB - marriedB);
  calc.push(line('268', '24', 'Steuerbares Einkommen', taxableK, 'total', { federal: taxableB }));

  // ---------------- Seite 4: Vermögen ----------------
  const wealth = [];
  const securitiesValue = sum(privateSecurities, (s) => s.taxValue);
  wealth.push(line('300', '30.1', 'Wertschriften und Guthaben', securitiesValue, 'income', { form: 'Formular 2' }));
  wealth.push(line('302', '30.2', 'Bargeld, Gold und Edelmetalle', c.cash, 'income'));
  const insuranceValue = sum(c.insurances, (p) => p.surrenderValue);
  wealth.push(line('304', '30.3', 'Lebens- und Rentenversicherungen (Rückkaufswert)', insuranceValue, 'income', { form: 'Bescheinigung' }));
  const vehicleValue = sum(c.vehicles, (v) => {
    if (v.taxValueOverride !== undefined && v.taxValueOverride !== null) return v.taxValueOverride;
    const years = Math.max(0, c.year - (v.purchaseYear ?? c.year));
    return round(nonNeg(v.purchasePrice * (1 - ex.fahrzeugAbschreibungProJahr * years)), 0);
  });
  wealth.push(line('306', '30.4', 'Motorfahrzeuge', vehicleValue, 'income', { note: 'Kaufpreis abzüglich 20% pro Jahr seit Erwerb' }));
  wealth.push(line('308', '30.5', 'Anteile an unverteilten Erbschaften', c.undividedEstatesWealth, 'income'));
  wealth.push(line('310', '30.6', 'Übrige Vermögenswerte', c.otherAssets, 'income'));
  wealth.push(line('710', '31', 'Liegenschaften', propertyValue, 'income', { form: 'Formular 7' }));
  wealth.push(line('316', '32.2', 'Betriebsvermögen', c.businessAssets, 'income'));
  const grossWealth = clean(securitiesValue + c.cash + insuranceValue + vehicleValue + c.undividedEstatesWealth + c.otherAssets + propertyValue + c.businessAssets);
  wealth.push(line('322', '33', 'Total der Vermögenswerte', grossWealth, 'subtotal'));
  const privateDebts = sum(c.debts.filter((d) => !d.isBusiness), (d) => d.amount);
  const businessDebts = sum(c.debts.filter((d) => d.isBusiness), (d) => d.amount);
  wealth.push(line('504', '34.1', 'Privatschulden', privateDebts, 'deduction', { form: 'Formular 5' }));
  wealth.push(line('506', '34.2', 'Geschäftsschulden', businessDebts, 'deduction', { form: 'Formular 5' }));
  const netWealth = clean(grossWealth - privateDebts - businessDebts);
  wealth.push(line('326', '35', 'Reinvermögen', netWealth, 'subtotal'));
  const minorChildren = deductibleChildren(c).filter((ch) => {
    const a = ageAtEndOf(ch.birthDate, c.year);
    return a === null ? true : a < 18;
  }).length;
  const socialSingle = joint ? 0 : ex.vermoegen.sozialabzugProPerson;
  const socialJoint = joint ? ex.vermoegen.sozialabzugProPerson * 2 : 0;
  const socialKids = minorChildren * ex.vermoegen.sozialabzugProKind;
  wealth.push(line('330', '36.1', 'Abzug für alleinstehende Steuerpflichtige', socialSingle, 'deduction'));
  wealth.push(line('332', '36.2', 'Abzug für gemeinsam steuerpflichtige Ehegatten', socialJoint, 'deduction'));
  wealth.push(line('334', '36.3', `Abzug für minderjährige Kinder (${minorChildren} × ${chf(ex.vermoegen.sozialabzugProKind)})`, socialKids, 'deduction'));
  const taxableWealth = nonNeg(netWealth - socialSingle - socialJoint - socialKids);
  wealth.push(line('338', '37', 'Steuerbares Vermögen', taxableWealth, 'total'));
  const capitalTotal = sum(c.capitalPayments, (p) => p.amount);
  if (capitalTotal > 0) wealth.push(line('950', '41', 'Total Kapitalleistungen aus Vorsorge', capitalTotal, 'info'));

  // ---------------- Steuerberechnung ----------------
  const municipality = municipalityNamed(rules.municipalities, c.municipality);
  if (!municipality) {
    notices.push(notice('gemeinde', 'error', 'Gemeinde unbekannt',
      `Die Gemeinde «${c.municipality}» ist nicht in der Steuerfuss-Liste ${c.year} enthalten.`, { area: 'familie' }));
  }
  const parish = municipality ? (municipality.parishes.find((p) => p.name === c.parish) || municipality.parishes[0] || null) : null;
  const bill = computeBill(rules, c, taxableK, taxableB, taxableWealth, municipality, parish, childCount + hd.supportedPersons);

  // Kapitalleistungen (getrennt besteuert)
  let capitalPaymentTax = null;
  if (capitalTotal > 0) {
    const rate = tariffKind(c) === 'joint' ? ex.kapitalleistung.satzGemeinsam : ex.kapitalleistung.satzAlleinstehend;
    const simple = capitalTotal * rate;
    const cantonal = round5Rp((simple * billTotals(bill).totalRate) / 100);
    const fed = floor5Rp(federalIncomeTax(capitalTotal, tariffKind(c), rules.federalRules.tarif) * rules.federalRules.kapitalleistungAnteil);
    capitalPaymentTax = { amount: capitalTotal, canton: cantonal, federal: fed, total: clean(cantonal + fed) };
  }

  const withholdingTaxRefund = round(incomeA * ex.verrechnungssteuerSatz, 2);

  const result = {
    year: c.year,
    sections: [
      { title: 'Einkünfte', page: 2, lines: income },
      { title: 'Abzüge', page: 3, lines: ded },
      { title: 'Einkommensberechnung', page: 3, lines: calc },
      { title: 'Vermögen', page: 4, lines: wealth },
    ],
    bill,
    work: { canton: workK, federal: workB },
    insurance: { canton: insK, federal: insB },
    withholdingTaxRefund, withholdingIncomeA: incomeA,
    capitalPaymentTax,
    notices,
    municipality, parish,
  };
  result.notices.push(...validate(c, result, rules));
  return result;
}

// ---------------------------------------------------------------- Steuerbetrag

export function computeBill(rules, c, taxableIncomeCanton, taxableIncomeFederal, taxableWealth, municipality, parish, childCount) {
  const kind = tariffKind(c);
  const simple = sgSimpleIncomeTax(taxableIncomeCanton, kind, rules.sgTariff);
  const rate = clean(sgSimpleIncomeRate(taxableIncomeCanton, kind, rules.sgTariff) * 100);
  const simpleWealth = sgSimpleWealthTax(taxableWealth, rules.cantonalExtra.vermoegen.einfacheSteuerPromille);
  const kanton = rules.municipalities.kantonSteuerfuss;
  const gemeinde = municipality?.steuerfuss ?? 0;
  const church = churchRate(rules, c, parish);
  const part = (s, r) => round5Rp((s * r) / 100);
  const fedGross = federalIncomeTax(taxableIncomeFederal, kind, rules.federalRules.tarif);
  const fedNet = federalIncomeTaxNet(taxableIncomeFederal, kind, childCount, rules.federalRules.tarif);
  return {
    kind, taxableIncomeCanton, taxableIncomeFederal, taxableWealth,
    simpleIncomeTax: simple, simpleIncomeRatePercent: rate, simpleWealthTax: simpleWealth,
    cantonRate: kanton, municipalityRate: gemeinde, churchRate: church,
    cantonIncome: part(simple, kanton), municipalityIncome: part(simple, gemeinde), churchIncome: part(simple, church),
    cantonWealth: part(simpleWealth, kanton), municipalityWealth: part(simpleWealth, gemeinde), churchWealth: part(simpleWealth, church),
    federalBeforeChildReduction: fedGross, federalChildReduction: clean(fedGross - fedNet), federal: fedNet,
  };
}

/** Kirchensteuerfuss; bei gemischter Ehe je zur Hälfte (Art. 2 StV SG). */
export function churchRate(rules, c, parish) {
  const rate = (conf) => {
    switch (conf) {
      case 'roemischKatholisch': return parish?.kath ?? 0;
      case 'evangelischReformiert': return parish?.evang ?? 0;
      case 'christkatholisch': return rules.municipalities.christkatholisch;
      default: return 0;
    }
  };
  if (isJoint(c)) return clean((rate(c.person1.confession) + rate(c.person2.confession)) / 2);
  return rate(c.person1.confession);
}

// ---------------------------------------------------------------- Plausibilitätsprüfungen (Checks.swift)

export function validate(c, result, rules) {
  const n = [];
  const ps = isJoint(c) ? [[c.person1, c.income1, 1], [c.person2, c.income2, 2]] : [[c.person1, c.income1, 1]];
  for (const [p, inc, i] of ps) {
    if (!p.firstName || !p.lastName) n.push(notice(`name-${i}`, 'warning', 'Name fehlt', `Bitte Vor- und Nachname von Person ${i} erfassen.`, { area: 'familie' }));
    if (!p.birthDate) n.push(notice(`geburt-${i}`, 'info', 'Geburtsdatum fehlt', `Das Geburtsdatum von Person ${i} wird für die Steuererklärung benötigt.`, { area: 'familie' }));
    if (p.employment === 'unselbstaendig' && !inc.salaries.length) {
      n.push(notice(`lohnausweis-${i}`, 'warning', 'Lohnausweis fehlt', `Person ${i} ist als unselbständig erwerbend erfasst, aber es ist noch kein Lohnausweis vorhanden.`, { area: 'einkommen' }));
    }
    for (const s of inc.salaries) {
      const hasOverride = s.netSalaryOverride !== undefined && s.netSalaryOverride !== null;
      if (s.grossSalary > 0 && !hasOverride && s.socialContributions === 0) {
        n.push(notice(`ahv-${s.id}`, 'warning', 'AHV-Beiträge fehlen',
          `Im Lohnausweis «${s.employer || 'ohne Namen'}» sind keine Sozialversicherungsbeiträge (Ziffer 9) erfasst. Bitte prüfen.`, { area: 'einkommen' }));
      }
      if (hasOverride && s.grossSalary > 0) {
        const computed = nonNeg(s.grossSalary - s.socialContributions - s.pensionContributions - s.pensionBuyIn);
        if (Math.abs(computed - netSalary(s)) > 1) {
          n.push(notice(`netto-${s.id}`, 'warning', 'Nettolohn stimmt nicht',
            `Ziffer 11 (${chf(netSalary(s))}) weicht von Bruttolohn minus Beiträge (${chf(computed)}) ab.`, { area: 'einkommen' }));
        }
      }
    }
  }
  c.children.forEach((ch, idx) => {
    if (!ch.birthDate) {
      n.push(notice(`kind-geburt-${idx}`, 'warning', 'Geburtsdatum Kind fehlt', `Für ${ch.firstName || 'ein Kind'} fehlt das Geburtsdatum.`, { area: 'familie' }));
      return;
    }
    const suggested = suggestedEducation(ch.birthDate, c.year);
    if (suggested === 'vorschule' && ch.education !== 'vorschule' && ch.education !== 'keine') {
      n.push(notice(`kind-kat-${idx}`, 'info', 'Kinderabzug prüfen',
        `${ch.firstName || 'Das Kind'} ist gemäss Alter noch nicht schulpflichtig (Abzug Fr. ${chf(rules.cantonal.kinderabzugVorschule)} statt ${chf(rules.cantonal.kinderabzugAusbildung)}). Besucht es schon den Kindergarten?`, { area: 'familie' }));
    }
    const age = ageAtEndOf(ch.birthDate, c.year);
    if (age !== null && age >= 18 && ch.education === 'schule') {
      n.push(notice(`kind-volljaehrig-${idx}`, 'info', 'Volljähriges Kind',
        'Für volljährige Kinder gibt es einen Abzug nur, wenn sie in Ausbildung sind. Bitte «Lehre / Mittelschule / Studium» wählen.', { area: 'familie' }));
    }
  });
  for (const s of c.securities) {
    if (s.kind === 'konto' && s.incomeWithoutWithholding > rules.cantonalExtra.verrechnungssteuerFreigrenzeZins) {
      n.push(notice(`vst-${s.id}`, 'warning', 'Zins über Fr. 200',
        `Beim Konto «${s.description || s.institution}» liegt der Bruttozins über Fr. 200. Auf solchen Zinsen wird Verrechnungssteuer abgezogen – den Betrag in der Spalte «mit Verrechnungssteuer» erfassen, damit Sie die 35% zurückerhalten.`, { area: 'vermoegen' }));
    }
  }
  if (isJoint(c) && c.person1.confession !== c.person2.confession) {
    n.push(notice('kirche-gemischt', 'info', 'Konfessionell gemischte Ehe',
      'Die Kirchensteuer wird je zur Hälfte nach der Religionszugehörigkeit der Ehegatten erhoben (Art. 2 StV). Auf Verlangen ist eine Aufteilung nach allen Familienmitgliedern möglich.', { area: 'familie' }));
  }
  if (result.bill.taxableIncomeCanton > 0 && !result.municipality) {
    n.push(notice('steuerfuss', 'error', 'Steuerfuss fehlt', 'Ohne Gemeinde kann die Gemeindesteuer nicht berechnet werden.', { area: 'familie' }));
  }
  if (c.year === 2026) {
    n.push(notice('regeln-2026', 'info', 'Steuerjahr 2026',
      'Die Werte 2026 stammen aus den bereits veröffentlichten Formularen, Tarifen und Merkblättern. Die Wegleitung 2026 erscheint Anfang 2027 – die App wird dann aktualisiert.'));
  }
  return n;
}
