// Steuerhilfe Web · Bericht & Export (wie ReportView.swift): Zusammenfassung, PDF (Drucken), Sicherung.
import { store, LI_ENABLED, normalizeCase } from '../store.js';
import { icon } from '../icons.js';
import { chf } from '../../engine/money.js';
import * as M from '../../engine/model.js';
import { billTotals, differsFederally } from '../../engine/calculator.js';
import { header, confirmDialog, esc } from '../forms.js';
import { toast } from './transfer.js';

function summary(r, c) {
  const b = r.bill, t = billTotals(b);
  const row = (l, k, f) => `<tr><td>${l}</td><td>${k === null ? '' : chf(k, 2)}</td><td>${f === null ? '' : chf(f, 2)}</td></tr>`;
  if (M.taxRegion(c) === 'li') {
    return `<table class="sum li"><tbody>
      <tr><td>Steuerbarer Gesamterwerb (inkl. Sollertrag)</td><td>${chf(b.taxableIncomeCanton, 2)}</td></tr>
      <tr><td>Gesamtvermögen per 1. Januar</td><td>${chf(b.taxableWealth, 2)}</td></tr>
      <tr class="sep"><td>Landessteuer (${chf(b.simpleIncomeRatePercent, 2)}% des Erwerbs)</td><td>${chf(t.cantonTotal, 2)}</td></tr>
      <tr><td>Gemeindesteuer ${esc(c.municipality)} (${chf(b.municipalityRate)}% Zuschlag)</td><td>${chf(t.municipalityTotal, 2)}</td></tr>
      <tr class="tot"><td>Total Landes- und Gemeindesteuer</td><td>CHF ${chf(t.total, 2)}</td></tr></tbody></table>`;
  }
  return `<table class="sum"><thead><tr><th></th><th>Kanton</th><th>Bund</th></tr></thead><tbody>
    ${row('Steuerbares Einkommen', b.taxableIncomeCanton, b.taxableIncomeFederal)}
    ${row('Steuerbares Vermögen', b.taxableWealth, null)}
    <tr class="sep"><td colspan="3"></td></tr>
    ${row(`Einfache Steuer Einkommen (${chf(b.simpleIncomeRatePercent, 3)}%)`, b.simpleIncomeTax, null)}
    ${row('Einfache Steuer Vermögen (1,7‰)', b.simpleWealthTax, null)}
    ${row(`Kantonssteuer ${chf(b.cantonRate)}%`, t.cantonTotal, null)}
    ${row(`Gemeindesteuer ${chf(b.municipalityRate)}%`, t.municipalityTotal, null)}
    ${t.churchTotal > 0 ? row(`Kirchensteuer ${chf(b.churchRate, 1)}%`, t.churchTotal, null) : ''}
    ${row('Direkte Bundessteuer', null, b.federal)}
    <tr class="tot"><td>Total Steuern</td><td>${chf(t.cantonAndMunicipalityTotal, 2)}</td><td>${chf(b.federal, 2)}</td></tr>
    <tr><td class="muted">Gesamtbelastung</td><td colspan="2"><b>CHF ${chf(t.total, 2)}</b></td></tr></tbody></table>`;
}

/** Druckansicht (wird als PDF gespeichert). Wie PDFReport.swift: Zusammenfassung, alle Abschnitte, Hinweise. */
function printView(r, c) {
  const li = M.taxRegion(c) === 'li';
  const names = M.persons(c).map(M.displayName).join(' und ');
  const section = (s) => `<h3>Seite ${s.page} · ${esc(s.title)}</h3><table class="lines"><thead><tr><th>Ziffer</th><th>Feld</th><th>Bezeichnung</th><th>${li ? 'Betrag' : 'Kanton'}</th>${li ? '' : '<th>Bund</th>'}</tr></thead><tbody>
    ${s.lines.filter((l) => l.canton !== 0 || l.kind === 'total' || (l.federal ?? 0) !== 0).map((l) => `<tr class="${l.kind}"><td>${esc(l.ziffer)}</td><td>${esc(l.code)}</td><td>${esc(l.label)}${l.note ? `<br><small>${esc(l.note)}</small>` : ''}</td><td>${chf(l.canton)}</td>${li ? '' : `<td>${differsFederally(l) ? chf(l.federal) : ''}</td>`}</tr>`).join('')}</tbody></table>`;
  const notices = r.notices.filter((n) => n.level !== 'tip');
  return `<div class="print-doc">
    <header><div><h1>Steuerberechnung ${c.year}${li ? ' – Liechtenstein' : ''}</h1><p>${esc(names)} · ${esc(c.municipality)}</p></div><p>Steuerhilfe · ${li ? 'Steuererklärung Liechtenstein' : 'Steuererklärung Kanton St.Gallen'}<br>${new Date().toLocaleDateString('de-CH')}</p></header>
    ${summary(r, c)}
    ${r.sections.map(section).join('')}
    ${notices.length ? `<h3>Hinweise</h3><ul>${notices.map((n) => `<li><b>${esc(n.title)}:</b> ${esc(n.message)}</li>`).join('')}</ul>` : ''}
    <footer>Berechnet mit Steuerhilfe (steuerhilfe.sg). Unabhängiges Produkt – kein Angebot des Kantons St.Gallen, der Steuerverwaltung Liechtenstein oder der ESTV. Berechnungen ohne Gewähr.</footer>
  </div>`;
}

