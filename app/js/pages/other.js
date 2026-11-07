// Steuerhilfe Web · Weitere Abzüge: St.Gallen (OtherDeductionsView.swift) und Liechtenstein (LIOtherDeductionsView).
import { store } from '../store.js';
import { chf } from '../../engine/money.js';
import * as M from '../../engine/model.js';
import { resultLine, resultValue } from '../../engine/calculator.js';
import { fields, header, section, live, resultRow, staticRow, addBtn, delBtn, esc } from '../forms.js';

const fedOf = (r, code) => resultLine(r, code)?.federal;

function medical(c) {
  const f = fields(c);
  const li = store.isLI;
  const rows = c.householdDeductions.medicalCosts.map((m, i) => `<div class="trow wrap">
      ${f.cellText(`householdDeductions.medicalCosts.${i}.provider`, 'Arzt, Zahnarzt, Spital, Krankenkasse')}
      <span class="tcell"><small>Brutto</small>${f.cellChf(`householdDeductions.medicalCosts.${i}.gross`, 'Brutto')}</span>
      <span class="tcell"><small>Vergütet</small>${f.cellChf(`householdDeductions.medicalCosts.${i}.reimbursed`, 'Vergütet')}</span>
      ${li ? '' : `<span class="tcell"><small>Behind.</small>${f.cellCheck(`householdDeductions.medicalCosts.${i}.isDisabilityRelated`, 'Behinderungsbedingt (ohne Selbstbehalt)')}</span>`}
      ${delBtn('delMedical', { i })}</div>`).join('');
  return section('Krankheits- und Unfallkosten',
    rows + addBtn('addMedical', 'Kosten hinzufügen')
    + (li ? '' : f.toggle('householdDeductions.dietFlatRate', 'Pauschale lebensnotwendige Diät Fr. 2’500 (z.B. Zöliakie)', { rerender: false })
      + f.select('householdDeductions.disabilityFlatRate', 'Pauschale Behinderung', [[0, 'keine'], [2500, 'Fr. 2’500 (Hilflosenentschädigung leicht, Gehörlose, Dialyse)'], [5000, 'Fr. 5’000 (Hilflosenentschädigung mittel)'], [7500, 'Fr. 7’500 (Hilflosenentschädigung schwer)']], { cast: 'num', rerender: false }))
    + live('med'),
    { help: li
      ? 'Abziehbar sind die nicht versicherten Kosten (Franchise, Selbstbehalt, Zahnarzt …) bis CHF 6’300 pro Person, ohne Selbstbehalt. Über CHF 300 pro Person braucht es Belege.'
      : 'Abziehbar sind selbst bezahlte Kosten (Franchise, Selbstbehalt, Zahnarzt, Brille, ärztlich verordnete Therapien), soweit sie 2% (Kanton) bzw. 5% (Bund) des Nettoeinkommens übersteigen. Die Kostenübersicht der Krankenkasse ist die wichtigste Quelle.' });
}

function donations(c) {
  const f = fields(c);
  const li = store.isLI;
  const rows = c.householdDeductions.donations.map((d, i) => `<div class="trow">
      ${f.cellText(`householdDeductions.donations.${i}.recipient`, 'z.B. Glückskette')}
      ${f.cellChf(`householdDeductions.donations.${i}.amount`)}
      ${li ? '' : `<span class="tcell"><small>Partei</small>${f.cellCheck(`householdDeductions.donations.${i}.isPoliticalParty`, 'Parteispende')}</span>`}
      ${delBtn('delDonation', { i })}</div>`).join('');
  return section('Spenden', rows + addBtn('addDonation', 'Spende hinzufügen') + live('don'),
    { help: li
      ? 'Spenden an steuerbefreite gemeinnützige Institutionen in Liechtenstein, im EWR oder in der Schweiz: ab CHF 100 pro Spende, höchstens 10 % des Erwerbs. Parteispenden sind in Liechtenstein nicht abziehbar.'
      : 'Spenden an steuerbefreite gemeinnützige Organisationen in der Schweiz sind ab Fr. 100 pro Jahr abziehbar, höchstens 20% des Nettoeinkommens. Kirchliche Kultuszwecke sind nicht abziehbar.' });
}

