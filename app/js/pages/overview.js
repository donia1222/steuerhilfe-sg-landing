// Steuerhilfe Web · Übersicht (wie OverviewView.swift).
import { store, LI_ENABLED } from '../store.js';
import { icon } from '../icons.js';
import { chf } from '../../engine/money.js';
import { billTotals, resultValue } from '../../engine/calculator.js';
import * as M from '../../engine/model.js';
import { esc } from '../main.js';

const COLORS = { canton: 'var(--canton)', municipality: 'var(--municipality)', church: 'var(--church)', federal: 'var(--federal)' };

function donut(slices, centerLabel, centerValue) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const R = 70, C = 2 * Math.PI * R, gap = slices.length > 1 ? 3 : 0;
  let offset = 0;
  const arcs = total > 0 ? slices.map((s) => {
    const len = (s.value / total) * C;
    const a = `<circle cx="95" cy="95" r="${R}" fill="none" stroke="${s.color}" stroke-width="26" stroke-dasharray="${Math.max(len - gap, 0.1)} ${C}" stroke-dashoffset="${-offset}"/>`;
    offset += len;
    return a;
  }).join('') : `<circle cx="95" cy="95" r="${R}" fill="none" stroke="var(--line)" stroke-width="26"/>`;
  return `<div class="donut"><svg viewBox="0 0 190 190" role="img" aria-label="Aufteilung der Steuern">${arcs}</svg>
    <div class="mid"><small>${centerLabel}</small><b>${centerValue}</b></div></div>`;
}

function subtitle(c) {
  const parts = [c.municipality];
  parts.push(M.isJoint(c) ? 'gemeinsam besteuert' : M.isSingleParent(c) ? 'Einelternfamilie' : 'alleinstehend');
  const k = M.deductibleChildren(c).length;
  if (k) parts.push(`${k} Kind${k === 1 ? '' : 'er'}`);
  return parts.map(esc).join(' · ');
}

function steps(c) {
  const joint = M.isJoint(c);
  const personsOK = !!c.person1.lastName && (!joint || !!c.person2.lastName);
  const incomeOK = c.income1.salaries.length > 0 || c.income1.ahvPension > 0 || c.income1.selfEmployment > 0;
  const w = c.deductions1.work;
  const workOK = store.isLI ? !!(M.liExtras(c).commute1.from || M.liExtras(c).commute1.mealDays) : (w.publicTransportCost > 0 || w.carKmOneWay > 0 || w.useBicycle || w.meals !== 'keine');
  const pensionOK = store.isLI ? c.income1.salaries.length > 0 : c.householdDeductions.healthInsurancePremiums > 0;
  const wealthOK = c.securities.length > 0;
  const nSal = c.income1.salaries.length + c.income2.salaries.length;
  return [
    { id: 'family', title: 'Personen & Familie', done: personsOK, detail: personsOK ? `${M.persons(c).length} Person(en), ${c.children.length} Kind(er)` : 'Namen, Geburtsdaten, Konfession' },
    { id: 'documents', title: 'Belege', done: false, detail: 'Lohnausweise, Bescheinigungen hochladen' },
    { id: 'income', title: 'Einkommen', done: incomeOK, detail: incomeOK ? `${nSal} Lohnausweis(e)` : 'Lohnausweis erfassen' },
    { id: 'work', title: 'Berufskosten', done: workOK, detail: workOK ? 'erfasst' : 'Arbeitsweg, Verpflegung' },
    { id: 'pension', title: 'Vorsorge & Versicherungen', done: pensionOK, detail: pensionOK ? 'Prämien erfasst' : (store.isLI ? 'Pensionskasse, Einkäufe' : '3a, Krankenkasse') },
    { id: 'wealth', title: 'Vermögen & Schulden', done: wealthOK, detail: wealthOK ? `${c.securities.length} Konto/Konten` : (store.isLI ? 'Konten und Wertschriften per 1.1.' : 'Konten und Wertschriften per 31.12.') },
  ];
}

