// Steuerhilfe Web · Berufskosten: St.Gallen (WorkExpensesView.swift) und Liechtenstein (LIWorkExpensesView).
import { store } from '../store.js';
import { chf } from '../../engine/money.js';
import * as M from '../../engine/model.js';
import { workTotal, newWorkBreakdown } from '../../engine/calculator.js';
import { fahrkostenInland } from '../../engine/liechtenstein.js';
import { fields, header, section, empty, live, resultRow, note, staticRow, esc } from '../forms.js';

const open = {};
const name = (c, i) => c[`person${i + 1}`].firstName || `Person ${i + 1}`;

// ---------------------------------------------------------------- St.Gallen
function sgSections(c, i) {
  const key = `deductions${i + 1}.work`;
  const w = c[`deductions${i + 1}`].work;
  const salaries = c[`income${i + 1}`].salaries;
  const title = esc(name(c, i));
  const f = fields(c);
  const p = store.rules.cantonal.berufskosten;
  const kmRate = store.year >= 2026 ? '75' : '70';
  if (!salaries.length) {
    return section(`Berufskosten ${title}`, empty('briefcase', 'Kein Lohnausweis erfasst', 'Berufskosten sind nur bei unselbständiger Erwerbstätigkeit abziehbar. Erfassen Sie zuerst den Lohnausweis unter «Einkommen».'));
  }
  const car = `<div class="fr"><span class="lbl"><span class="ziffer">1.3</span><span>Auto / Motorrad</span><button type="button" class="info" data-help="car${i}" aria-expanded="false">${'<svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>'}</button>
      <span class="help" id="car${i}" hidden>Nur in begründeten Fällen: kein öffentliches Verkehrsmittel, Zeitersparnis über 60 Minuten pro Tag, Benützung auf Verlangen des Arbeitgebers oder Krankheit. ${kmRate} Rappen pro Kilometer, in der Regel höchstens 220 Arbeitstage. Keine Fahrkosten an Home-Office-Tagen.</span></span>
    <div class="ctl calc">${f.cellInt(`${key}.carKmOneWay`, 'Kilometer einfach', { kind: 'num', cls: 'xs', placeholder: 'km', rerender: true })}<span>km ×</span>${f.cellInt(`${key}.carTripsPerDay`, 'Fahrten pro Tag', { kind: 'num', cls: 'xxs' })}<span>Fahrten ×</span>${f.cellInt(`${key}.carWorkDays`, 'Arbeitstage', { cls: 'xs', placeholder: 'Tage' })}<span>Tage</span></div></div>`;
  return section(`${title} · 1. Arbeitsweg`,
      (salaries.some((s) => s.fieldF) ? note('Feld F im Lohnausweis ist angekreuzt – kein Abzug für den Arbeitsweg.') : '')
      + f.chf(`${key}.publicTransportCost`, 'Öffentlicher Verkehr (Abo, Billette)', { ziffer: '1.1' })
      + f.toggle(`${key}.useBicycle`, `<span class="ziffer">1.2</span> Velo / E-Bike / Kleinmotorrad (bis Fr. ${chf(p.veloMax)})`, { rerender: false })
      + car
      + (w.carKmOneWay > 0 ? f.select(`${key}.carJustification`, 'Begründung', [
        ['', 'Bitte wählen'],
        ['Fehlen eines öffentlichen Verkehrsmittels', 'Kein öffentliches Verkehrsmittel'],
        ['Einsparung über 60 Minuten/Tag durch Motorfahrzeugbenützung', 'Zeitersparnis über 60 Minuten pro Tag'],
        ['Ständige Benützung des Motorfahrzeugs auf Verlangen des Arbeitgebers', 'Auf Verlangen des Arbeitgebers'],
        ['Benützung öV wegen Krankheit oder Gebrechlichkeit unzumutbar (Arztzeugnis)', 'Krankheit / Gebrechlichkeit (Arztzeugnis)'],
      ], { rerender: false }) + f.toggle(`${key}.carIsMotorbike`, 'Motorrad (Bund: 40 Rappen/km)', { rerender: false }) : '')
      + live(`commute${i}`),
      { trail: `<span data-live="total${i}"></span>` })
    + section(`${title} · 2. Verpflegung`,
      f.select(`${key}.meals`, 'Situation über Mittag', [
        ['keine', 'Heimkehr möglich – kein Abzug'], ['auswaerts', 'Auswärts essen (Fr. 15 pro Tag)'],
        ['verbilligt', 'Kantine / Lunch-Checks (Fr. 7.50 pro Tag)'], ['schicht', 'Schicht- oder Nachtarbeit (Fr. 15 pro Tag)']])
      + (w.meals !== 'keine' ? f.int(`${key}.mealDays`, 'Arbeitstage', { unit: 'Tage', help: 'Nur Tage im Betrieb – an Home-Office-Tagen entstehen keine Mehrkosten. Höchstens 220 Tage.' }) : '')
      + live(`meals${i}`))
    + section(`${title} · 3. Übrige Berufskosten`,
      f.seg(`${key}.useActualOtherCosts`, [[false, 'Pauschale'], [true, 'Tatsächliche Kosten']], { cast: 'bool', label: 'Abzug' })
      + (w.useActualOtherCosts ? f.chf(`${key}.actualOtherCosts`, 'Tatsächliche Kosten (Aufstellung beilegen)', { ziffer: '3.2' })
        : '<p class="muted small">Kanton: Fr. 700 plus 10% des Nettolohns, höchstens Fr. 2’400 · Bund: 3% des Nettolohns, mindestens Fr. 2’000, höchstens Fr. 4’000</p>')
      + live(`other${i}`))
    + section('', `<details class="more" data-more="w${i}"${open[`w${i}`] ? ' open' : ''}><summary>${title}: Wochenaufenthalt und Nebenerwerb</summary>
      ${f.toggle(`${key}.weeklyStay`, 'Wochenaufenthalt am Arbeitsort')}
      ${w.weeklyStay ? f.int(`${key}.weeklyStayMonths`, 'Monate') + f.chf(`${key}.weeklyStayRoomPerMonth`, 'Zimmer pro Monat (Fr. 500 bis 800)') + f.int(`${key}.weeklyStayDays`, 'Tage auswärtige Verpflegung', { unit: 'Tage' }) + f.toggle(`${key}.weeklyStayMealsReduced`, 'Mittagessen durch Arbeitgeber verbilligt', { rerender: false }) : ''}
      ${salaries.some((s) => !s.isMainEmployment) ? f.toggle(`${key}.sideJobUseActual`, 'Nebenerwerb: tatsächliche Kosten statt Pauschale (20%)') + (w.sideJobUseActual ? f.chf(`${key}.sideJobActualCosts`, 'Kosten Nebenerwerb') : '') : ''}
      ${live(`weekly${i}`)}</details>`);
}

