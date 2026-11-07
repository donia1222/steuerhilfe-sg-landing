// Steuerhilfe Web · Formular-Bausteine (entsprechen CHFField, IntField, Section … der Mac-App).
// Jedes Feld trägt data-path (z.B. "income1.salaries.0.grossSalary") und data-kind.
// `bind()` schreibt Eingaben in das Objekt zurück; die Seite wird beim Tippen NICHT neu
// gezeichnet (sonst ginge der Fokus verloren), nur bei Änderungen der Struktur.
import { icon } from './icons.js';
import { chf } from '../engine/money.js';
import { inputFromIso, isoFromInput } from '../engine/model.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- Pfade
export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => {
    if (o[k] == null) o[k] = {};
    return o[k];
  }, obj);
  if (value === undefined) delete target[last];
  else target[last] = value;
}

// ---------------------------------------------------------------- Zahlen im Schweizer Format
/** "12’345.50", "12'345,5", "12 345" → 12345.5 ; leer → 0 */
export function parseNum(s) {
  const t = String(s ?? '').trim().replace(/[’'\s]/g, '').replace(',', '.');
  if (!t || t === '-' || t === '.') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}
export const fmtAmount = (v) => (v ? chf(v, Number.isInteger(Math.round(v * 100) / 100) ? 0 : 2) : '');

// ---------------------------------------------------------------- Bausteine
let helpSeq = 0;
const helpBtn = (help) => {
  if (!help) return '';
  const id = `h${++helpSeq}`;
  return `<button type="button" class="info" aria-expanded="false" aria-controls="${id}" data-help="${id}" title="Erklärung">${icon('info')}</button><span class="help" id="${id}" hidden>${esc(help)}</span>`;
};
const badge = (z) => (z ? `<span class="ziffer" title="Ziffer ${esc(z)} der Steuererklärung">${esc(z)}</span>` : '');
const lab = (label, o = {}) => `<span class="lbl">${badge(o.ziffer)}<span>${label}</span>${helpBtn(o.help)}</span>`;

/** Kopf einer Seite (PageHeader). */
export const header = (title, subtitle, ic) => `<header class="ph"><span class="ph-ic">${icon(ic)}</span><div><h2>${esc(title)}</h2><p>${subtitle}</p></div></header>`;

/** Abschnitt (Section) mit Titel. */
export const section = (title, body, o = {}) => `<section class="fs card"${o.id ? ` id="${o.id}"` : ''}>
  ${title ? `<div class="fs-head"><h3>${title}</h3>${helpBtn(o.help)}${o.trail ? `<span class="fs-trail">${o.trail}</span>` : ''}</div>` : ''}
  <div class="fs-body">${body}</div></section>`;

export const row = (label, control, o = {}) => `<div class="fr${o.cls ? ` ${o.cls}` : ''}">${lab(label, o)}<div class="ctl">${control}</div></div>`;
export const note = (text, kind = 'info') => `<p class="fnote${kind === 'warn' ? ' warn' : ''}">${icon(kind === 'warn' ? 'warn' : 'info')}<span>${text}</span></p>`;
export const empty = (ic, title, text) => `<div class="empty">${icon(ic)}<b>${esc(title)}</b><span>${esc(text)}</span></div>`;
export const addBtn = (act, label, data = {}) => `<button type="button" class="add" data-act="${act}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${icon('plus')}<span>${esc(label)}</span></button>`;
export const delBtn = (act, data = {}, title = 'Entfernen') => `<button type="button" class="del" data-act="${act}" title="${title}" aria-label="${title}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${icon('trash')}</button>`;
export const staticRow = (label, value, o = {}) => row(label, `<span class="sval">${value}</span>`, o);

/** Live-Ergebnis (wird nach jeder Neuberechnung ersetzt). */
export const live = (key) => `<div class="live" data-live="${key}"></div>`;

/** ResultRow: Kanton/Bund oder ein Betrag. */
export function resultRow(label, canton, federal) {
  const both = federal !== undefined && federal !== null && federal !== canton;
  return `<div class="rr"><span>${esc(label)}</span>${both
    ? `<span class="rr-v"><b>Kanton ${chf(canton)}</b><small>Bund ${chf(federal)}</small></span>`
    : `<span class="rr-v"><b>${chf(canton)} CHF</b></span>`}</div>`;
}

/** Felder, die ihre Werte aus `src` lesen (meist der aktuelle Steuerfall). */
export function fields(src) {
  const v = (p) => getPath(src, p);
  return {
    chf: (p, label, o = {}) => row(label, `<span class="amt"><input type="text" inputmode="decimal" autocomplete="off" data-path="${p}" data-kind="${o.optional ? 'optchf' : 'chf'}" value="${esc(fmtAmount(v(p)))}" placeholder="${esc(o.prompt ?? '0')}" aria-label="${esc(stripTags(label))}"${o.rerender ? ' data-rerender' : ''}><span class="cur">CHF</span></span>`, o),
    int: (p, label, o = {}) => row(label, `<span class="amt"><input type="text" inputmode="numeric" autocomplete="off" class="short" data-path="${p}" data-kind="int" value="${esc(v(p) ? v(p) : (o.showZero ? 0 : ''))}" placeholder="0" aria-label="${esc(stripTags(label))}"${o.rerender ? ' data-rerender' : ''}>${o.unit ? `<span class="cur">${esc(o.unit)}</span>` : ''}</span>`, o),
    text: (p, label, o = {}) => row(label, `<input type="text" data-path="${p}" data-kind="text" value="${esc(v(p) ?? '')}" placeholder="${esc(o.placeholder ?? '')}" aria-label="${esc(stripTags(label))}" autocomplete="${o.auto || 'off'}"${o.rerender ? ' data-rerender' : ''}>`, o),
    area: (p, label, o = {}) => row(label, `<textarea rows="2" data-path="${p}" data-kind="text" placeholder="${esc(o.placeholder ?? '')}" aria-label="${esc(stripTags(label))}">${esc(v(p) ?? '')}</textarea>`, { ...o, cls: 'wide' }),
    date: (p, label, o = {}) => row(label, `<input type="date" data-path="${p}" data-kind="date" value="${esc(inputFromIso(v(p)))}" max="${new Date().toISOString().slice(0, 10)}" aria-label="${esc(stripTags(label))}"${o.rerender ? ' data-rerender' : ''}>`, o),
    select: (p, label, options, o = {}) => row(label, `<span class="sel"><select data-path="${p}" data-kind="${o.cast || 'text'}"${o.rerender === false ? '' : ' data-rerender'} aria-label="${esc(stripTags(label))}">${options.map(([val, txt]) => `<option value="${esc(val)}"${String(v(p) ?? '') === String(val) ? ' selected' : ''}>${esc(txt)}</option>`).join('')}</select></span>`, o),
    toggle: (p, label, o = {}) => `<label class="fr tog">${lab(label, o)}<span class="ctl"><input type="checkbox" role="switch" data-path="${p}" data-kind="bool"${v(p) ? ' checked' : ''}${o.rerender === false ? '' : ' data-rerender'}><i></i></span></label>`,
    seg: (p, options, o = {}) => `<div class="fr seg-row"${o.label ? '' : ' style="justify-content:flex-start"'}>${o.label ? lab(o.label, o) : ''}<div class="ctl"><div class="seg" role="radiogroup">${options.map(([val, txt]) => `<button type="button" role="radio" aria-checked="${String(v(p)) === String(val)}" aria-pressed="${String(v(p)) === String(val)}" data-path="${p}" data-kind="${o.cast || 'text'}" data-value="${esc(val)}">${esc(txt)}</button>`).join('')}</div></div></div>`,
    // Zellen für Tabellenzeilen (ohne Beschriftung)
    cellChf: (p, aria = 'Betrag') => `<input class="cell num" type="text" inputmode="decimal" autocomplete="off" data-path="${p}" data-kind="chf" value="${esc(fmtAmount(v(p)))}" placeholder="0" aria-label="${aria}">`,
    cellInt: (p, aria, o = {}) => `<input class="cell num${o.cls ? ` ${o.cls}` : ''}" type="text" inputmode="numeric" autocomplete="off" data-path="${p}" data-kind="${o.kind || 'int'}" value="${esc(v(p) ?? '')}" placeholder="${esc(o.placeholder ?? '')}" aria-label="${aria}"${o.rerender ? ' data-rerender' : ''}>`,
    cellText: (p, placeholder) => `<input class="cell" type="text" data-path="${p}" data-kind="text" value="${esc(v(p) ?? '')}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}">`,
    cellCheck: (p, aria) => `<label class="cell-check" title="${esc(aria)}"><input type="checkbox" data-path="${p}" data-kind="bool" data-rerender${v(p) ? ' checked' : ''} aria-label="${esc(aria)}"></label>`,
    cellSelect: (p, options, o = {}) => `<span class="sel cell"><select data-path="${p}" data-kind="${o.cast || 'text'}" data-rerender aria-label="${esc(o.aria || '')}">${options.map(([val, txt]) => `<option value="${esc(val)}"${String(v(p) ?? '') === String(val) ? ' selected' : ''}>${esc(txt)}</option>`).join('')}</select></span>`,
  };
}
const stripTags = (s) => String(s).replace(/<[^>]*>/g, '');

// ---------------------------------------------------------------- Werte lesen
function readValue(el) {
  const kind = el.dataset.kind;
  const raw = el.type === 'checkbox' ? el.checked : (el.dataset.value !== undefined ? el.dataset.value : el.value);
  switch (kind) {
    case 'bool': return el.type === 'checkbox' ? raw : raw === 'true';
    case 'chf': return parseNum(raw);
    case 'optchf': return String(raw).trim() === '' ? undefined : parseNum(raw);
    case 'int': return Math.max(0, Math.round(parseNum(raw)));
    case 'optint': return String(raw).trim() === '' ? undefined : Math.round(parseNum(raw));
    case 'num': return parseNum(raw);
    case 'date': return isoFromInput(raw);
    case 'opttext': return raw === '' ? undefined : raw;
    default: return raw;
  }
}

/**
 * Formular verbinden.
 * opts.target(): Objekt, in das geschrieben wird
 * opts.onInput(path, value): nach jeder Eingabe (ohne Neuzeichnen)
 * opts.onStructure(): nach Änderungen, die das Formular verändern (Auswahl, Schalter, Hinzufügen …)
 * opts.actions: { name(dataset, el) } für Knöpfe mit data-act
 */
export function bind(root, opts) {
  const write = (el) => {
    const path = el.dataset.path;
    if (!path) return;
    const value = readValue(el);
    setPath(opts.target(), path, value);
    opts.onInput?.(path, value);
  };
  root.addEventListener('input', (e) => {
    const el = e.target.closest('[data-path]');
    if (!el || el.type === 'checkbox' || el.tagName === 'SELECT') return;
    write(el);
  });
  root.addEventListener('change', (e) => {
    const el = e.target.closest('[data-path]');
    if (!el) return;
    if (el.type === 'checkbox' || el.tagName === 'SELECT') write(el);
    if (el.dataset.kind === 'chf' || el.dataset.kind === 'optchf') el.value = fmtAmount(getPath(opts.target(), el.dataset.path));
    if (el.hasAttribute('data-rerender')) opts.onStructure?.(el);
  });
  root.addEventListener('click', (e) => {
    const seg = e.target.closest('.seg [data-path]');
    if (seg) { write(seg); opts.onStructure?.(seg); return; }
    const help = e.target.closest('[data-help]');
    if (help) {
      const box = root.querySelector(`#${help.dataset.help}`);
      if (box) {
        box.hidden = !box.hidden;
        help.setAttribute('aria-expanded', String(!box.hidden));
      }
      return;
    }
    const act = e.target.closest('[data-act]');
    if (act && opts.actions?.[act.dataset.act]) {
      e.preventDefault();
      opts.actions[act.dataset.act](act.dataset, act);
    }
  });
  // Beträge beim Verlassen schön formatieren
  root.addEventListener('focusout', (e) => {
    const el = e.target;
    if (el.dataset?.path && (el.dataset.kind === 'chf' || el.dataset.kind === 'optchf')) {
      const val = getPath(opts.target(), el.dataset.path);
      el.value = fmtAmount(val);
    }
  });
  // Beim Hineinklicken den ganzen Betrag markieren (schneller überschreiben)
  root.addEventListener('focusin', (e) => {
    const el = e.target;
    if (el.dataset?.kind === 'chf' || el.dataset?.kind === 'int') setTimeout(() => el.select?.(), 0);
  });
}

// ---------------------------------------------------------------- Fenster
/** Bestätigung (statt window.confirm). */
export function confirmDialog(title, message, confirmLabel = 'Löschen', destructive = true) {
  return new Promise((resolve) => {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="modal-box sm" role="alertdialog" aria-modal="true" aria-labelledby="cd-t">
      <div class="cd-head">${icon(destructive ? 'warn' : 'info')}<h2 id="cd-t">${esc(title)}</h2></div>
      <p>${esc(message)}</p>
      <div class="mfoot"><button type="button" class="btn btn-ghost" data-no>Abbrechen</button>
      <button type="button" class="btn ${destructive ? 'btn-danger' : 'btn-brand'}" data-yes>${esc(confirmLabel)}</button></div></div>`;
    const done = (v) => { m.remove(); document.removeEventListener('keydown', key); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') done(false); };
    m.querySelector('[data-no]').onclick = () => done(false);
    m.querySelector('[data-yes]').onclick = () => done(true);
    m.addEventListener('click', (e) => { if (e.target === m) done(false); });
    document.addEventListener('keydown', key);
    document.body.appendChild(m);
    m.querySelector('[data-yes]').focus();
  });
}

/**
 * Bearbeitungsfenster mit Entwurf (wie die Sheets der Mac-App: «Abbrechen» / «Übernehmen»).
 * render(draft) liefert das Innere; onSave(draft) beim Übernehmen.
 */
export function editDialog({ title, subtitle, ic, draft, render, onSave, actions = {} }) {
  const m = document.createElement('div');
  m.className = 'modal';
  const paint = () => {
    const body = m.querySelector('[data-body]');
    const y = body ? body.scrollTop : 0;
    m.innerHTML = `<div class="modal-box form" role="dialog" aria-modal="true" aria-labelledby="ed-t">
      <div class="mhead">${icon(ic)}<div><h2 id="ed-t">${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div></div>
      <div class="mbody" data-body>${render(draft)}</div>
      <div class="mfoot"><button type="button" class="btn btn-ghost" data-no>Abbrechen</button><button type="button" class="btn btn-brand" data-yes>Übernehmen</button></div></div>`;
    m.querySelector('[data-body]').scrollTop = y;
    m.querySelector('[data-no]').onclick = close;
    m.querySelector('[data-yes]').onclick = () => { onSave(draft); close(); };
  };
  const close = () => { m.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  const wrapped = Object.fromEntries(Object.entries(actions).map(([k, fn]) => [k, (d, el) => { fn(d, el); paint(); }]));
  bind(m, { target: () => draft, onStructure: paint, actions: wrapped });
  document.addEventListener('keydown', key);
  document.body.appendChild(m);
  paint();
  m.querySelector('input,select,textarea')?.focus();
}
