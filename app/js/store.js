// Steuerhilfe Web · Datenhaltung (entspricht AppStore.swift der Mac-App).
// Ein Steuerfall pro Jahr, im Browser zwischengespeichert (localStorage) und – mit der Vollversion –
// verschlüsselt im Konto gesichert (js/cloud.js), derselbe Datenblock wie in der Mac-App.
import { loadRuleBook, loadLIRules, SUPPORTED_YEARS } from '../engine/rules.js';
import { calculate, billTotals } from '../engine/calculator.js';
import { tips as sgTips, marginalRate as sgMarginal } from '../engine/advisor.js';
import { calculateLI, landessteuer, liTariffKind, zuschlag } from '../engine/liechtenstein.js';
import { round, nonNeg, sum, chf } from '../engine/money.js';
import * as M from '../engine/model.js';
import { suggestedEducation } from '../engine/calculator.js';
import { verifyLicense, covers, expiresAt, normalizeKey, prefixOf } from '../engine/license.js';

const LICENSE_KEY = 'steuerhilfe-web-lizenz';
const ACTIVATIONS = 'steuerhilfe-web-aktivierungen';
const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privat */ } };

const KEY = 'steuerhilfe-web-v1';

/** Liechtenstein im Browser zeigen? Aus seit dem 07/11/2026, bis die Berechnung gegen die
 *  Steuerverwaltung FL geprüft ist. Der Rechner bleibt drin (Mac-App, Daten aus der Cloud),
 *  nur Auswahl und Texte verschwinden. Wieder einschalten: true. */
export const LI_ENABLED = false;

function readSaved() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

class Store extends EventTarget {
  constructor() {
    super();
    const s = readSaved() || {};
    this.cases = s.cases || {};               // { "2025": TaxCase, … }
    this.defaultRegion = s.defaultRegion || null;
    this.transferChecked = s.transferChecked || [];
    this.year = SUPPORTED_YEARS.includes(s.year) ? s.year : SUPPORTED_YEARS[0];
    this.result = null;
    this.tips = [];
    this.marginalRate = 0;
    this.rules = null;
    this.liRules = null;
    this.saveError = false;
    this._calcTimer = null;
    this._saveTimer = null;
    this.license = null;   // { key, info, activatedAt }
    this.onLocalSave = null;   // js/cloud.js: lokale Änderung → abgleichen
    this.serverLicense = null; // { tiene, valida, caduca } aus dem Konto
    this._applying = false;
  }

  // ---------------------------------------------------------------- Lizenz (wie LicenseManager.swift)
  async loadLicense() {
    const saved = readJSON(LICENSE_KEY, null);
    if (!saved?.key) return;
    const info = await verifyLicense(saved.key);
    if (!info) return;
    const act = readJSON(ACTIVATIONS, {});
    this.license = { key: saved.key, info, activatedAt: info.durationDays !== undefined ? (act[info.id] || saved.activatedAt) : undefined };
  }

  get licenseExpiresAt() {
    if (!this.license) return null;
    const local = expiresAt(this.license.info, this.license.activatedAt);
    // Im Konto zählt das erste Aktivierungsdatum. Eine im Browser neu eingefügte Lizenz beginnt nicht von vorn.
    const sv = this.serverLicense;
    if (local && sv?.tiene && sv.caduca) { const s = new Date(String(sv.caduca).replace(' ', 'T')); if (s < local) return s; }
    return local;
  }
  get licenseExpired() { const e = this.licenseExpiresAt; return !!e && e < new Date(); }
  /** Gültige Lizenz im Konto – auch ohne Schlüssel in diesem Browser, z. B. ein App-Store-Abo vom iPhone (08.11.2026). */
  get accountLicenseUntil() {
    const sv = this.serverLicense;
    if (!sv?.valida) return null;
    return sv.caduca ? new Date(String(sv.caduca).replace(' ', 'T')) : new Date(8.64e15);
  }
  get hasAccountLicense() { const u = this.accountLicenseUntil; return !!u && u > new Date(); }
  isUnlocked(year = this.year) {
    if ((!this.license || this.licenseExpired) && this.hasAccountLicense) return true;
    return !!this.license && !this.licenseExpired && covers(this.license.info, year);
  }
  get licenseDaysLeft() { const e = this.licenseExpiresAt; return e ? Math.ceil((e - new Date()) / 86400000) : null; }
  get expiryNotice() {
    const e = this.licenseExpiresAt;
    if (!e) return null;
    const d = e.toLocaleDateString('de-CH', { day: 'numeric', month: 'long', year: 'numeric' });
    if (this.licenseExpired) return `Ihre Lizenz ist am ${d} abgelaufen.`;
    if (this.licenseDaysLeft <= 30) return `Ihre Lizenz läuft in ${this.licenseDaysLeft} Tagen ab (${d}).`;
    return null;
  }

