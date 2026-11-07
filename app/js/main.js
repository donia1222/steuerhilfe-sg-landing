// Steuerhilfe Web · Rahmen: Seitenleiste, Symbolleiste, Seitenwechsel, erster Start.
import { store, LI_ENABLED } from './store.js';
import { icon } from './icons.js';
import { SUPPORTED_YEARS } from '../engine/rules.js';
import { chf } from '../engine/money.js';
import { billTotals } from '../engine/calculator.js';
import { renderOverview } from './pages/overview.js';
import { bind } from './forms.js';
import familyPage from './pages/family.js';
import incomePage from './pages/income.js';
import workPage from './pages/work.js';
import pensionPage from './pages/pension.js';
import otherPage from './pages/other.js';
import wealthPage from './pages/wealth.js';
import reviewPage from './pages/review.js';
import transferPage from './pages/transfer.js';
import reportPage from './pages/report.js';
import accountPage from './pages/account.js';
import documentsPage from './pages/documents.js';
import './premium.js';
import { cloud } from './cloud.js';
import { loginGate } from './login.js';
import { toast } from './pages/transfer.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Dieselben Seiten wie in der Mac-App (Page in OrdnigApp.swift).
export const PAGES = [
  { id: 'overview', title: 'Übersicht', icon: 'overview' },
  { id: 'documents', title: 'Belege', icon: 'documents' },
  { id: 'family', title: 'Personen & Familie', icon: 'family', group: 'Steuererklärung' },
  { id: 'income', title: 'Einkommen', icon: 'income', group: 'Steuererklärung' },
  { id: 'work', title: 'Berufskosten', icon: 'work', group: 'Steuererklärung' },
  { id: 'pension', title: 'Vorsorge & Versicherungen', icon: 'pension', group: 'Steuererklärung' },
  { id: 'other', title: 'Weitere Abzüge', icon: 'other', group: 'Steuererklärung' },
  { id: 'wealth', title: 'Vermögen & Schulden', icon: 'wealth', group: 'Steuererklärung' },
  { id: 'review', title: 'Prüfen & Sparen', icon: 'review', group: 'Abschliessen' },
  { id: 'transfer', title: 'In E-Tax SG übertragen', titleLI: 'In eTax FL übertragen', icon: 'transfer', group: 'Abschliessen' },
  { id: 'report', title: 'Bericht & Export', icon: 'report', group: 'Abschliessen' },
  { id: 'account', title: 'Mein Konto', icon: 'account' },
];
export const pageTitle = (p) => (store.isLI && p.titleLI ? p.titleLI : p.title);
export const go = (id) => { location.hash = `#/${id}`; };

const app = document.getElementById('app');
let current = 'overview';

