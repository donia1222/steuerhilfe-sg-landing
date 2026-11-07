// Steuerhilfe · Datenmodell (Port von TaxCore/Model/TaxCase.swift + Liechtenstein.swift).
// Die Schlüssel und Standardwerte sind GENAU die der Mac-App: eine Steuererklärung
// aus der Web-Version muss die Mac-App über die Cloud lesen können und umgekehrt.
// Regeln dafür:
//  - Datumsangaben sind ISO-8601-Texte ohne Millisekunden, z.B. "2019-02-28T23:00:00Z"
//    (Mitternacht in Zürich, so speichert die Mac-App). Mit `dateISO(2019, 3, 1)` erzeugen,
//    mit `ymd(text)` lesen.
//  - Fehlt ein Wert (Swift: nil), fehlt der Schlüssel: Feld weglassen statt null.
//  - IDs sind UUIDs in Grossbuchstaben (wie Swift).

import { nonNeg } from './money.js';

const TZ = 'Europe/Zurich';

export function uuid() {
  const u = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
  return u.toUpperCase();
}

/** Kalenderdatum in Zürich aus einem ISO-Text: { y, m, d } oder null. */
export function ymd(iso) {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(t);
  const get = (k) => Number(parts.find((p) => p.type === k).value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** Mitternacht in Zürich als ISO-Text ohne Millisekunden (wie Swift .iso8601). */
export function dateISO(y, m, d) {
  // Versatz Zürich zu UTC an diesem Tag bestimmen (Sommer-/Winterzeit)
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess));
  const g = (k) => Number(parts.find((p) => p.type === k).value);
  const local = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'));
  const offset = local - guess;
  return new Date(guess - offset).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** "YYYY-MM-DD" (für <input type=date>) ⇄ ISO */
export const isoFromInput = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? dateISO(+m[1], +m[2], +m[3]) : undefined;
};
export const inputFromIso = (iso) => {
  const x = ymd(iso);
  return x ? `${x.y}-${String(x.m).padStart(2, '0')}-${String(x.d).padStart(2, '0')}` : '';
};

// ---- Bausteine (Standardwerte wie in Swift) ----

export const newPerson = () => ({
  firstName: '', lastName: '', confession: 'keine', profession: '', employment: 'unselbstaendig', employer: '', hasPensionFund: true,
});

export const newChild = () => ({
  id: uuid(), firstName: '', lastName: '', education: 'schule', school: '', educationUntil: '', livesInHousehold: true,
  childcareCosts: 0, childcareDaysWithMealsIncluded: 0, childcareProvider: '', educationCosts: 0, scholarships: 0,
});

export const newSalary = () => ({
  id: uuid(), employer: '', isMainEmployment: true, grossSalary: 0, socialContributions: 0, pensionContributions: 0,
  pensionBuyIn: 0, fieldF: false, fieldG: false, flatRateExpenses: 0, remarks: '',
});

export const newPensionIncome = () => ({ id: uuid(), label: '', amount: 0, taxablePercent: 100 });

export const newPersonIncome = () => ({
  salaries: [], boardFees: 0, selfEmployment: 0, partnership: 0, ahvPension: 0, pensions: [], dailyAllowances: 0, unemployment: 0,
});

export const newHouseholdIncome = () => ({
  familyAllowancesDirect: 0, alimonyReceivedSelf: 0, alimonyReceivedChildren: 0, undividedEstates: 0, otherIncome: 0,
  otherIncomeDescription: '', qualifiedParticipationIncome: 0, simplifiedSettlementIncome: 0,
});

export const newSecurity = () => ({
  id: uuid(), kind: 'konto', code: '', institution: '', description: '', ibanOrValor: '', owner: 'gemeinsam', taxValue: 0,
  incomeWithWithholding: 0, incomeWithoutWithholding: 0, managedByThirdParty: false, isSavingsAccount: true,
});

export const newInsurancePolicy = () => ({ id: uuid(), company: '', sumInsured: 0, surrenderValue: 0 });
export const newVehicle = () => ({ id: uuid(), description: '', purchasePrice: 0 });
export const newDebt = () => ({ id: uuid(), creditor: '', amount: 0, interest: 0, isBusiness: false });

export const newRealEstate = () => ({
  id: uuid(), description: '', municipality: '', canton: 'SG', parcelNumber: '', sharePerson1: 50, sharePerson2: 50,
  use: 'selbstbewohnt', taxValue: 0, imputedRentalValue: 0, isPrimaryResidence: true, rooms: 0, unusedRooms: 0,
  rentalIncome: 0, useFlatRateMaintenance: true, actualMaintenanceCosts: 0,
  // buildingYear: optional (wie Int? in Swift) – fehlt = unbekannt = 20%
});