const wb = (r, j, i) => r.work?.[j]?.[i] || newWorkBreakdown();

// ---------------------------------------------------------------- Liechtenstein
function liSections(c, i) {
  const ckey = `commute${i + 1}`;
  const k = M.liExtras(c)[ckey];
  if (!c.li) c.li = M.liExtras(c);
  const salaries = c[`income${i + 1}`].salaries;
  const title = esc(name(c, i));
  const f = fields(c);
  const orte = store.liRules.fahrkostenOrte.map((o) => [o, o]);
  const key = `li.${ckey}`;
  if (!salaries.length) {
    return section(`Gewinnungskosten ${title}`, empty('briefcase', 'Kein Lohnausweis erfasst', 'Gewinnungskosten gibt es nur bei unselbständiger Erwerbstätigkeit. Erfassen Sie zuerst den Lohnausweis unter «Einkommen».'));
  }
  const full = fahrkostenInland(store.liRules, k.from, k.to);
  return section(`Arbeitsweg und Verpflegung – ${title}`,
      f.select(`${key}.mode`, 'Arbeitsweg', [['inland', 'Wohn- und Arbeitsort in Liechtenstein'], ['ausland', 'Wohn- oder Arbeitsort im Ausland']])
      + (k.mode !== 'ausland'
        ? f.select(`${key}.from`, 'Von', [['', '–'], ...orte]) + f.select(`${key}.to`, 'Nach', [['', '–'], ...orte])
          + (full ? staticRow('Amtliche Tabelle (220 Tage)', `${chf(full)} CHF`) : '')
        : f.int(`${key}.kmPerDay`, 'Distanz', { unit: 'km pro Arbeitstag (hin und zurück)', help: '50 Rappen pro km bis 10’000 km im Jahr, darüber 40 Rappen. Höchstens 200 km pro Tag.' }))
      + f.int(`${key}.workDays`, 'Arbeitstage', { unit: 'Tage', showZero: true, help: 'Höchstens 220 Tage im Jahr (Lehrkräfte 200). Bei Teilzeit oder Unterbruch entsprechend weniger.' })
      + f.chf(`${key}.reimbursed`, 'Abzüglich Kostenentschädigungen', { help: 'Was Arbeitgeber oder Mitfahrer an die Fahrkosten bezahlt haben.' })
      + f.int(`${key}.mealDays`, 'Auswärtige Hauptmahlzeiten', { unit: 'Tage', help: 'CHF 5 pro Tag, höchstens CHF 1’100. Nicht bei verbilligter Personalkantine oder Gutscheinen.' }))
    + section('', live(`li${i}`));
}

