// Steuerhilfe Web · Vorsorge & Versicherungen: St.Gallen (PensionInsuranceView.swift) und Liechtenstein.
import { store } from '../store.js';
import { chf, sum } from '../../engine/money.js';
import * as M from '../../engine/model.js';
import { resultLine } from '../../engine/calculator.js';
import { fields, header, section, live, resultRow, staticRow, esc } from '../forms.js';

function pillar(c, i) {
  const p = c[`person${i + 1}`];
  const d = c[`deductions${i + 1}`];
  const key = `deductions${i + 1}`;
  const s3 = store.rules.cantonal.saeule3a;
  const max = p.hasPensionFund ? s3.mitPensionskasse : s3.ohnePensionskasseMax;
  const f = fields(c);
  const pct = Math.min(d.pillar3a / max, 1) * 100;
  return `<h4 class="sub">${esc(p.firstName || `Person ${i + 1}`)}</h4>`
    + f.chf(`${key}.pillar3a`, 'Säule 3a einbezahlt', { ziffer: '13.1', rerender: true, help: p.hasPensionFund ? `Mit Pensionskasse: höchstens Fr. ${chf(max)}.` : `Ohne Pensionskasse: 20% des Erwerbseinkommens, höchstens Fr. ${chf(max)}.` })
    + (d.pillar3a > 0 && p.hasPensionFund ? `<div class="meter"><div class="bar"><i style="width:${pct}%;${d.pillar3a >= max ? 'background:var(--green)' : ''}"></i></div><small>${chf(d.pillar3a)} von ${chf(max)} ausgeschöpft</small></div>` : '')
    + (store.year >= 2026 ? f.chf(`${key}.pillar3aBuyIn`, 'Nachträglicher Einkauf Säule 3a', { ziffer: '13.1', help: 'Ab 2026: Beitragslücken ab 2025 können nachbezahlt werden (max. kleiner 3a-Betrag pro Jahr). Bestätigung des Anbieters nötig.' }) : '')
    + f.chf(`${key}.pensionBuyIn`, 'Einkauf Pensionskasse (direkt bezahlt)', { ziffer: '13.2', help: 'Nur Einkäufe, die nicht über den Lohn abgezogen wurden (sonst sind sie bereits im Nettolohn berücksichtigt, Lohnausweis Ziffer 10.2).' });
}

function sg(c) {
  const f = fields(c);
  const sparzinsen = sum(c.securities.filter((s) => s.kind === 'konto' && s.isSavingsAccount && s.code !== 'G'), (s) => s.incomeWithWithholding + s.incomeWithoutWithholding);
  return header('Vorsorge & Versicherungen', 'Säule 3a, Pensionskassen-Einkäufe und Versicherungsprämien (Formular 6).', 'pension')
    + section('Vorsorge', pillar(c, 0) + (M.isJoint(c) ? '<hr>' + pillar(c, 1) : ''),
      { help: 'Abziehbar sind die im Steuerjahr tatsächlich einbezahlten Beiträge. Bescheinigung der Bank bzw. Versicherung (Formular 21 EDP) beilegen.' })
    + section('Versicherungsprämien und Sparzinsen',
      f.chf('householdDeductions.healthInsurancePremiums', 'Krankenkasse (Grund- und Zusatzversicherung, brutto)', { ziffer: 'A.a', help: 'Prämien der ganzen Familie gemäss Jahresbestätigung der Krankenkasse – ohne Kostenbeteiligungen.' })
      + f.chf('householdDeductions.accidentInsurancePremiums', 'Private Unfallversicherung', { ziffer: 'A.b', help: 'Ohne Nichtberufsunfallversicherung (ist bereits im Lohnausweis abgezogen).' })
      + f.chf('householdDeductions.lifeInsurancePremiums', 'Lebens- und Rentenversicherungen (Säule 3b)', { ziffer: 'A.c' })
      + staticRow('Sparzinsen (aus dem Wertschriftenverzeichnis)', `${chf(sparzinsen)} CHF`, { ziffer: 'A.d' })
      + f.chf('householdDeductions.premiumReduction', 'abzüglich Prämienverbilligung (IPV)', { ziffer: 'A.e' })
      + live('ins'));
}

function li(c) {
  const f = fields(c);
  const joint = M.isJoint(c);
  const salaries = [...c.income1.salaries, ...(joint ? c.income2.salaries : [])];
  const social = sum(salaries, (s) => s.socialContributions);
  const pk = sum(salaries, (s) => s.pensionContributions + s.pensionBuyIn);
  const r = store.liRules;
  const n = (i) => c[`person${i}`].firstName || `Person ${i}`;
  return header('Vorsorge & Versicherungen', 'Ziffer 17 (Hilfsformular A2, Seite 2). In Liechtenstein gibt es keine Säule 3a. Private Versicherungen werden mit dem gesetzlichen Höchstbetrag abgezogen – ohne Belege.', 'pension')
    + section('Aus den Lohnausweisen',
      staticRow('AHV / IV / FAK / ALV / NBU', `${chf(social)} CHF`)
      + staticRow('Pensionskasse (laufende Beiträge)', `${chf(pk)} CHF`)
      + '<p class="muted small">Diese Beiträge kommen aus «Einkommen» → Lohnausweis. AHV &amp; Co. sind voll abziehbar.</p>')
    + section('Einmalige Beiträge',
      f.chf('deductions1.pensionBuyIn', `Einkauf in die Pensionskasse – ${esc(n(1))}`, { ziffer: '17' })
      + (joint ? f.chf('deductions2.pensionBuyIn', `Einkauf in die Pensionskasse – ${esc(n(2))}`, { ziffer: '17' }) : '')
      + '<p class="muted small">Pensionskasse insgesamt höchstens 18 % des Erwerbs.</p>')
    + section('Private Versicherungen (Krankenkasse, Leben, Unfall)',
      staticRow(joint ? 'Gemeinsam steuerpflichtig' : 'Steuerpflichtige Person', `${chf(joint ? r.privatVerheiratet : r.privatAlleinstehend)} CHF`)
      + (M.deductibleChildren(c).length ? staticRow('Kinder', '700 / 1’600 / 2’200 CHF je nach Alter') : ''))
    + section('', live('li610'));
}

export default {
  render: (c) => (store.isLI ? li(c) : sg(c)),
  live: {
    ins: (r) => {
      const k = r.insurance.canton, b = r.insurance.federal;
      return staticRow('Bezahlt total', `${chf(k.paid)} CHF`)
        + staticRow('Maximaler Abzug', `Kanton ${chf(k.maximum)} · Bund ${chf(b.maximum)}`)
        + resultRow('Abzug Ziffer 14', k.deduction, b.deduction)
        + (k.paid > k.maximum ? '<p class="muted small">Sie haben mehr bezahlt, als abziehbar ist. Das ist normal – das Maximum wird automatisch angewendet.</p>' : '');
    },
    li610: (r) => {
      const l = resultLine(r, '610');
      return l ? resultRow('Abzug Versicherungsbeiträge (Ziffer 17)', l.canton) : '';
    },
  },
};