function childcare(c) {
  const f = fields(c);
  const body = c.children.length ? c.children.map((ch, i) => `<div class="item">
      <h4 class="sub">${esc(ch.firstName || 'Kind')}</h4>
      ${f.chf(`children.${i}.childcareCosts`, 'Betreuungskosten (Kita, Hort, Tagesfamilie)', { ziffer: '16.2', rerender: true })}
      ${ch.childcareCosts > 0 ? f.text(`children.${i}.childcareProvider`, 'Name und Adresse der Betreuung')
        + f.int(`children.${i}.childcareDaysWithMealsIncluded`, 'Tage, an denen Verpflegung inbegriffen ist', { unit: 'Tage', help: 'Wenn die Rechnung das Essen nicht separat ausweist, werden Fr. 8 pro Tag abgezogen.' }) : ''}
      ${ch.education === 'ausbildung' || ch.education === 'schule' ? f.chf(`children.${i}.educationCosts`, 'Selbst getragene Ausbildungskosten', { ziffer: '23.3', rerender: true, help: 'Nur Kanton: Kosten über Fr. 3’200 sind abziehbar (z.B. Semestergebühren, Bücher, auswärtige Verpflegung, ÖV zum Ausbildungsort).' })
        + (ch.educationCosts > 0 ? f.chf(`children.${i}.scholarships`, 'Erhaltene Stipendien') : '') : ''}
    </div>`).join('') : '<p class="muted">Keine Kinder erfasst.</p>';
  return section('Kinderbetreuung durch Dritte', body + live('care'),
    { help: `Für Kinder unter 14 Jahren im gleichen Haushalt, wenn die Betreuung wegen Erwerbstätigkeit, Ausbildung oder Erwerbsunfähigkeit nötig ist. Kanton max. Fr. ${chf(store.rules.cantonal.kinderbetreuungMax)} pro Kind, Bund max. Fr. ${chf(store.rules.federal.kinderbetreuungMax)}.` });
}

function sg(c) {
  const f = fields(c);
  const joint = M.isJoint(c);
  const edu = (i) => {
    const p = c[`person${i + 1}`], d = c[`deductions${i + 1}`];
    const n = esc(p.firstName || `Person ${i + 1}`);
    return f.chf(`deductions${i + 1}.furtherEducation`, `${n}: Kosten berufliche Weiterbildung`, { ziffer: '16.4', rerender: true, help: 'Selbst bezahlte, berufsorientierte Aus- und Weiterbildung, max. Fr. 13’000. Aufstellung mit Rechnungsdatum, Bezeichnung und Betrag.' })
      + (d.furtherEducation === 0 && p.employment === 'unselbstaendig' ? f.toggle(`deductions${i + 1}.furtherEducationFlatRate`, `${n}: Pauschale Fr. 400 ohne Belege (nur Kanton)`, { rerender: false }) : '');
  };
  return header('Weitere Abzüge', 'Krankheitskosten, Spenden, Kinderbetreuung, Weiterbildung, Unterhaltsbeiträge.', 'other')
    + medical(c) + donations(c) + childcare(c)
    + section('Aus- und Weiterbildung', edu(0) + (joint ? edu(1) : ''))
    + section('Unterhaltsbeiträge und übrige Abzüge',
      f.chf('householdDeductions.alimonyPaidPartner', 'Unterhaltsbeiträge an geschiedene/getrennte Partner', { ziffer: '12.1' })
      + f.chf('householdDeductions.alimonyPaidChildren', 'Unterhaltsbeiträge für minderjährige Kinder', { ziffer: '12.2', help: 'Für diese Kinder entfällt der Kinderabzug. Bei erstmaliger Zahlung Scheidungsurteil beilegen.' })
      + f.chf('householdDeductions.annuityPayments', 'Rentenleistungen / dauernde Lasten', { ziffer: '12.3' })
      + f.chf('householdDeductions.actualAssetManagementCosts', 'Verwaltungskosten Wertschriften (effektiv)', { optional: true, prompt: 'Pauschale', help: 'Leer lassen für die Pauschale von 2‰ des durch Banken verwalteten Wertschriftenvermögens (max. Fr. 6’000).' })
      + f.chf('householdDeductions.otherDeductions', 'Übrige Abzüge (z.B. AHV-Beiträge Nichterwerbstätiger)', { ziffer: '16.5' })
      + (joint ? f.toggle('householdDeductions.significantCooperation', 'Erhebliche Mitarbeit im Betrieb des Ehegatten', { rerender: false }) : '')
      + f.int('householdDeductions.supportedPersons', 'Unterstützte Personen (nur Bund)', { unit: 'Personen' }));
}

