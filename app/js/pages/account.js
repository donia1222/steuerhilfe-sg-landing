// Steuerhilfe Web · Mein Konto (wie AccountView.swift): Anmeldung, Cloud-Sicherung, Geräte, Lizenz.
import { store } from '../store.js';
import { cloud } from '../cloud.js';
import { icon } from '../icons.js';
import { header, confirmDialog, esc } from '../forms.js';
import { toast } from './transfer.js';

const dateCH = (d) => new Date(String(d).replace(' ', 'T')).toLocaleDateString('de-CH', { day: 'numeric', month: 'long', year: 'numeric' });
const timeCH = (d) => d.toLocaleString('de-CH', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
const mb = (n) => (n / 1048576).toLocaleString('de-CH', { maximumFractionDigits: n < 10485760 ? 1 : 0 });

function syncStatus() {
  if (cloud.isSyncing) return `<p class="sync-line">${icon('upload')}Wird gesichert …</p>`;
  if (cloud.lastError) return `<p class="warn-text">${icon('warn')} ${esc(cloud.lastError)}</p>`;
  if (!cloud.canWrite) {
    return `<p class="muted">Mit der Vollversion wird Ihre Steuererklärung verschlüsselt in Ihrem Konto gesichert – Server in der Schweiz. So haben Sie dieselben Angaben in jedem Browser und in der Mac-App. In der Testversion bleiben die Angaben nur in diesem Browser.</p>`;
  }
  if (cloud.needsKey) return '<p class="muted">Die Cloud-Sicherung wird eingerichtet …</p>';
  const t = cloud.lastSync;
  return `<p class="sync-line">${icon('checkCircle')}Verschlüsselt gesichert${t ? ` · zuletzt ${timeCH(t)}` : ''}</p>`;
}

export default {
  render() {
    const l = store.license;
    const a = cloud.account;
    const card = (title, ic, body) => `<section class="card"><div class="card-head">${icon(ic)}<h3>${title}</h3></div>${body}</section>`;
    const exp = store.licenseExpiresAt;
    const validity = l ? (store.licenseExpired ? 'abgelaufen' : exp ? `gültig bis ${exp.toLocaleDateString('de-CH', { day: 'numeric', month: 'long', year: 'numeric' })}` : 'unbefristet') : '';

    const konto = card('Konto', 'account', `
      <div class="kv"><span>Angemeldet als</span><b>${esc(cloud.email || '–')}</b></div>
      ${a?.espacio && cloud.canWrite ? `<div class="kv"><span>Cloud-Speicher</span><b>${mb(a.espacio.usado)} MB von ${mb(a.espacio.maximo)} MB</b></div>` : ''}
      ${a?.borrado_previsto ? `<p class="warn-text">Ihre Lizenz ist abgelaufen. Die Daten in der Cloud bleiben bis am ${dateCH(a.borrado_previsto)} erhalten – verlängern Sie die Lizenz, damit sie nicht gelöscht werden.</p>` : ''}
      ${syncStatus()}
      <div class="btns">
        ${cloud.isActive && cloud.canWrite ? `<button type="button" class="btn btn-ghost" data-act="sync" ${cloud.isSyncing ? 'disabled' : ''}>${icon('upload')}Jetzt abgleichen</button>` : ''}
        <button type="button" class="btn btn-ghost" data-act="logout">${icon('account')}Abmelden</button>
      </div>`);

    const geraete = a?.aparatos?.length ? card('Angemeldete Geräte', 'overview', `
      <ul class="devices">${a.aparatos.map((d) => `<li><span>${esc(d.aparato || 'Gerät')}${d.este ? ' <small>· dieses Gerät</small>' : ''}</span><small>seit ${dateCH(d.desde)}</small></li>`).join('')}</ul>
      ${a.aparatos.length > 1 ? `<div class="btns"><button type="button" class="btn btn-ghost danger" data-act="logoutAll">${icon('lock')}Auf allen Geräten abmelden</button></div>` : ''}`) : '';

    const lizenz = card('Lizenz', 'review', l
      ? `<div class="kv"><span>Lizenz</span><b>${esc(l.info.name || 'Vollversion')}</b></div>
         <div class="kv"><span>Gültigkeit</span><b>${validity}</b></div>
         <div class="kv"><span>Steuerjahre</span><b>${l.info.years.includes(0) ? 'alle Steuerjahre' : l.info.years.join(', ')}</b></div>
         ${store.expiryNotice ? `<p class="warn-text">${esc(store.expiryNotice)} <a href="${store.licenseMailURL()}">Verlängern</a></p>` : ''}`
      : `<p class="muted">Testversion: alles erfassen und die Steuern berechnen. Die Vollversion mit Übertragung in E-Tax, PDF-Bericht, allen Spartipps und verschlüsselter Cloud-Sicherung kostet CHF 99 pro Jahr und Haushalt.</p>
         <div class="btns"><button type="button" class="btn btn-brand" data-paywall="">${icon('spark')}Vollversion freischalten</button><a class="btn btn-ghost" href="${store.licenseMailURL()}">${icon('mail')}Lizenz anfragen</a></div>`);

    const backup = cloud.backup ? card('Frühere Angaben in diesem Browser', 'doc', `
      <p class="muted">Beim Anmelden wurden die Angaben aus Ihrem Konto übernommen. Was vorher in diesem Browser stand, ist hier noch als Kopie da.</p>
      <div class="btns"><button type="button" class="btn btn-ghost" ${store.isUnlocked() ? 'data-act="saveBackup"' : 'data-paywall="export"'}>${icon(store.isUnlocked() ? 'download' : 'lock')}Kopie als Datei speichern</button></div>`) : '';

    return header('Mein Konto', 'Ihr Konto gilt im Browser und in der Mac-App: dieselbe E-Mail, dieselben Angaben.', 'account')
      + konto + lizenz + geraete + backup;
  },
  actions: {
    sync() { cloud.sync(); return false; },
    async logout() {
      const local = !cloud.canWrite || cloud.st.dirty;
      const text = local
        ? 'Ihre Angaben sind nur in diesem Browser gespeichert und werden beim Abmelden gelöscht. Speichern Sie vorher unter «Bericht & Export» eine Datensicherung, wenn Sie sie behalten möchten.'
        : 'Ihre Angaben sind in Ihrem Konto gesichert. In diesem Browser werden sie gelöscht – nach dem Anmelden sind sie wieder da.';
      if (!(await confirmDialog('Abmelden?', text, 'Abmelden', local))) return false;
      await cloud.signOut();
      return false;
    },
    async logoutAll() {
      if (!(await confirmDialog('Auf allen Geräten abmelden?', 'Alle Browser und Macs mit diesem Konto müssen sich danach neu anmelden – zum Beispiel, wenn Sie ein Gerät verloren haben.', 'Überall abmelden'))) return false;
      await cloud.signOut({ everywhere: true });
      return false;
    },
    saveBackup() {
      const blob = new Blob([JSON.stringify({ format: 'steuerhilfe', v: 1, exported: new Date().toISOString(), ...cloud.backup }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'Steuerhilfe-fruehere-Angaben.json';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      toast('Kopie gespeichert');
      return false;
    },
  },
};
