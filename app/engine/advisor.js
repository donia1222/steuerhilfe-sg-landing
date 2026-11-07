// Steuerhilfe · Spartipps (Port von TaxCore/Calc/Advisor.swift).
// Jede Empfehlung wird durch eine echte Neuberechnung beziffert.
import { round, sum, chf } from './money.js';
import { calculate, billTotals } from './calculator.js';
import { isJoint, netSalary } from './model.js';

const copy = (c) => structuredClone(c);
const total = (r) => billTotals(r.bill).total;

/** Grenzsteuersatz: zusätzliche Steuer auf den nächsten 1’000 Franken (in Prozent). */
export function marginalRate(rules, c, base) {
  const m = copy(c);
  m.householdIncome.otherIncome += 1000;
  return (total(calculate(rules, m)) - total(base)) / 10;
}

export function tips(rules, c, base) {
  const out = [];
  const idx = isJoint(c) ? [0, 1] : [0];
  const saving = (modify) => {
    const m = copy(c);
    modify(m);
    return round(total(base) - total(calculate(rules, m)), 0);
  };
  const P = (i) => (i === 0 ? c.person1 : c.person2);
  const INC = (i) => (i === 0 ? c.income1 : c.income2);
  const DED = (i) => (i === 0 ? c.deductions1 : c.deductions2);
  const dkey = (i) => (i === 0 ? 'deductions1' : 'deductions2');

  for (const i of idx) {
    const person = P(i), inc = INC(i), ded = DED(i);
    const earned = sum(inc.salaries, netSalary) + inc.selfEmployment + inc.partnership;
    if (!(earned > 0)) continue;
    const name = person.firstName || `Person ${i + 1}`;
    const s3 = rules.cantonal.saeule3a;
    const max3a = person.hasPensionFund ? s3.mitPensionskasse : Math.min(round(earned * s3.ohnePensionskasseSatz, 0), s3.ohnePensionskasseMax);
    if (ded.pillar3a < max3a) {
      const s = saving((m) => { m[dkey(i)].pillar3a = max3a; });
      if (s > 20) {
        out.push({ id: `tipp-3a-${i}`, level: 'tip', title: `Säule 3a ausschöpfen (${name})`,
          message: `Mit dem vollen Beitrag von ${chf(max3a)} statt ${chf(ded.pillar3a)} sparen Sie rund ${chf(s)} Steuern. Einzahlung muss bis 31. Dezember auf dem 3a-Konto sein.`,
          saving: s, area: 'abzuege' });
      }
    }
    const wp = rules.cantonal.weiterbildungPauschal;
    if (ded.furtherEducation === 0 && !ded.furtherEducationFlatRate && person.employment === 'unselbstaendig'
      && inc.salaries.some((x) => x.isMainEmployment) && wp > 0) {
      const s = saving((m) => { m[dkey(i)].furtherEducationFlatRate = true; });
      if (s > 0) {
        out.push({ id: `tipp-weiterbildung-${i}`, level: 'tip', title: `Weiterbildungspauschale Fr. ${chf(wp)} (${name})`,
          message: `Der Kanton St.Gallen gewährt hauptberuflich Angestellten ohne Belege pauschal Fr. ${chf(wp)} für berufliche Weiterbildung, wenn ein Zusammenhang mit dem Beruf glaubhaft ist (z.B. Fachliteratur, Kurse). Ersparnis ca. ${chf(s)}.`,
          saving: s, area: 'abzuege' });
      }
    }
    const w = ded.work;
    if (inc.salaries.some((x) => x.isMainEmployment && !x.fieldF) && w.publicTransportCost === 0 && !w.useBicycle && w.carKmOneWay === 0) {
      out.push({ id: `tipp-fahrkosten-${i}`, level: 'tip', title: `Arbeitsweg erfassen (${name})`,
        message: `Für ${person.firstName || `Person ${i + 1}`} sind keine Fahrkosten zum Arbeitsort erfasst. Abonnement, Velo (bis Fr. 700) oder in begründeten Fällen das Auto sind abziehbar – im Kanton bis Fr. 8’000.`,
        area: 'abzuege' });
    }
    if (w.meals === 'keine' && inc.salaries.some((x) => x.isMainEmployment)) {
      out.push({ id: `tipp-verpflegung-${i}`, level: 'tip', title: `Auswärtige Verpflegung? (${name})`,
        message: 'Wer über Mittag nicht nach Hause kann, darf Fr. 15 pro Arbeitstag (max. Fr. 3’200) abziehen – bei Kantine oder Lunch-Checks die Hälfte.',
        area: 'abzuege' });
    }
  }

  const ins = base.insurance?.canton;
  if (ins && ins.paid < ins.maximum && ins.paid === 0) {
    out.push({ id: 'tipp-praemien', level: 'tip', title: 'Krankenkassenprämien erfassen',
      message: `Prämien für Krankenkasse, Unfall- und Lebensversicherungen sind bis ${chf(ins.maximum)} abziehbar. Die Jahresbestätigung der Krankenkasse genügt.`,
      area: 'abzuege' });
  }

  const gifts = sum(c.householdDeductions.donations.filter((d) => !d.isPoliticalParty), (d) => d.amount);
  if (gifts > 0 && gifts < rules.cantonal.freiwilligeZuwendungenMin) {
    out.push({ id: 'tipp-spenden', level: 'tip', title: 'Spenden bündeln',
      message: 'Spenden sind erst ab Fr. 100 pro Jahr abziehbar. Wer mehrere kleine Spenden macht, sollte sie vollständig erfassen.', area: 'abzuege' });
  }

  for (const i of idx) {
    const inc = INC(i), person = P(i);
    if (person.hasPensionFund && sum(inc.salaries, netSalary) > 80000) {
      const s = saving((m) => { m[dkey(i)].pensionBuyIn += 10000; });
      out.push({ id: `tipp-pk-${i}`, level: 'info', title: `Pensionskassen-Einkauf prüfen (${person.firstName || `Person ${i + 1}`})`,
        message: `Ein freiwilliger Einkauf von Fr. 10’000 in die Pensionskasse würde die Steuern um rund ${chf(s)} senken. Das Einkaufspotenzial steht auf dem Vorsorgeausweis. Achtung: 3 Jahre Sperrfrist für Kapitalbezüge.`,
        saving: s, area: 'abzuege' });
    }
  }

  return out.sort((a, b) => {
    if ((a.level === 'tip') !== (b.level === 'tip')) return a.level === 'tip' ? -1 : 1;
    return (b.saving ?? 0) - (a.saving ?? 0);
  });
}
