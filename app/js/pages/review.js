// Steuerhilfe Web · Prüfen & Sparen (wie ReviewView.swift).
import { store } from '../store.js';
import { icon } from '../icons.js';
import { chf } from '../../engine/money.js';
import { header, esc } from '../forms.js';

const AREA = { familie: 'family', einkommen: 'income', abzuege: 'other', vermoegen: 'wealth' };
const ICON = { error: 'error', warning: 'warn', info: 'info', tip: 'bulb' };

export function noticeRow(n, locked = false) {
  const page = AREA[n.area];
  return `<div class="notice lvl-${n.level}">${icon(ICON[n.level])}
    <div class="nt"><b><span>${esc(n.title)}</span>${n.saving > 0 ? `<em>– ${chf(n.saving)} CHF</em>` : ''}</b>
    ${locked ? `<p><button type="button" class="link" data-paywall="tips">${icon('lock')} Erklärung und Anleitung in der Vollversion</button></p>` : `<p>${esc(n.message)}</p>`}</div>
    ${page ? `<a class="link open" href="#/${page}">Öffnen</a>` : ''}</div>`;
}

export default {
  render() {
    const notices = store.result?.notices || [];
    const problems = notices.filter((n) => n.level === 'error' || n.level === 'warning');
    const infos = notices.filter((n) => n.level === 'info');
    const locked = !store.isUnlocked();
    const card = (title, ic, body) => `<section class="card"><div class="card-head">${icon(ic)}<h3>${title}</h3></div>${body}</section>`;
    return header('Prüfen & Sparen', 'Steuerhilfe prüft Ihre Angaben wie das Steueramt und rechnet aus, wo Sie legal Steuern sparen können.', 'review')
      + card(problems.length ? `Bitte prüfen (${problems.length})` : 'Keine Probleme gefunden', problems.length ? 'warn' : 'checkCircle',
        problems.length ? problems.map((n) => noticeRow(n)).join('') : '<p class="muted">Alle Pflichtangaben sind plausibel. Prüfen Sie trotzdem, ob alle Belege erfasst sind.</p>')
      + card('Sparmöglichkeiten', 'bulb', store.tips.length ? store.tips.map((n) => noticeRow(n, locked)).join('') : '<p class="muted">Keine weiteren Sparmöglichkeiten gefunden.</p>')
      + (infos.length ? card('Hinweise', 'info', infos.map((n) => noticeRow(n)).join('')) : '')
      + card('Grenzsteuersatz', 'percent', `<p>Jeder zusätzlich abgezogene Franken spart Ihnen rund <b>${chf(store.marginalRate, 1)} Rappen</b> Steuern. Ein Abzug von Fr. 1’000 senkt die Steuern also um etwa Fr. ${chf(store.marginalRate * 10)}.</p>`);
  },
};