export default {
  render(c) {
    const r = store.result;
    const unlocked = store.isUnlocked();
    const card = (title, ic, body) => `<section class="card"><div class="card-head">${icon(ic)}<h3>${title}</h3></div>${body}</section>`;
    return header('Bericht & Export', 'Steuerberechnung als PDF für Ihre Unterlagen, Datensicherung und Übernahme ins nächste Jahr.', 'report')
      + card(`Steuerberechnung ${store.year}`, 'doc', summary(r, c)
        + `<div class="btns"><button type="button" class="btn btn-brand" ${unlocked ? 'data-act="pdf"' : 'data-paywall="pdf"'}>${icon(unlocked ? 'print' : 'lock')}Als PDF speichern …</button>
           <button type="button" class="btn btn-ghost" ${unlocked ? 'data-act="export"' : 'data-paywall="export"'}>${icon(unlocked ? 'download' : 'lock')}Datensicherung exportieren …</button>
           <label class="btn btn-ghost">${icon('upload')}Sicherung laden …<input type="file" accept="application/json,.json" data-import hidden></label></div>`)
      + card('Daten', 'lock', `<p class="muted">${unlocked ? 'Ihre Angaben werden verschlüsselt in Ihrem Konto gesichert (Server in der Schweiz) und sind in jedem Browser und in der Mac-App dieselben. Zusätzlich können Sie jederzeit eine Datensicherung als Datei exportieren.' : 'In der Testversion liegen Ihre Angaben nur in diesem Browser. Mit der Vollversion werden sie verschlüsselt in Ihrem Konto gesichert. Beim Abmelden oder Löschen der Browserdaten gehen sie sonst verloren.'}</p>
        <div class="btns"><button type="button" class="btn btn-ghost danger" data-act="reset">${icon('trash')}Steuerjahr ${store.year} zurücksetzen</button></div>`)
      + card('Über Steuerhilfe', 'info', `<p class="muted">Steuerhilfe rechnet für den <b>Kanton St.Gallen</b> (Kantons-, Gemeinde-, Kirchen- und direkte Bundessteuer)${LI_ENABLED ? ' und für <b>Liechtenstein</b> (Landes- und Gemeindesteuer). Weitere Kantone sind in Vorbereitung.' : '. Eine Version für <b>Liechtenstein</b> ist in Vorbereitung, weitere Kantone folgen.'} Sie möchten die App für Ihren Kanton? Kontaktieren Sie uns – wir erstellen gerne eine Version dafür.</p>
        <div class="btns"><a class="btn btn-ghost" href="mailto:info@lweb.ch?subject=Steuerhilfe%20f%C3%BCr%20meinen%20Kanton">${icon('mail')}Version für meinen Kanton anfragen</a><a class="btn btn-ghost" href="../">steuerhilfe.sg</a></div>
        <p class="muted small">Lweb · Sevelen SG · Unabhängiges Produkt – kein Angebot des Kantons St.Gallen oder der ESTV. Berechnungen ohne Gewähr.</p>`);
  },
  after(el) {
    el.querySelector('[data-import]')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const cases = data.cases;
        if (!cases || typeof cases !== 'object') throw new Error();
        if (!(await confirmDialog('Sicherung laden?', `Die Steuerjahre in «${file.name}» ersetzen die Angaben in diesem Browser.`, 'Laden', false))) return;
        const ok = Object.entries(cases).map(([y, c]) => [y, normalizeCase(y, c)]).filter(([, c]) => c);
        if (!ok.length) throw new Error();
        for (const [y, c] of ok) store.cases[String(c.year)] = c;
        if (Array.isArray(data.transferChecked)) store.transferChecked = data.transferChecked;
        store.save();
        await store.recalculate();
        store.emit('change');
        toast('Sicherung geladen');
      } catch { toast('Diese Datei ist keine Steuerhilfe-Sicherung.'); }
    });
  },
  actions: {
    pdf(c) {
      document.getElementById('print')?.remove();
      const p = document.createElement('div');
      p.id = 'print';
      p.innerHTML = printView(store.result, c);
      document.body.appendChild(p);
      const old = document.title;
      document.title = [c.person1.lastName, 'Steuern', c.year].filter(Boolean).join(' ');
      window.print();
      document.title = old;
      return false;
    },
    export() {
      const blob = new Blob([JSON.stringify({ format: 'steuerhilfe', v: 1, exported: new Date().toISOString(), cases: store.cases, transferChecked: store.transferChecked }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'Steuerhilfe-Sicherung.json';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      return false;
    },
    async reset() {
      if (!(await confirmDialog(`Steuerjahr ${store.year} zurücksetzen?`, 'Alle Angaben dieses Jahres in diesem Browser werden gelöscht. Haben Sie eine Datensicherung, können Sie sie danach wieder laden.', 'Zurücksetzen'))) return false;
      await store.resetYear();
      return false;
    },
  },
};