function li(c) {
  const f = fields(c);
  const joint = M.isJoint(c);
  const kids = M.deductibleChildren(c);
  const n = (i) => esc(c[`person${i}`].firstName || `Person ${i}`);
  const eduKids = c.children.map((ch, i) => (ch.education === 'ausbildung'
    ? f.chf(`children.${i}.educationCosts`, `${esc(ch.firstName || 'Kind')}: Ausbildungskosten`, { ziffer: '18.3', rerender: true, help: 'Ohne Primar-, Sekundar- und inländische Musikschule. Höchstens CHF 12’700, abzüglich Stipendien.' })
      + (ch.educationCosts > 0 ? f.chf(`children.${i}.scholarships`, 'Erhaltene Stipendien') : '') : '')).join('');
  return header('Weitere Abzüge', 'Ziffer 18: Kinder, Unterhalt, Krankheitskosten, Spenden und Weiterbildung.', 'other')
    + section('Kinder',
      (kids.length ? staticRow('Kinderabzug (Ziffer 18.1)', `${kids.length} × CHF 12’700`) : '<p class="muted">Keine Kinder mit Kinderabzug erfasst (unter «Personen &amp; Familie»).</p>') + eduKids)
    + medical(c) + donations(c)
    + section('Aus- und Weiterbildung (Ziffer 18.6)',
      f.chf('deductions1.furtherEducation', `${n(1)}: berufsorientierte Weiterbildung`, { help: 'Einschliesslich Umschulung, höchstens CHF 12’700 pro Person.' })
      + (joint ? f.chf('deductions2.furtherEducation', `${n(2)}: berufsorientierte Weiterbildung`) : ''))
    + section('Unterhaltsbeiträge (Ziffer 18.2)',
      f.chf('householdDeductions.alimonyPaidPartner', 'An geschiedene oder getrennt lebende Partner')
      + f.chf('householdDeductions.alimonyPaidChildren', 'Für Kinder'));
}

export default {
  render: (c) => (store.isLI ? li(c) : sg(c)),
  live: {
    med: (r) => (store.isLI ? resultRow('Abzug (Ziffer 18.4, höchstens 6’300 pro Person)', resultValue(r, '640'))
      : resultRow('Abzug nach Selbstbehalt (Ziffer 21.1)', resultValue(r, '240'), fedOf(r, '240'))),
    don: (r) => (store.isLI ? resultRow('Freiwillige Geldleistungen (Ziffer 18.5)', resultValue(r, '645'))
      : resultRow('Freiwillige Zuwendungen (Ziffer 21.3)', resultValue(r, '244'), fedOf(r, '244')) + resultRow('Parteispenden (Ziffer 16.3)', resultValue(r, '555'), fedOf(r, '555'))),
    care: (r) => resultRow('Kinderbetreuung (Ziffer 16.2)', resultValue(r, '258'), fedOf(r, '258')),
  },
  actions: {
    addMedical(c) { c.householdDeductions.medicalCosts.push(M.newMedicalCost()); },
    delMedical(c, d) { c.householdDeductions.medicalCosts.splice(Number(d.i), 1); },
    addDonation(c) { c.householdDeductions.donations.push(M.newDonation()); },
    delDonation(c, d) { c.householdDeductions.donations.splice(Number(d.i), 1); },
  },
};