  /** Schlüssel prüfen und aktivieren. Wirft einen Text-Fehler wie die Mac-App. */
  async activateLicense(raw, { silent = false } = {}) {
    const key = normalizeKey(raw);
    if (!prefixOf(key) || !key.includes('.')) throw new Error('Der Lizenzschlüssel ist unvollständig. Bitte den ganzen Schlüssel ab «SGSTEUER-» einfügen.');
    const info = await verifyLicense(key);
    if (!info) throw new Error('Dieser Lizenzschlüssel ist ungültig.');
    let activatedAt;
    if (info.durationDays !== undefined) {
      // Erste Aktivierung merken – eine erneute Eingabe startet die Laufzeit nicht neu.
      const act = readJSON(ACTIVATIONS, {});
      activatedAt = act[info.id] || new Date().toISOString();
      act[info.id] = activatedAt;
      writeJSON(ACTIVATIONS, act);
      const e = expiresAt(info, activatedAt);
      if (e < new Date()) throw new Error(`Dieser Lizenzschlüssel ist am ${e.toLocaleDateString('de-CH', { day: 'numeric', month: 'long', year: 'numeric' })} abgelaufen. Bitte fordern Sie eine neue Lizenz an.`);
    }
    writeJSON(LICENSE_KEY, { key, activatedAt });
    this.license = { key, info, activatedAt };
    if (!silent) this.emit('license');
    this.emit('change');
    return this.license;
  }

  /** Lizenz aus der Cloud (von der Mac-App oder einem anderen Browser) – mit ihrem ersten Aktivierungsdatum. */
  async adoptLicense(key, activatedAt) {
    const info = await verifyLicense(key);
    if (!info) return null;
    if (activatedAt && info.durationDays !== undefined) {
      const act = readJSON(ACTIVATIONS, {});
      if (!act[info.id]) { act[info.id] = activatedAt; writeJSON(ACTIVATIONS, act); }
    }
    return this.activateLicense(key, { silent: true });
  }

  removeLicense() {
    try { localStorage.removeItem(LICENSE_KEY); } catch { /* */ }
    this.license = null;
    this.emit('change');
  }