export default {
  render(c) {
    const joint = M.isJoint(c);
    if (store.isLI) {
      return header('Gewinnungskosten', 'Ziffer 16.1 und Hilfsformular A2. Abgezogen wird mindestens die Pauschale von CHF 1’600 – höhere Fahr- und Verpflegungskosten zählen, wenn sie darüber liegen.', 'work')
        + liSections(c, 0) + (joint ? liSections(c, 1) : '');
    }
    return header('Berufskosten', 'Formular 4 – Arbeitsweg, Verpflegung und übrige Kosten für unselbständig Erwerbende. Der Abzug für Kanton und Bund wird sofort berechnet.', 'work')
      + sgSections(c, 0) + (joint ? sgSections(c, 1) : '');
  },
  live: {
    ...Object.fromEntries([0, 1].flatMap((i) => [
      [`commute${i}`, (r) => {
        const k = wb(r, 'canton', i), b = wb(r, 'federal', i);
        return resultRow('Fahrkosten', k.commute, b.commute)
          + (k.commuteUncapped > k.commute ? `<p class="small warn-text">Begrenzt auf Fr. ${chf(store.rules.cantonal.berufskosten.fahrkostenMax)} (Kanton). Für die Bundessteuer gilt max. Fr. 3’300.</p>` : '');
      }],
      [`total${i}`, (r) => `Total: Kanton ${chf(workTotal(wb(r, 'canton', i)))} · Bund ${chf(workTotal(wb(r, 'federal', i)))}`],
      [`meals${i}`, (r) => resultRow('Verpflegung', wb(r, 'canton', i).meals, wb(r, 'federal', i).meals)],
      [`other${i}`, (r) => resultRow('Übrige Berufskosten', wb(r, 'canton', i).other, wb(r, 'federal', i).other)],
      [`weekly${i}`, (r) => resultRow('Wochenaufenthalt und Nebenerwerb', wb(r, 'canton', i).weeklyStay + wb(r, 'canton', i).sideJob, wb(r, 'federal', i).weeklyStay + wb(r, 'federal', i).sideJob)],
      [`li${i}`, (r) => {
        const b = wb(r, 'canton', i);
        return resultRow('Fahrkosten', b.commute) + resultRow('Verpflegung', b.meals)
          + (b.other > 0 ? resultRow('Aufgerundet auf die Pauschale', b.other) : '') + resultRow('Abzug Gewinnungskosten', workTotal(b));
      }],
    ])),
  },
  after(el) {
    el.querySelectorAll('details[data-more]').forEach((d) => d.addEventListener('toggle', () => { open[d.dataset.more] = d.open; }));
  },
};
