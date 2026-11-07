// Steuerhilfe Web · In E-Tax SG / eTax FL übertragen (wie TransferView.swift).
import { store } from '../store.js';
import { icon } from '../icons.js';
import { chf, round } from '../../engine/money.js';
import * as M from '../../engine/model.js';
import { resultFields, differsFederally, workTotal } from '../../engine/calculator.js';
import { header, esc } from '../forms.js';
import { lockedOverlay } from '../premium.js';

let onlyFilled = true;
const key = (code) => (store.isLI ? `li-${store.year}-${code}` : `${store.year}-${code}`);
const locked = () => !store.isUnlocked();
const shown = (v, d = 0) => (locked() ? '••’•••' : chf(v, d));
const copyBtn = (v, label, d = 0, sum = false) => `<button type="button" class="copy${sum ? ' sum' : ''}" data-act="copy" data-v="${round(v, 2)}" data-label="${esc(label)}" title="Betrag kopieren">${shown(v, d)}</button>`;

function fieldRow(l) {
  const k = key(l.code);
  const checked = store.transferChecked.includes(k);
  const isSum = l.kind === 'total' || l.kind === 'subtotal';
  return `<div class="tf-row${checked ? ' done' : ''}">
    ${isSum ? `<span class="tf-chk">${icon('sum')}</span>` : `<button type="button" class="tf-chk" data-act="check" data-k="${k}" aria-pressed="${checked}" title="Erledigt">${icon(checked ? 'checkCircle' : 'circle')}</button>`}
    <span class="tf-code"><span class="ziffer">${esc(l.ziffer)}</span><small>Feld ${esc(l.code)}</small></span>
    <span class="tf-label"><span class="${isSum ? 'b' : ''}">${esc(l.label)}</span>${l.note ? `<small>${esc(l.note)}</small>` : ''}${differsFederally(l) ? `<small>Bund: ${shown(l.federal)}</small>` : ''}</span>
    ${copyBtn(l.canton, l.ziffer, 0, isSum)}</div>`;
}

const simple = (ziffer, code, label, v, d = 0) => `<div class="tf-row"><span class="tf-chk"></span><span class="tf-code">${ziffer ? `<span class="ziffer">${esc(ziffer)}</span>` : ''}${code ? `<small>Feld ${code}</small>` : ''}</span><span class="tf-label">${esc(label)}</span>${copyBtn(v, label, d)}</div>`;
const card = (title, ic, body) => `<section class="card"><div class="card-head">${icon(ic)}<h3>${title}</h3></div>${body}</section>`;

function forms(r, c) {
  let html = '';
  const persons = M.persons(c);
  let work = '';
  persons.forEach((p, i) => {
    const k = r.work.canton?.[i];
    if (!k || workTotal(k) <= 0) return;
    const meals = c[`deductions${i + 1}`].work.meals;
    const mealCode = meals === 'verbilligt' ? (i ? '460' : '410') : meals === 'schicht' ? (i ? '462' : '412') : (i ? '458' : '408');
    work += `<h4 class="sub">${esc(p.firstName || `Person ${i + 1}`)}</h4>`
      + simple('1.1–1.3', i ? '456' : '406', 'Fahrkosten (Zwischentotal)', k.commute)
      + simple('2', mealCode, 'Mehrkosten Verpflegung', k.meals)
      + simple('3', i ? '466' : '416', 'Übrige Berufskosten', k.other)
      + (k.weeklyStay > 0 ? simple('4', i ? '476' : '426', 'Wochenaufenthalt', k.weeklyStay) : '')
      + (k.sideJob > 0 ? simple('5', i ? '482' : '432', 'Nebenerwerb', k.sideJob) : '')
      + simple('6', i ? '488' : '438', 'Total Berufskosten', workTotal(k));
  });
  if (work) html += card('Formular 4 · Berufskosten', 'work', work);
  const ins = r.insurance.canton;
  const hd = c.householdDeductions;
  html += card('Formular 6 · Versicherungsprämien', 'pension',
    simple('A.a', '', 'Krankenversicherung', hd.healthInsurancePremiums) + simple('A.b', '', 'Unfallversicherung', hd.accidentInsurancePremiums)
    + simple('A.c', '', 'Lebens- und Rentenversicherungen', hd.lifeInsurancePremiums) + simple('A.e', '', 'Prämienverbilligung', hd.premiumReduction)
    + simple('A', '', 'Total bezahlt', ins.paid) + simple('B', '', 'Maximaler Abzug', ins.maximum) + simple('C', '600', 'Abzug (Übertrag Ziffer 14)', ins.deduction));
  if (c.securities.length) {
    html += card('Formular 2 · Wertschriftenverzeichnis', 'bank', c.securities.map((s) => `<div class="tf-row sec">
        <span class="tf-chk"><small class="mono">${esc(s.code)}</small></span>
        <span class="tf-label"><span>${esc(s.description || s.institution)}</span>${s.ibanOrValor ? `<small class="mono">${esc(s.ibanOrValor)}</small>` : ''}</span>
        <span class="tf-3">${[['Steuerwert', s.taxValue], ['Ertrag A', s.incomeWithWithholding], ['Ertrag B', s.incomeWithoutWithholding]].map(([lab, v]) => `<span><small>${lab}</small>${copyBtn(v, lab)}</span>`).join('')}</span></div>`).join('')
      + simple('', '999', 'Verrechnungssteueranspruch (35% von Total A)', r.withholdingTaxRefund, 2));
  }
  return html;
}

