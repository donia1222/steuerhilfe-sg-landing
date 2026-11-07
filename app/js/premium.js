// Steuerhilfe Web · Vollversion freischalten (wie PaywallSheet und LockedOverlay der Mac-App).
import { store } from './store.js';
import { icon } from './icons.js';
import { esc } from './forms.js';

export const FEATURES = {
  transfer: 'Übertragung in E-Tax SG / eTax FL',
  pdf: 'Bericht als PDF',
  tips: 'Spartipps im Detail',
  export: 'Datensicherung exportieren',
  cloud: 'Verschlüsselte Cloud-Sicherung',
};

/** Fenster «Vollversion freischalten». */
export function paywall(feature) {
  const m = document.createElement('div');
  m.className = 'modal';
  let success = null;
  const close = () => { m.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  const paint = (error = '') => {
    const notice = store.expiryNotice;
    m.innerHTML = `<div class="modal-box pay" role="dialog" aria-modal="true" aria-labelledby="pw-t">
      <span class="pay-ic">${icon('spark')}</span>
      <h2 id="pw-t">${success ? 'Freigeschaltet' : 'Vollversion freischalten'}</h2>
      ${success ? `
        <p class="ok-line">${icon('checkCircle')} Lizenz für ${esc(success.info.name || 'Sie')} aktiviert</p>
        <p class="muted">Vollversion ${store.licenseExpiresAt ? `gültig bis ${store.licenseExpiresAt.toLocaleDateString('de-CH', { day: 'numeric', month: 'long', year: 'numeric' })}` : 'unbefristet'}</p>
        <button type="button" class="btn btn-brand" data-close>Fertig</button>`
      : `
        ${notice ? `<p class="warn-text">${esc(notice)}</p>` : feature ? `<p class="muted">«${esc(FEATURES[feature])}» ist Teil der Vollversion.</p>` : ''}
        <ul class="benefits">
          <li>${icon('transfer')}Alle Felder für E-Tax SG und eTax FL mit Kopier-Funktion</li>
          <li>${icon('report')}Steuerberechnung als PDF für Ihre Unterlagen</li>
          <li>${icon('bulb')}Alle Spartipps mit Erklärung und Ersparnis</li>
          <li>${icon('lock')}Verschlüsselte Cloud-Sicherung – dieselben Angaben im Browser und in der Mac-App</li>
          <li>${icon('download')}Datensicherung exportieren</li>
        </ul>
        <p class="price"><b>CHF 99</b> <span>pro Jahr und Haushalt</span></p>
        <a class="btn btn-brand wide" href="${store.licenseMailURL()}">${icon('mail')}Lizenz bei Lweb anfragen</a>
        <p class="muted small">Sie erhalten den Lizenzschlüssel per E-Mail von info@lweb.ch. Derselbe Schlüssel gilt auch in der Mac-App.</p>
        <hr>
        <form class="key-form" data-form>
          <label for="pw-key"><b>Lizenzschlüssel schon erhalten?</b></label>
          <textarea id="pw-key" rows="3" placeholder="SGSTEUER-…" spellcheck="false" autocomplete="off"></textarea>
          ${error ? `<p class="warn-text small">${icon('warn')} ${esc(error)}</p>` : ''}
          <div class="mfoot"><button type="button" class="btn btn-ghost" data-close>Später</button><button type="submit" class="btn btn-brand">Freischalten</button></div>
        </form>`}
    </div>`;
    m.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    m.querySelector('[data-form]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const raw = m.querySelector('#pw-key').value;
      try { success = await store.activateLicense(raw); paint(); } catch (err) { paint(err.message); m.querySelector('#pw-key').value = raw; }
    });
  };
  m.addEventListener('click', (e) => { if (e.target === m) close(); });
  document.addEventListener('keydown', key);
  document.body.appendChild(m);
  paint();
}

/** Überlagerung für gesperrte Bereiche in der Testversion. */
export const lockedOverlay = (feature, text) => `<div class="locked">
  <div class="locked-box">${icon('lock')}<h3>${esc(FEATURES[feature])}</h3><p>${esc(text)}</p>
  <button type="button" class="btn btn-brand" data-paywall="${feature}">${icon('spark')}Vollversion freischalten</button></div></div>`;

// Jeder Knopf mit data-paywall öffnet das Fenster.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-paywall]');
  if (b) { e.preventDefault(); paywall(b.dataset.paywall || null); }
});