export const newWorkExpenses = () => ({
  publicTransportCost: 0, useBicycle: false, bicycleCost: 700, carKmOneWay: 0, carTripsPerDay: 2, carWorkDays: 0,
  carIsMotorbike: false, carJustification: '', meals: 'keine', mealDays: 0, useActualOtherCosts: false, actualOtherCosts: 0,
  weeklyStay: false, weeklyStayMonths: 0, weeklyStayRoomPerMonth: 0, weeklyStayDays: 0, weeklyStayMealsReduced: false,
  sideJobUseActual: false, sideJobActualCosts: 0,
});

export const newMedicalCost = () => ({ id: uuid(), provider: '', gross: 0, reimbursed: 0, isDisabilityRelated: false });
export const newDonation = () => ({ id: uuid(), recipient: '', amount: 0, isPoliticalParty: false });

export const newPersonDeductions = () => ({
  work: newWorkExpenses(), pillar3a: 0, pillar3aBuyIn: 0, pensionBuyIn: 0, furtherEducation: 0, furtherEducationFlatRate: false,
});

export const newHouseholdDeductions = () => ({
  healthInsurancePremiums: 0, accidentInsurancePremiums: 0, lifeInsurancePremiums: 0, premiumReduction: 0,
  alimonyPaidPartner: 0, alimonyPaidChildren: 0, annuityPayments: 0, otherDeductions: 0, otherDeductionsDescription: '',
  significantCooperation: false, medicalCosts: [], dietFlatRate: false, disabilityFlatRate: 0, donations: [], supportedPersons: 0,
});

export const newCapitalPayment = () => ({ id: uuid(), kind: 'saeule3a', amount: 0 });

export const newLICommute = () => ({ mode: 'inland', from: '', to: '', kmPerDay: 0, workDays: 220, reimbursed: 0, mealDays: 0 });
export const newLIExtras = () => ({ commute1: newLICommute(), commute2: newLICommute(), householdGoods: 0, useRealEstateFromList: true });

/** Eine leere Steuererklärung für ein Jahr. */
export const newTaxCase = (year) => ({
  year, municipality: 'Sevelen', registerNumber: '', civilStatus: 'verheiratet',
  person1: newPerson(), person2: newPerson(), children: [],
  income1: newPersonIncome(), income2: newPersonIncome(), householdIncome: newHouseholdIncome(),
  deductions1: newPersonDeductions(), deductions2: newPersonDeductions(), householdDeductions: newHouseholdDeductions(),
  securities: [], cash: 0, insurances: [], vehicles: [], undividedEstatesWealth: 0, otherAssets: 0, otherAssetsDescription: '',
  realEstate: [], businessAssets: 0, debts: [], capitalPayments: [], iban: '',
});

// ---- Abgeleitete Werte (wie die computed properties in Swift) ----

export const isJoint = (c) => c.civilStatus === 'verheiratet' || c.civilStatus === 'eingetragenePartnerschaft';
// Wie TaxCase.swift (07/11/2026): wer Unterhaltsbeiträge für Kinder abzieht, bekommt für ein Kind, das nicht
// im eigenen Haushalt lebt, keinen Kinderabzug. Einelternfamilie nur mit einem Kind im gleichen Haushalt.
export const deductibleChildren = (c) => c.children.filter((ch) => ch.education !== 'keine'
  && (isJoint(c) || ch.livesInHousehold !== false || !(c.householdDeductions.alimonyPaidChildren > 0)));
export const isSingleParent = (c) => !isJoint(c) && deductibleChildren(c).some((ch) => ch.livesInHousehold !== false);
export const tariffKind = (c) => (isJoint(c) || isSingleParent(c) ? 'joint' : 'single');
export const persons = (c) => (isJoint(c) ? [c.person1, c.person2] : [c.person1]);
export const taxRegion = (c) => c.region || 'sg';
export const liExtras = (c) => ({ ...newLIExtras(), ...(c.li || {}), commute1: { ...newLICommute(), ...(c.li?.commute1 || {}) }, commute2: { ...newLICommute(), ...(c.li?.commute2 || {}) } });
export const displayName = (p) => [p.firstName, p.lastName].filter(Boolean).join(' ') || 'Person';

export function netSalary(s) {
  if (s.netSalaryOverride !== undefined && s.netSalaryOverride !== null) return s.netSalaryOverride;
  return nonNeg(s.grossSalary - s.socialContributions - s.pensionContributions - s.pensionBuyIn);
}
export const selfPaid = (m) => nonNeg(m.gross - m.reimbursed);