function pageFromHash() {
  const id = (location.hash.match(/^#\/([a-z]+)/) || [])[1];
  return PAGES.some((p) => p.id === id) ? id : 'overview';
}

// ---------------------------------------------------------------- Rahmen
function shell() {
  app.innerHTML = `
    <aside class="side" aria-label="Navigation">
      <a class="brand" href="../" title="Zur Startseite von Steuerhilfe">
        <img src="../img/icon-192.png" alt="" width="34" height="34">
        <span><b>Steuerhilfe</b><small>${LI_ENABLED ? 'St.Gallen · Liechtenstein' : 'Kanton St.Gallen'}</small></span>
      </a>
      <nav class="nav" data-nav></nav>
      <div class="side-foot" data-foot></div>
    </aside>
    <div class="scrim" data-scrim></div>
    <div class="main">
      <header class="top" data-top></header>
      <main class="page" data-page tabindex="-1"></main>
    </div>`;
  app.querySelector('[data-scrim]').addEventListener('click', () => app.classList.remove('drawer'));
}

function renderNav() {
  const badge = store.result ? store.result.notices.filter((n) => n.level === 'error' || n.level === 'warning').length : 0;
  let html = '';
  let group = null;
  for (const p of PAGES.filter((x) => x.id !== 'account')) {
    if (p.group !== group) {
      if (p.group) html += `<h4>${p.group}</h4>`;
      group = p.group;
    }
    const b = p.id === 'review' && badge ? `<span class="badge">${badge}</span>` : '';
    html += `<a href="#/${p.id}" ${p.id === current ? 'aria-current="page"' : ''}>${icon(p.icon)}<span>${esc(pageTitle(p))}</span>${b}</a>`;
  }
  app.querySelector('[data-nav]').innerHTML = html;
  app.querySelector('[data-foot]').innerHTML = `
    <a href="#/account" ${current === 'account' ? 'aria-current="page"' : ''}>${icon('account')}
      <span><b>Mein Konto</b><small>${esc(accountLine())}</small></span></a>`;
}

function accountLine() {
  const plan = store.isUnlocked() ? 'Vollversion' : store.license ? 'Lizenz abgelaufen' : 'Testversion';
  if (!cloud.isSignedIn) return plan;
  if (cloud.isSyncing) return `${plan} · wird gesichert …`;
  if (cloud.lastError) return `${plan} · Sicherung: Problem`;
  if (cloud.isActive && cloud.canWrite) return `${plan} · gesichert`;
  return `${plan} · ${cloud.email}`;
}

function renderTop() {
  const p = PAGES.find((x) => x.id === current);
  const total = store.result ? billTotals(store.result.bill).total : 0;
  app.querySelector('[data-top]').innerHTML = `
    <button class="menu-btn" type="button" aria-label="Menü öffnen" data-menu>${icon('menu')}</button>
    <h1>${esc(pageTitle(p))}</h1>
    <div class="ctrls">
      <div class="seg" role="group" aria-label="Steuerjahr">
        ${SUPPORTED_YEARS.map((y) => `<button type="button" data-year="${y}" aria-pressed="${y === store.year}">${y}</button>`).join('')}
      </div>
      ${LI_ENABLED || store.isLI ? `<label class="pick"><span class="sr" hidden>Wohnort</span>
        <select data-region aria-label="Wohnort">
          <option value="sg" ${store.isLI ? '' : 'selected'}>🇨🇭 St.Gallen</option>
          <option value="li" ${store.isLI ? 'selected' : ''}>🇱🇮 Liechtenstein</option>
        </select>
      </label>` : ''}
    </div>
    <span class="pill" title="${store.isLI ? 'Geschätzte Landes- und Gemeindesteuer' : 'Geschätzte Kantons-, Gemeinde-, Kirchen- und Bundessteuer'}">${icon('doc')}<span>Steuern ${store.year}:</span><b data-total>CHF ${chf(total)}</b></span>`;
  const top = app.querySelector('[data-top]');
  top.querySelector('[data-menu]').addEventListener('click', () => app.classList.add('drawer'));
  top.querySelectorAll('[data-year]').forEach((b) => b.addEventListener('click', () => store.setYear(Number(b.dataset.year))));
  top.querySelector('[data-region]')?.addEventListener('change', (e) => store.setRegion(e.target.value));
}

// Seiten mit Formular: { render(c) → HTML, live: { key: () → HTML }, actions: { … } }
const PAGE_MODULES = { documents: documentsPage, family: familyPage, income: incomePage, work: workPage, pension: pensionPage, other: otherPage, wealth: wealthPage, review: reviewPage, transfer: transferPage, report: reportPage, account: accountPage };

function freshPageEl() {
  const old = app.querySelector('[data-page]');
  const el = document.createElement('main');
  el.className = 'page';
  el.dataset.page = '';
  el.tabIndex = -1;
  old.replaceWith(el);
  return el;
}

/** Live-Bereiche (Ergebnisse unter den Formularen) nach einer Neuberechnung ersetzen. */
function refreshLive() {
  const mod = PAGE_MODULES[current];
  if (!mod?.live || !store.result) return;
  app.querySelectorAll('[data-live]').forEach((box) => {
    const fn = mod.live[box.dataset.live];
    if (fn) box.innerHTML = fn(store.result, store.current);
  });
}

function renderPage() {
  const y = window.scrollY;
  const el = freshPageEl();
  const p = PAGES.find((x) => x.id === current);
  const mod = PAGE_MODULES[current];
  if (current === 'overview') { renderOverview(el); return; }
  if (mod) {
    el.innerHTML = mod.render(store.current);
    refreshLive();
    bind(el, {
      target: () => store.current,
      onInput: () => store.patched(),
      onStructure: (el) => { mod.onChange?.(store.current, el?.dataset.path); store.patched(); renderPage(); },
      actions: Object.fromEntries(Object.entries(mod.actions || {}).map(([k, fn]) => [k, async (data, btn) => {
        const changed = await fn(store.current, data, btn);
        if (changed !== false) { store.patched(); renderPage(); }
      }])),
    });
    mod.after?.(el);
    window.scrollTo(0, y);
    return;
  }
  el.innerHTML = `<div class="card soon">${icon(p.icon)}<h2>${esc(pageTitle(p))}</h2>
    <p>Diese Seite wird gerade gebaut. Die Berechnung läuft schon: Sie sehen den Steuerbetrag oben und in der Übersicht.</p></div>`;
}

function renderAll() {
  renderNav();
  renderTop();
  renderPage();
  document.title = `${pageTitle(PAGES.find((x) => x.id === current))} · Steuerhilfe`;
}

// ---------------------------------------------------------------- Erster Start: Wo wohnen Sie?
function regionChoice() {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="rc-t">
    <img src="../img/icon-192.png" alt="">
    <h2 id="rc-t">Willkommen bei Steuerhilfe</h2>
    <p>Wo wohnen Sie? Danach richten sich Formulare, Abzüge und Berechnung.</p>
    <div class="choices">
      <button class="choice" type="button" data-r="sg"><span class="flag">🇨🇭</span><b>Kanton St.Gallen</b><small>Kantons-, Gemeinde-, Kirchen- und Bundessteuer · E-Tax SG</small></button>
      <button class="choice" type="button" data-r="li"><span class="flag">🇱🇮</span><b>Fürstentum Liechtenstein</b><small>Landes- und Gemeindesteuer · eTax FL</small></button>
    </div>
    <p class="foot">Sie können das jederzeit oben ändern – für jedes Steuerjahr einzeln.</p>
  </div>`;
  document.body.appendChild(m);
  m.querySelector('.choice').focus();
  m.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', async () => {
    m.remove();
    await store.chooseInitialRegion(b.dataset.r);
  }));
}

// ---------------------------------------------------------------- Start
async function start() {
  shell();
  current = pageFromHash();
  await store.loadLicense();
  await store.recalculate();
  renderAll();
  // Zuerst zuhören, dann anmelden und abgleichen: was aus der Cloud kommt, muss auf dem Bildschirm landen.
  // Sitzung abgelaufen oder anderswo abgemeldet: wieder anmelden.
  cloud.addEventListener('signedout', async () => {
    await loginGate({ reason: cloud.lastError || '' });
    toast('Angemeldet');
  });
  cloud.addEventListener('change', () => {
    renderNav();
    if (current === 'account') renderPage();
  });

  window.addEventListener('hashchange', () => {
    current = pageFromHash();
    app.classList.remove('drawer');
    window.scrollTo(0, 0);
    renderAll();
    app.querySelector('[data-page]').focus({ preventScroll: true });
  });
  store.addEventListener('change', renderAll);
  // Nur das Ergebnis hat sich geändert (Eingaben laufen weiter): Betrag und Übersicht nachführen,
  // ohne das Formular neu zu zeichnen.
  store.addEventListener('result', () => {
    renderNav();
    const t = app.querySelector('[data-total]');
    if (t) t.textContent = `CHF ${chf(billTotals(store.result.bill).total)}`;
    if (['overview', 'review', 'transfer', 'report'].includes(current)) renderPage();
    else refreshLive();
  });
  // Anmelden ist Pflicht. Wer schon angemeldet ist, bekommt zuerst den Stand aus der Cloud.
  if (cloud.isSignedIn) await cloud.resume();
  if (!cloud.isSignedIn) { await loginGate({ reason: cloud.lastError || '' }); toast('Angemeldet'); await cloud.sync(); }
  // Von steuerhilfe.li kommend (?land=li): Liechtenstein ist schon gewählt.
  const land = new URLSearchParams(location.search).get('land');
  if (!LI_ENABLED && store.needsRegionChoice) await store.chooseInitialRegion('sg');
  if (store.needsRegionChoice && (land === 'li' || land === 'sg')) await store.chooseInitialRegion(land);
  if (store.needsRegionChoice) regionChoice();

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') app.classList.remove('drawer'); });
}

start().catch((e) => {
  app.innerHTML = `<div class="card soon" style="margin:40px auto;max-width:520px">${icon('error')}<h2>Steuerhilfe konnte nicht starten</h2><p>${esc(e.message)}</p></div>`;
  console.error(e);
});