  /** E-Mail an Lweb: Lizenz bestellen oder verlängern (wie requestMailURL). */
  licenseMailURL() {
    const renew = this.licenseExpired || (this.licenseDaysLeft !== null && this.licenseDaysLeft <= 30);
    const subject = renew ? 'Steuerhilfe – Lizenz verlängern' : 'Steuerhilfe – Lizenz bestellen';
    const names = M.persons(this.current).map(M.displayName).filter((n) => n !== 'Person').join(' und ');
    const body = `Grüezi\n\nIch möchte ${renew ? 'meine Lizenz für Steuerhilfe um ein Jahr verlängern' : 'Steuerhilfe freischalten'} (CHF 99 pro Jahr und Haushalt).\n\nName: ${names}\nWohnort: ${this.current.municipality}\nTelefon:\n\nFreundliche Grüsse`;
    return `mailto:info@lweb.ch?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  // ---------------------------------------------------------------- Zugriff
  get current() { this.ensureCase(this.year); return this.cases[this.year]; }
  get region() { return M.taxRegion(this.current); }
  get isLI() { return this.region === 'li'; }
  get needsRegionChoice() { return !this.defaultRegion; }
  get total() { return this.result ? billTotals(this.result.bill).total : 0; }

  /** Änderung am aktuellen Fall: fn bekommt den Fall und darf ihn verändern. */
  update(fn) {
    fn(this.current);
    this.scheduleSave();
    this.scheduleRecalculate();
    this.emit('change');
  }

  /** Eingabe in einem Feld: speichern und neu rechnen, ohne die Seite neu zu zeichnen. */
  patched() {
    this.scheduleSave();
    this.scheduleRecalculate();
  }

  emit(type) { this.dispatchEvent(new Event(type)); }

  // ---------------------------------------------------------------- Jahr und Wohnort
  async setYear(y) {
    if (y === this.year || !SUPPORTED_YEARS.includes(y)) return;
    this.year = y;
    this.ensureCase(y);
    this.scheduleSave();
    await this.recalculate();
    this.emit('change');
  }

  async setRegion(r) {
    const c = this.current;
    if (M.taxRegion(c) === r) return;
    await this.loadRules();
    c.region = r === 'sg' ? undefined : r;
    if (r === 'li') {
      if (zuschlag(this.liRules, c.municipality) === null) c.municipality = 'Vaduz';
    } else if (!this.rules.municipalities.municipalities.some((m) => m.name === c.municipality)) {
      c.municipality = 'Sevelen';
      delete c.parish;
    }
    this.scheduleSave();
    await this.recalculate();
    this.emit('change');
  }

  async chooseInitialRegion(r) {
    this.defaultRegion = r;
    await this.setRegion(r);
    this.scheduleSave();
    this.emit('change');
  }

  ensureCase(y) {
    if (this.cases[y]) return;
    let c = M.newTaxCase(y);
    if (this.defaultRegion === 'li') { c.region = 'li'; c.municipality = 'Vaduz'; }
    if (this.cases[y - 1]) c = carryOver(this.cases[y - 1], y);
    this.cases[y] = c;
    this.scheduleSave();
  }

  // ---------------------------------------------------------------- Rechnen
  async loadRules() {
    this.rules = await loadRuleBook(this.year);
    this.liRules = await loadLIRules(this.year);
  }

  scheduleRecalculate() {
    clearTimeout(this._calcTimer);
    this._calcTimer = setTimeout(async () => { await this.recalculate(); this.emit('result'); }, 120);
  }

  async recalculate() {
    await this.loadRules();
    const c = this.current;
    if (M.taxRegion(c) === 'li') {
      const r = calculateLI(this.liRules, c);
      this.result = r;
      this.tips = liTips(c, r, this.liRules);
      const x = r.bill.taxableIncomeCanton;
      const kind = liTariffKind(c);
      const factor = 1 + r.bill.municipalityRate / 100;
      const diff = (landessteuer(this.liRules, x, kind) - landessteuer(this.liRules, nonNeg(x - 1000), kind)) * factor;
      this.marginalRate = x >= 1000 ? diff / 10 : 0;
    } else {
      const r = calculate(this.rules, c);
      this.result = r;
      this.tips = sgTips(this.rules, c, r);
      this.marginalRate = sgMarginal(this.rules, c, r);
    }
  }

  // ---------------------------------------------------------------- Speichern
  scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(), 300);
  }

  save() {
    clearTimeout(this._saveTimer);
    try {
      localStorage.setItem(KEY, JSON.stringify({
        v: 1, year: this.year, defaultRegion: this.defaultRegion, cases: this.cases, transferChecked: this.transferChecked,
      }));
      this.saveError = false;
    } catch {
      this.saveError = true;
    }
    this.emit('saved');
    if (!this._applying) this.onLocalSave?.();
  }

  // ---------------------------------------------------------------- Cloud (js/cloud.js)
  /** Was in den Cloud-Block gehört (PersistedState der Mac-App ohne die Belegliste). */
  snapshot() { return { cases: this.cases, transferChecked: this.transferChecked }; }

  hasData() {
    return Object.values(this.cases).some((c) => [c.person1, c.person2].some((p) => p?.firstName || p?.lastName)
      || c.income1?.salaries?.length || c.income2?.salaries?.length || c.children?.length || c.securities?.length);
  }

  /** Stand aus der Cloud übernehmen – ohne ihn als neue lokale Änderung zurückzuschicken. */
  async applyRemote(state) {
    this._applying = true;
    try {
      this.cases = {};
      for (const [y, c] of Object.entries(state.cases || {})) if (c && typeof c.year === 'number') this.cases[y] = c;
      this.transferChecked = Array.isArray(state.transferChecked) ? [...state.transferChecked] : [];
      if (!this.defaultRegion) {
        const latest = Object.keys(this.cases).map(Number).sort((a, b) => b - a)[0];
        if (latest) this.defaultRegion = M.taxRegion(this.cases[latest]);
      }
      this.ensureCase(this.year);
      this.save();
    } finally { this._applying = false; }
    await this.recalculate();
    this.emit('change');
  }

  /** Abmelden: nichts Persönliches im Browser zurücklassen. */
  async wipeLocal() {
    this._applying = true;
    try {
      this.cases = {};
      this.transferChecked = [];
      try { localStorage.removeItem(LICENSE_KEY); localStorage.removeItem(ACTIVATIONS); } catch { /* */ }
      this.license = null;
      this.serverLicense = null;
      this.ensureCase(this.year);
      this.save();
    } finally { this._applying = false; }
    await this.recalculate();
    this.emit('change');
  }

  /** Beispielfamilie laden (zum Ausprobieren). Überschreibt das aktuelle Jahr. */
  async loadDemo() {
    const c = demoFamily(this.year);
    if (this.isLI) {
      c.region = 'li'; c.municipality = 'Vaduz';
      c.li = { ...M.newLIExtras(), householdGoods: 8000, commute1: { ...M.newLICommute(), from: 'Vaduz', to: 'Schaan', mealDays: 200 } };
    }
    this.cases[this.year] = c;
    this.scheduleSave();
    await this.recalculate();
    this.emit('change');
  }

  async resetYear() {
    delete this.cases[this.year];
    this.ensureCase(this.year);
    await this.recalculate();
    this.emit('change');
  }
}

// ---------------------------------------------------------------- Importierte Fälle absichern
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function fill(base, src) {
  if (!plain(src)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(src)) {
    const b = base[k];
    if (b === undefined || b === null) out[k] = v;                       // optionale Felder (region, parish, li …)
    else if (plain(b)) out[k] = fill(b, v);
    else if (Array.isArray(b)) out[k] = Array.isArray(v) ? v : b;
    else if (typeof v === typeof b) out[k] = v;                          // falscher Typ: Standardwert behalten
  }
  return out;
}
/** Ein Fall aus einer Sicherungsdatei: fehlende Felder mit Standardwerten auffüllen, falsche Typen verwerfen.
 *  So bekommt die Mac-App nie einen Fall, den sie nicht lesen kann. */
export function normalizeCase(year, c) {
  if (!plain(c) || Number(c.year) !== Number(year) || !SUPPORTED_YEARS.includes(Number(year))) return null;
  return fill(M.newTaxCase(Number(year)), c);
}

// ---------------------------------------------------------------- Neues Jahr aus dem Vorjahr (wie carryOver in Swift)
export function carryOver(prev, year) {
  const c = M.newTaxCase(year);
  c.municipality = prev.municipality;
  if (prev.parish) c.parish = prev.parish;
  c.registerNumber = prev.registerNumber;
  c.civilStatus = prev.civilStatus;
  c.person1 = structuredClone(prev.person1);
  c.person2 = structuredClone(prev.person2);
  c.children = prev.children.map((ch) => {
    const n = { ...structuredClone(ch), childcareCosts: 0, childcareDaysWithMealsIncluded: 0, educationCosts: 0, scholarships: 0 };
    n.education = suggestedEducation(ch.birthDate, year) === 'vorschule' ? 'vorschule' : (ch.education === 'vorschule' ? 'schule' : ch.education);
    return n;
  });
  const sal = (list) => list.map((old) => ({ ...M.newSalary(), employer: old.employer, isMainEmployment: old.isMainEmployment }));
  c.income1.salaries = sal(prev.income1.salaries);
  c.income2.salaries = sal(prev.income2.salaries);
  c.deductions1.work = structuredClone(prev.deductions1.work);
  c.deductions2.work = structuredClone(prev.deductions2.work);
  c.securities = prev.securities.map((old) => {
    const n = { ...M.newSecurity(), kind: old.kind, code: old.code, institution: old.institution, description: old.description,
      ibanOrValor: old.ibanOrValor, owner: old.owner, managedByThirdParty: old.managedByThirdParty, isSavingsAccount: old.isSavingsAccount };
    if (old.quantity !== undefined) n.quantity = old.quantity;
    return n;
  });
  c.vehicles = structuredClone(prev.vehicles);
  c.realEstate = prev.realEstate.map((o) => ({ ...structuredClone(o), rentalIncome: 0, actualMaintenanceCosts: 0 }));
  c.insurances = prev.insurances.map((o) => ({ ...structuredClone(o), surrenderValue: 0 }));
  c.debts = prev.debts.map((o) => ({ ...structuredClone(o), interest: 0 }));
  c.iban = prev.iban;
  if (prev.region) c.region = prev.region;
  if (prev.li) c.li = structuredClone(prev.li);
  return c;
}

// ---------------------------------------------------------------- Tipps Liechtenstein (wie liTips in Swift)
export function liTips(c, base, rules) {
  const out = [];
  const total = billTotals(base.bill).total;
  const joint = M.isJoint(c);
  const sal = [...c.income1.salaries, ...(joint ? c.income2.salaries : [])];
  if (sal.length) {
    const paid = sum(sal, (s) => s.pensionContributions + s.pensionBuyIn) + c.deductions1.pensionBuyIn + (joint ? c.deductions2.pensionBuyIn : 0);
    const base18 = (sum(sal, (s) => s.grossSalary) * rules.pensionskasseMaxProzent) / 100;
    const room = base18 - paid;
    if (room >= 1000) {
      const buy = round(Math.min(room, 10000), 0);
      const t = structuredClone(c); t.deductions1.pensionBuyIn += buy;
      const saving = round(total - billTotals(calculateLI(rules, t).bill).total, 2);
      if (saving > 0) {
        out.push({ id: 'li-tip-pk', level: 'tip', title: 'Einkauf in die Pensionskasse',
          message: `Ein Einkauf von CHF ${chf(buy)} wäre voll abziehbar (Pensionskasse höchstens 18 % des Erwerbs). Fragen Sie Ihre Pensionskasse nach dem möglichen Einkauf.`,
          saving, area: 'abzuege' });
      }
    }
  }
  const li = M.liExtras(c);
  [li.commute1, li.commute2].forEach((k, i) => {
    if (i === 1 && !joint) return;
    const hasSalary = (i === 0 ? c.income1.salaries : c.income2.salaries).length > 0;
    if (hasSalary && k.mode === 'inland' && (!k.from || !k.to) && k.mealDays === 0) {
      const t = structuredClone(c);
      t.li = M.liExtras(t);
      t.li[i === 0 ? 'commute1' : 'commute2'] = { ...k, mealDays: 220 };
      const saving = round(total - billTotals(calculateLI(rules, t).bill).total, 2);
      const who = i === 0 ? c.person1.firstName : c.person2.firstName;
      out.push({ id: `li-tip-weg-${i}`, level: 'tip', title: who ? `Arbeitsweg und Verpflegung prüfen (${who})` : 'Arbeitsweg und Verpflegung prüfen',
        message: 'Fahrkosten nach der amtlichen Tabelle und CHF 5 pro auswärtiger Mahlzeit zählen, sobald sie zusammen über der Pauschale von CHF 1’600 liegen.',
        saving: saving > 0 ? saving : undefined, area: 'abzuege' });
    }
  });
  if (!c.householdDeductions.medicalCosts.length) {
    out.push({ id: 'li-tip-krank', level: 'tip', title: 'Krankheitskosten erfassen',
      message: 'In Liechtenstein gibt es keinen Selbstbehalt: Franchise, Selbstbehalt und Zahnarzt sind bis CHF 6’300 pro Person abziehbar – schon ab dem ersten Franken.', area: 'abzuege' });
  }
  return out.sort((a, b) => (b.saving ?? 0) - (a.saving ?? 0));
}

// ---------------------------------------------------------------- Beispielfamilie (wie DemoData.swift)
export function demoFamily(year) {
  const d = M.dateISO;
  const c = M.newTaxCase(year);
  c.municipality = 'Sevelen'; c.civilStatus = 'verheiratet'; c.registerNumber = '123.456.789';
  Object.assign(c.person1, { firstName: 'Martin', lastName: 'Muster', birthDate: d(1985, 4, 2), confession: 'roemischKatholisch', profession: 'Polymechaniker', employer: 'Werk AG, Buchs' });
  Object.assign(c.person2, { firstName: 'Anna', lastName: 'Muster', birthDate: d(1987, 9, 12), confession: 'evangelischReformiert', profession: 'Pflegefachfrau', employer: 'Praxis am Bach, Grabs' });
  c.income1.salaries = [{ ...M.newSalary(), employer: 'Werk AG, Buchs', grossSalary: 97000, socialContributions: 6150, pensionContributions: 5850 }];
  c.income2.salaries = [{ ...M.newSalary(), employer: 'Praxis am Bach, Grabs', grossSalary: 38500, socialContributions: 2440, pensionContributions: 1310, fieldG: true }];
  Object.assign(c.deductions1.work, { publicTransportCost: 1240, meals: 'auswaerts', mealDays: 205 });
  Object.assign(c.deductions2.work, { useBicycle: true, meals: 'verbilligt', mealDays: 120 });
  c.deductions1.pillar3a = 7258; c.deductions2.pillar3a = 3000;
  c.children = [
    { ...M.newChild(), firstName: 'Lena', lastName: 'Muster', birthDate: d(2018, 3, 1), education: 'schule' },
    { ...M.newChild(), firstName: 'Tim', lastName: 'Muster', birthDate: d(2022, 5, 1), education: 'vorschule', childcareCosts: 9600, childcareProvider: 'Kita Sonnenschein, Sevelen' },
  ];
  c.householdDeductions.healthInsurancePremiums = 11240;
  c.securities = [
    { ...M.newSecurity(), kind: 'konto', institution: 'Raiffeisenbank Werdenberg', description: 'Privatkonto', ibanOrValor: 'CH93 8080 8001 2345 6789 0', taxValue: 18420, incomeWithoutWithholding: 4 },
    { ...M.newSecurity(), kind: 'konto', institution: 'Raiffeisenbank Werdenberg', description: 'Sparkonto', taxValue: 46100, incomeWithoutWithholding: 187 },
    { ...M.newSecurity(), kind: 'wertschrift', institution: 'PostFinance', description: 'Anteile Fonds Schweiz Aktien', taxValue: 22350, incomeWithWithholding: 412, managedByThirdParty: true, isSavingsAccount: false },
  ];
  c.vehicles = [{ ...M.newVehicle(), description: 'Skoda Octavia', purchasePrice: 34000, purchaseYear: 2021 }];
  c.householdDeductions.medicalCosts = [
    { ...M.newMedicalCost(), provider: 'Zahnarztpraxis Grabs', gross: 1860 },
    { ...M.newMedicalCost(), provider: 'Franchise und Selbstbehalt (Krankenkasse)', gross: 1420 },
  ];
  c.householdDeductions.donations = [
    { ...M.newDonation(), recipient: 'Glückskette', amount: 200 },
    { ...M.newDonation(), recipient: 'Pro Juventute', amount: 150 },
  ];
  c.iban = 'CH93 8080 8001 2345 6789 0';
  return c;
}

export const store = new Store();