const isEmptyCase = (c) => !c.person1.lastName && !c.income1.salaries.length && !c.securities.length && !c.children.length;

export function renderOverview(el) {
  const r = store.result;
  if (!r) { el.innerHTML = ''; return; }
  const c = store.current;
  const b = r.bill;
  const t = billTotals(b);
  const li = store.isLI;
  const y = store.year;

  const slices = [
    { value: t.cantonTotal, color: COLORS.canton },
    { value: t.municipalityTotal, color: COLORS.municipality },
    { value: t.churchTotal, color: COLORS.church },
    { value: b.federal, color: COLORS.federal },
  ].filter((s) => s.value > 0);
  const leg = (label, value, color) => `<div><small><i style="background:${color}"></i>${label}</small><b>${chf(value)}</b></div>`;
  const legend = (li
    ? [leg('Landessteuer', t.cantonTotal, COLORS.canton), leg(`Gemeinde ${chf(b.municipalityRate)}%`, t.municipalityTotal, COLORS.municipality)]
    : [leg(`Kanton ${chf(b.cantonRate)}%`, t.cantonTotal, COLORS.canton), leg(`Gemeinde ${chf(b.municipalityRate)}%`, t.municipalityTotal, COLORS.municipality)])
    .concat(t.churchTotal > 0 ? [leg(`Kirche ${chf(b.churchRate, Number.isInteger(b.churchRate) ? 0 : 1)}%`, t.churchTotal, COLORS.church)] : [])
    .concat(li ? [] : [leg('Bund', b.federal, COLORS.federal)]).join('');

  const st = steps(c);
  const done = st.filter((s) => s.done).length;

  const tips = store.tips.slice(0, 4);
  const tipTotal = store.tips.filter((x) => x.level === 'tip').reduce((s, x) => s + (x.saving || 0), 0);
  const locked = !store.isUnlocked();

  const tile = (title, value, caption, ic, color) => `<div class="card tile" style="--t:${color || 'var(--brand)'}"><small>${icon(ic)}${title}</small><b>${value}</b><p>${caption}</p></div>`;
  const tiles = li ? [
    tile('Steuerbarer Erwerb', chf(b.taxableIncomeCanton), `inkl. Sollertrag ${chf(resultValue(r, '568'))}`, 'sum'),
    tile('Gesamtvermögen', chf(b.taxableWealth), '4 % davon zählen als Erwerb', 'pie', 'var(--wealth)'),
    tile('Grenzsteuersatz', `${chf(store.marginalRate, 1)} %`, 'auf jedem zusätzlichen Franken', 'percent', 'var(--orange)'),
    tile('Gemeindezuschlag', `${chf(b.municipalityRate)} %`, `${esc(c.municipality)} · auf die Landessteuer`, 'building', 'var(--green)'),
  ] : [
    tile('Steuerbares Einkommen', chf(b.taxableIncomeCanton), `Bund: ${chf(b.taxableIncomeFederal)}`, 'sum'),
    tile('Steuerbares Vermögen', chf(b.taxableWealth), `Vermögenssteuer ${chf(b.cantonWealth + b.municipalityWealth + b.churchWealth)}`, 'pie', 'var(--wealth)'),
    tile('Grenzsteuersatz', `${chf(store.marginalRate, 1)} %`, 'auf jedem zusätzlichen Franken', 'percent', 'var(--orange)'),
    tile('Verrechnungssteuer zurück', chf(r.withholdingTaxRefund, 2), 'wird an die Steuern angerechnet', 'refund', 'var(--green)'),
  ];

  const dates = li ? [
    [y === 2025 ? '24. April 2026' : 'Frist laut Steuererklärung', `Abgabefrist Steuererklärung ${y} – Fristverlängerung bei der Gemeindesteuerkasse (über einen Monat nur mit 80 % Vorauszahlung)`],
    [`31. Dezember ${y}`, `Letzter Tag für Einkäufe in die Pensionskasse ${y}`],
  ] : [
    [`31. März ${y + 1}`, `Einreichefrist Steuererklärung ${y} (Fristverlängerung online möglich)`],
    [`31. Dezember ${y}`, `Letzter Tag für Einzahlungen in die Säule 3a und Pensionskassen-Einkäufe ${y}`],
    [`31. Juli ${y}`, `Verfalltag der Steuern ${y} – frühere Zahlungen werden verzinst (Ausgleichszins)`],
  ];

  el.innerHTML = `
    ${isEmptyCase(c) ? `<div class="demo-hint">${icon('spark')}<p><b>Noch leer.</b> Beginnen Sie bei «Personen &amp; Familie» – oder schauen Sie sich zuerst eine Beispielfamilie an.</p>
      <button class="btn btn-ghost" type="button" data-demo>Beispiel ansehen</button><a class="btn btn-brand" href="#/family">Loslegen</a></div>` : ''}
    <section class="card hero">
      <div class="hero-txt">
        <div class="lbl">Geschätzte Steuern ${y}</div>
        <div class="hero-sum">CHF ${chf(t.total)}</div>
        <div class="hero-sub">${subtitle(c)}</div>
        <div class="legend">${legend}</div>
      </div>
      ${donut(slices, li ? 'Gemeindezuschlag' : 'Steuerfuss', `${chf(li ? b.municipalityRate : t.totalRate)}%`)}
    </section>
    <div class="row2">
      <section class="card">
        <div class="card-head">${icon('doc')}<h3>Fortschritt</h3><span class="trail">${done} von ${st.length}</span></div>
        <div class="bar"><i style="width:${(done / st.length) * 100}%"></i></div>
        <div class="steps">${st.map((s) => `<a href="#/${s.id}" class="${s.done ? 'done' : ''}">${icon(s.done ? 'checkCircle' : 'circle')}<span>${s.title}<small>${esc(s.detail)}</small></span>${icon('chevron', 'ic chev')}</a>`).join('')}</div>
      </section>
      <section class="card">
        <div class="card-head">${icon('bulb')}<h3>Sparpotenzial</h3>${tipTotal > 0 ? `<span class="trail" style="color:var(--green);font-weight:700">bis ${chf(tipTotal)} CHF</span>` : ''}</div>
        ${tips.length ? tips.map((x) => `<div class="tip">${icon('bulb')}<div><b><span>${esc(x.title)}</span>${x.saving ? `<em>– ${chf(x.saving)} CHF</em>` : ''}</b>
          ${locked ? `<p><button type="button" class="link" data-paywall="tips">${icon('lock', 'ic')} Erklärung und Anleitung in der Vollversion</button></p>` : `<p>${esc(x.message)}</p>`}</div></div>`).join('')
          + '<p style="margin:10px 0 0"><a class="link" href="#/review">Alle Tipps und Prüfungen</a></p>'
          : `<div class="empty">${icon('checkCircle')}<b>Keine offenen Tipps</b><span>Sobald Daten erfasst sind, rechnet Steuerhilfe mögliche Ersparnisse aus.</span></div>`}
      </section>
    </div>
    <div class="tiles">${tiles.join('')}</div>
    <section class="card">
      <div class="card-head">${icon('calendar')}<h3>Termine</h3></div>
      <div class="dates">${dates.map(([d, txt]) => `<div><b>${d}</b><span>${txt}</span></div>`).join('')}</div>
    </section>
    <p class="note">${icon('pin')}<span>Steuerhilfe rechnet für den Kanton St.Gallen${LI_ENABLED ? ' und für Liechtenstein (Wahl oben)' : ''}. Weitere Kantone folgen – eine Version für Ihren Kanton erstellen wir gerne auf Anfrage.</span>
      <a href="mailto:info@lweb.ch?subject=Steuerhilfe%20f%C3%BCr%20meinen%20Kanton">Anfragen</a></p>`;

  el.querySelector('[data-demo]')?.addEventListener('click', () => store.loadDemo());
}
