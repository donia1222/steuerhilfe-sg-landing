// Steuerhilfe Web · Anmelden ist Pflicht: die App liegt unscharf dahinter, bis E-Mail und Code stimmen.
// Ein Konto für Browser und Mac-App (wie CloudSetupSheet der Mac-App, aber ohne «später»).
import { cloud } from './cloud.js';
import { icon } from './icons.js';
import { esc } from './forms.js';

/** Zeigt das Anmeldefenster und wartet, bis die Anmeldung geklappt hat. */
let open = null;   // läuft schon ein Anmeldefenster? Dann dasselbe zurückgeben, kein zweites.

export function loginGate(opts = {}) {
  if (!open) open = showGate(opts).finally(() => { open = null; });
  return open;
}

function showGate({ reason = '' } = {}) {
  const app = document.getElementById('app');
  app.classList.add('gated');
  app.setAttribute('aria-hidden', 'true');
  app.inert = true;

  return new Promise((resolve) => {
    const m = document.createElement('div');
    m.className = 'modal login';
    let step = 'email', email = cloud.email || '', busy = false, error = reason, info = '';

    const paint = () => {
      m.innerHTML = `<div class="modal-box login-box" role="dialog" aria-modal="true" aria-labelledby="lg-t">
        <img src="../img/icon-192.png" alt="">
        ${step === 'email' ? `
          <h2 id="lg-t">Anmelden</h2>
          <p>Mit Ihrer E-Mail-Adresse – ohne Passwort. Sie erhalten einen Code per E-Mail. Dasselbe Konto gilt auch in der Mac-App.</p>
          <form data-form novalidate>
            <label class="lg-lbl" for="lg-email">E-Mail-Adresse</label>
            <input id="lg-email" class="lg-input" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" required value="${esc(email)}" placeholder="name@beispiel.ch">
            ${error ? `<p class="lg-err" role="alert">${icon('warn')}<span>${esc(error)}</span></p>` : ''}
            <button class="btn btn-brand wide" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Wird gesendet …' : 'Code senden'}</button>
          </form>
          <ul class="lg-points">
            <li>${icon('lock')}<span>Mit der Vollversion wird Ihre Steuererklärung verschlüsselt gesichert – Server in der Schweiz.</span></li>
            <li>${icon('overview')}<span>Im Browser und in der Mac-App dieselben Angaben, auf jedem Gerät.</span></li>
          </ul>`
        : `
          <h2 id="lg-t">Code eingeben</h2>
          <p>Wir haben einen 6-stelligen Code an <b>${esc(email)}</b> gesendet. Er gilt 10 Minuten. Kein E-Mail? Schauen Sie auch im Spam-Ordner nach.</p>
          <form data-form novalidate>
            <label class="lg-lbl" for="lg-code">Code aus der E-Mail</label>
            <input id="lg-code" class="lg-input lg-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="7" pattern="[0-9 ]*" required placeholder="123456">
            ${error ? `<p class="lg-err" role="alert">${icon('warn')}<span>${esc(error)}</span></p>` : info ? `<p class="lg-ok" role="status">${icon('checkCircle')}<span>${esc(info)}</span></p>` : ''}
            <button class="btn btn-brand wide" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Wird geprüft …' : 'Anmelden'}</button>
          </form>
          <p class="lg-links"><button type="button" class="link" data-back>Andere E-Mail-Adresse</button><span aria-hidden="true">·</span><button type="button" class="link" data-again ${busy ? 'disabled' : ''}>Code erneut senden</button></p>`}
        <p class="foot"><a href="../">Zurück zu steuerhilfe.sg</a></p>
      </div>`;
      const input = m.querySelector('.lg-input');
      setTimeout(() => input?.focus(), 30);
      m.querySelector('[data-form]').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
      if (step === 'code') {
        input.addEventListener('input', () => { if (input.value.replace(/\D/g, '').length === 6 && !busy) submit(); });
        m.querySelector('[data-back]').addEventListener('click', () => { step = 'email'; error = ''; info = ''; paint(); });
        m.querySelector('[data-again]').addEventListener('click', () => send(true));
      }
    };

    const send = async (again = false) => {
      busy = true; error = ''; info = ''; paint();
      try {
        await cloud.requestCode(email);
        step = 'code';
        if (again) info = 'Ein neuer Code ist unterwegs.';
      } catch (e) { error = e.message; }
      busy = false; paint();
    };

    const submit = async () => {
      if (busy) return;
      if (step === 'email') {
        email = m.querySelector('#lg-email').value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { error = 'Bitte geben Sie eine gültige E-Mail-Adresse ein.'; paint(); return; }
        await send();
        return;
      }
      const code = m.querySelector('#lg-code').value.replace(/\D/g, '');
      if (code.length !== 6) { error = 'Der Code hat 6 Ziffern.'; info = ''; paint(); return; }
      busy = true; error = ''; info = ''; paint();
      m.querySelector('#lg-code').value = code;
      try {
        await cloud.verify(email, code);
        m.remove();
        app.classList.remove('gated');
        app.removeAttribute('aria-hidden');
        app.inert = false;
        resolve();
        return;
      } catch (e) {
        error = e.code === 'codigo' && e.quedan ? `${e.message} Noch ${e.quedan} Versuch${e.quedan === 1 ? '' : 'e'}.` : e.message;
        if (e.code === 'codigo_caducado' || e.code === 'codigo_quemado') info = '';
      }
      busy = false; paint();
    };

    document.body.appendChild(m);
    paint();
  });
}