export default {
  render(c) {
    const r = store.result;
    const li = store.isLI;
    const fields = resultFields(r).filter((l) => l.canton !== 0 && l.kind !== 'total' && l.kind !== 'subtotal');
    const done = fields.filter((l) => store.transferChecked.includes(key(l.code))).length;
    const sections = r.sections.map((s) => {
      const lines = s.lines.filter((l) => l.code && (!onlyFilled || l.canton !== 0 || l.kind === 'total'));
      return card(`Seite ${s.page} · ${esc(s.title)}`, 'doc', lines.length ? lines.map(fieldRow).join('') : '<p class="muted">Keine Beträge auf dieser Seite.</p>');
    }).join('');
    const body = `
      <section class="card tf-top"><div><b>${done} von ${fields.length} Feldern übertragen</b><div class="bar"><i style="width:${fields.length ? (done / fields.length) * 100 : 0}%;background:var(--green)"></i></div></div>
        ${li ? `<a class="btn btn-brand" href="https://www.llv.li/de/landesverwaltung/steuerverwaltung/etax-elektronische-steuererklaerung/etax-aktuell-herunterladen" target="_blank" rel="noopener">${icon('download')}eTax FL herunterladen</a>`
          : `<a class="btn btn-brand" href="https://www.steuern.sg.ch/etaxnp" target="_blank" rel="noopener">${icon('transfer')}E-Tax SG öffnen</a>`}</section>
      <label class="fr tog plain"><span class="lbl"><span>Nur ausgefüllte Felder anzeigen</span></span><span class="ctl"><input type="checkbox" role="switch" data-act="filled"${onlyFilled ? ' checked' : ''}><i></i></span></label>
      ${sections}
      ${li ? card('Hinweis', 'info', '<p class="muted">Die Hilfsformulare (A1 Vermögen, A2 Gewinnungskosten und Versicherungen) füllt eTax aus den Details aus. Die Beträge hier sind die Totale, die auf der Steuererklärung stehen – damit können Sie jede Seite kontrollieren.</p>')
        : forms(r, c) + card('Hinweis zur Bundessteuer', 'info', '<p class="muted">In E-Tax SG erfassen Sie nur die Werte für den Kanton. Die abweichenden Abzüge für die direkte Bundessteuer (z.B. Fahrkosten max. Fr. 3’300, Versicherungsabzug, Zweiverdienerabzug) berechnet das Steueramt automatisch. Die Bundeswerte hier dienen zur Kontrolle.</p>')}`;
    return header(li ? 'In eTax FL übertragen' : 'In E-Tax SG übertragen', li
      ? 'Öffnen Sie eTax Liechtenstein (Programm der Steuerverwaltung) und übertragen Sie Feld für Feld – die Feldnummern sind dieselben wie in der Steuererklärung. Ein Klick auf den Betrag kopiert ihn.'
      : 'Öffnen Sie E-Tax SG (steuern.sg.ch/etaxnp) und übertragen Sie Feld für Feld. Ein Klick auf den Betrag kopiert ihn. Haken setzen, was erledigt ist.', 'transfer')
      + (locked() ? `<div class="locked-wrap"><div class="blurred" aria-hidden="true">${body}</div>${lockedOverlay('transfer', `Alle Felder der Steuererklärung mit Ziffer und Feldnummer – Betrag anklicken, in ${li ? 'eTax FL' : 'E-Tax SG'} einfügen, abhaken. In der Vollversion.`)}</div>` : body);
  },
  actions: {
    check(c, d) {
      const i = store.transferChecked.indexOf(d.k);
      if (i >= 0) store.transferChecked.splice(i, 1); else store.transferChecked.push(d.k);
    },
    filled(c, d, el) { onlyFilled = el.checked; },
    async copy(c, d) {
      if (locked()) return false;
      try { await navigator.clipboard.writeText(String(d.v)); toast(`${d.label}: ${d.v} kopiert`); } catch { toast('Kopieren nicht möglich'); }
      return false;
    },
  },
};

export function toast(text) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.innerHTML = `${icon('copy')}<span>${esc(text)}</span>`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}
