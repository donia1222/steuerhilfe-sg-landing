// Steuerhilfe Web · Anmeldung und verschlüsselte Cloud – dasselbe Konto und derselbe Datenblock
// wie in der Mac-App (CloudAPI.swift, CloudCrypto.swift, CloudSync.swift):
// · Anmelden mit E-Mail und Code (codigo-pedir.php / codigo-comprobar.php).
// · Haushaltsschlüssel (256 bit) aus llave.php; beim allerersten Gerät wird er hier erzeugt.
// · Block «daten» = AES-GCM( LZFSE( JSON {modifiedAt, device, state, licenseKey?, licenseActivatedAt?} ) ),
//   gebunden an den Namen «block:daten», mit Formatbyte 1 davor. Byte für Byte wie auf dem Mac.
// · Gleichzeitige Änderungen: der neuere Stand gewinnt, der andere wird vorher gesichert.
import { store } from './store.js';
import { lzfseDecode, lzfseEncodeRaw } from './lzfse.js';

// Nur zum Testen auf dem Mac (127.0.0.1/localhost): localStorage «steuerhilfe-web-api» zeigt auf eine
// lokale Kopie des Servers. Online gilt immer der echte Server.
const LOCAL = ['127.0.0.1', 'localhost'].includes(location.hostname);
const API = (LOCAL && (() => { try { return localStorage.getItem('steuerhilfe-web-api'); } catch { return null; } })()) || 'https://web.lweb.ch/steuerhilfe/api/v1/';
const SESSION = 'steuerhilfe-web-sitzung';   // { token, email }
const STATE = 'steuerhilfe-web-cloud';       // Abgleich-Stand dieses Browsers
const BACKUP = 'steuerhilfe-web-vor-cloud';  // lokaler Stand, bevor die Cloud ihn ersetzt hat

const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privat */ } };
const remove = (k) => { try { localStorage.removeItem(k); } catch { /* */ } };

/** Datum wie Swift .iso8601: ohne Millisekunden, sonst kann der Mac es nicht lesen. */
export const isoSeconds = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');

// ---------------------------------------------------------------- Fehler
const MESSAGES = {
  email: 'Bitte prüfen Sie die E-Mail-Adresse.',
  zu_viele_versuche: 'Zu viele Versuche. Bitte warten Sie eine Viertelstunde und versuchen Sie es dann nochmals.',
  correo: 'Die E-Mail mit dem Code konnte nicht gesendet werden. Bitte versuchen Sie es in ein paar Minuten nochmals.',
  codigo: 'Dieser Code stimmt nicht.',
  codigo_caducado: 'Dieser Code ist abgelaufen. Bitte fordern Sie einen neuen an.',
  codigo_quemado: 'Zu viele falsche Eingaben. Bitte fordern Sie einen neuen Code an.',
  sin_sesion: 'Bitte melden Sie sich erneut an.',
  sesion_caducada: 'Ihre Anmeldung ist abgelaufen. Bitte melden Sie sich erneut an.',
  licencia: 'Für die Cloud-Sicherung braucht es eine gültige Lizenz.',
  licencia_en_otra_cuenta: 'Dieser Lizenzschlüssel gehört bereits zu einem anderen Konto.',
  licencia_caducada: 'Diese Lizenz ist abgelaufen.',
  sin_espacio: 'Ihr Cloud-Speicher ist voll.',
  red: 'Keine Verbindung zum Server. Bitte prüfen Sie Ihre Internetverbindung.',
};

export class CloudError extends Error {
  constructor(code, status, extra = {}) {
    super(MESSAGES[code] || 'Der Server hat einen Fehler gemeldet. Bitte versuchen Sie es später nochmals.');
    this.code = code; this.status = status; Object.assign(this, extra);
  }
  get isAuth() { return this.status === 401; }
}

async function call(path, { method = 'GET', json, token } = {}) {
  const headers = {};
  if (json) headers['Content-Type'] = 'application/json';
  if (token) headers['X-Sitzung'] = token;
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: json ? JSON.stringify(json) : undefined, cache: 'no-store' });
  } catch { throw new CloudError('red', 0); }
  let data = null;
  try { data = await res.json(); } catch { /* */ }
  if (!res.ok || !data?.ok) {
    if (res.status === 404 && data?.error === 'no_existe') return null;
    throw new CloudError(data?.error || 'servidor', res.status, data || {});
  }
  return data;
}

// ---------------------------------------------------------------- Verschlüsselung (CloudCrypto.swift)
const FORMAT = 1;
const utf8 = (s) => new TextEncoder().encode(s);
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function importKey(raw) { return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); }

export async function seal(plain, key, name) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(name), tagLength: 128 }, key, plain));
  const out = new Uint8Array(1 + 12 + ct.length);
  out[0] = FORMAT; out.set(iv, 1); out.set(ct, 13);
  return out;
}

export async function open(data, key, name) {
  if (data[0] !== FORMAT || data.length < 1 + 12 + 16) throw new Error('Daten aus der Cloud konnten nicht entschlüsselt werden.');
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(1, 13), additionalData: utf8(name), tagLength: 128 }, key, data.subarray(13)));
  } catch { throw new Error('Daten aus der Cloud konnten nicht entschlüsselt werden.'); }
}

async function fingerprint(raw) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
  return Array.from(h.subarray(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- Gerät
function deviceName() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return `${browser}${os ? ` auf ${os}` : ''} (Web)`;
}

// ---------------------------------------------------------------- Abgleich (CloudSync.swift)
class Cloud extends EventTarget {
  constructor() {
    super();
    const s = readJSON(SESSION, null);
    this.token = s?.token || null;
    this.email = s?.email || null;
    this.account = null;
    this.key = null;            // CryptoKey, nur im Speicher
    this.needsKey = false;      // angemeldet, aber noch kein Haushaltsschlüssel (z.B. ohne Lizenz)
    this.isSyncing = false;
    this.lastError = null;
    this._timer = null;
    this._again = false;
    this.st = readJSON(STATE, {});
  }

  get isSignedIn() { return !!this.token; }
  get isActive() { return !!this.token && !!this.key && !this.needsKey; }
  get canWrite() { return this.account?.licencia?.valida === true; }
  get lastSync() { return this.st.lastSync ? new Date(this.st.lastSync) : null; }
  emit() { this.dispatchEvent(new Event('change')); }

  _save() { writeJSON(STATE, this.st); }
  get _lastVersion() { return this.st.version ?? 0; }
  set _lastVersion(v) { this.st.version = v; this._save(); }
  get _dirty() { return !!this.st.dirty; }
  set _dirty(v) { this.st.dirty = v; this._save(); }
  get _localModified() { return this.st.modified ? new Date(this.st.modified) : new Date(0); }
  set _localModified(d) { this.st.modified = isoSeconds(d); this._save(); }

  // ---------------------------------------------------------------- Anmelden
  async requestCode(email) {
    await call('codigo-pedir.php', { method: 'POST', json: { email: email.trim().toLowerCase() } });
  }

  async verify(email, code) {
    const mail = email.trim().toLowerCase();
    const r = await call('codigo-comprobar.php', { method: 'POST', json: { email: mail, codigo: code.replace(/\D/g, ''), aparato: deviceName() } });
    if (this.st.email && this.st.email !== mail) {
      // Ein anderes Konto als zuletzt in diesem Browser: dessen Angaben gehören nicht zu diesem Konto.
      await store.wipeLocal();
      remove(BACKUP);
      this.st = {};
    }
    this.token = r.token; this.email = mail;
    writeJSON(SESSION, { token: r.token, email: mail });
    this.st.email = mail; this._save();
    // Angemeldet ist man ab hier. Was jetzt noch schiefgeht (Netz, Lizenz), steht im Konto und
    // wird beim nächsten Abgleich nachgeholt – der Code ist ja schon verbraucht.
    try {
      if (!r.cuenta.licencia.tiene) await this._linkLicense();
      await this._refreshAccount();
      await this._ensureKey();
    } catch (e) { this.lastError = e.message; }
    this.emit();
    this.scheduleSync(0);
  }

  async signOut({ everywhere = false } = {}) {
    // Erst einen laufenden Abgleich fertig werden lassen: sonst schreibt er die Daten nach dem Löschen zurück.
    this._closing = true;
    clearTimeout(this._timer);
    for (let i = 0; this.isSyncing && i < 300; i++) await new Promise((r) => setTimeout(r, 100));
    if (this.token) { try { await call('salir.php', { method: 'POST', json: everywhere ? { todos: true } : {}, token: this.token }); } catch { /* offline: lokal trotzdem abmelden */ } }
    clearTimeout(this._timer);
    this.token = null; this.email = null; this.account = null; this.key = null; this.needsKey = false; this.lastError = null;
    remove(SESSION); remove(STATE); remove(BACKUP);
    this.st = {};
    await store.wipeLocal();
    this._closing = false;
    this.emit();
    this.dispatchEvent(new Event('signedout'));
  }

  /** Konto mit allen Cloud-Daten und Belegen endgültig löschen (cuenta-borrar.php), danach wie Abmelden. */
  async deleteAccount() {
    this._closing = true;
    clearTimeout(this._timer);
    for (let i = 0; this.isSyncing && i < 300; i++) await new Promise((r) => setTimeout(r, 100));
    try {
      await call('cuenta-borrar.php', { method: 'POST', json: { confirmar: this.email }, token: this.token });
    } catch (e) { this._closing = false; throw e; }
    this.token = null; this.email = null; this.account = null; this.key = null; this.needsKey = false; this.lastError = null;
    remove(SESSION); remove(STATE); remove(BACKUP);
    this.st = {};
    store.serverLicense = null;
    await store.wipeLocal();
    this._closing = false;
    this.emit();
    this.dispatchEvent(new Event('signedout'));
  }

  /** Beim Start: Sitzung prüfen, Schlüssel holen, abgleichen. Offline geht es lokal weiter. */
  async resume() {
    if (!this.token) return;
    try {
      await this._refreshAccount();
      await this._ensureKey();
      this.emit();
      await this.sync();
    } catch (e) {
      if (e.isAuth) this._lost(e); else { this.lastError = e.message; this.emit(); }
    }
  }

  _lost(e) {
    this.token = null; this.key = null;
    remove(SESSION);
    this.lastError = e.message;
    this.emit();
    this.dispatchEvent(new Event('signedout'));
  }

  async _refreshAccount() {
    this.account = await call('cuenta.php', { token: this.token });
    store.serverLicense = this.account?.licencia || null;   // der Server kennt das echte Aktivierungsdatum
  }

  async _linkLicense() {
    const lic = store.license;
    if (!this.token || !lic?.key) return;
    try {
      await call('licencia.php', { method: 'POST', json: { licencia: lic.key, ...(lic.activatedAt ? { activada: isoSeconds(lic.activatedAt) } : {}) }, token: this.token });
    } catch (e) {
      if (e.code !== 'licencia_caducada' && e.code !== 'licencia_en_otra_cuenta') throw e;
      if (e.code === 'licencia_en_otra_cuenta') this.lastError = e.message;
    }
  }

  /** Nach einer Lizenz-Eingabe im Browser: ans Konto hängen und die Cloud einrichten. */
  async licenseActivated() {
    if (!this.token) return;
    try {
      await this._linkLicense();
      await this._refreshAccount();
      if (this.needsKey || !this.key) await this._ensureKey();
      this.st.licenseShared = false; this._save();
      this.emit();
      this.scheduleSync(0.5);
    } catch (e) { this.lastError = e.message; this.emit(); }
  }

  // ---------------------------------------------------------------- Haushaltsschlüssel
  async _ensureKey() {
    const r = await call('llave.php', { token: this.token });
    if (r.llave) {
      const raw = unb64(r.llave);
      const fp = await fingerprint(raw);
      if (this.st.keyId !== fp) {
        // Dieser Browser kommt neu dazu: die Cloud gewinnt, der bisherige Stand bleibt als Kopie.
        if (store.hasData()) writeJSON(BACKUP, store.snapshot());
        this.st.keyId = fp;
        this.st.version = -1;
        this.st.dirty = false;
        this._save();
      }
      this.key = await importKey(raw);
      this.needsKey = false;
      return;
    }
    // Ein alter, nicht lesbarer Schlüssel (Testphase): das klärt die Mac-App, die ihn vielleicht noch hat.
    // Der Browser löscht nichts.
    if (r.ilegible) { this.needsKey = true; this.key = null; this.lastError = 'Bitte melden Sie sich zuerst in der Mac-App an, damit Ihre Cloud-Daten eingerichtet werden.'; return; }
    // Noch kein Schlüssel im Konto: erstes Gerät. Speichern braucht eine gültige Lizenz.
    if (!this.canWrite) { this.needsKey = true; this.key = null; return; }
    const raw = crypto.getRandomValues(new Uint8Array(32));
    await call('llave.php', { method: 'POST', json: { llave: b64(raw), reemplazar: false, borrar_datos: false }, token: this.token });
    this.key = await importKey(raw);
    this.st.keyId = await fingerprint(raw);
    this.st.version = 0;
    this.st.dirty = true;
    this.st.modified = isoSeconds(new Date());
    this._save();
    this.needsKey = false;
  }

  // ---------------------------------------------------------------- lokale Änderungen
  localChanged() {
    // Auch ohne Schlüssel (offline gestartet, Server kurz weg): merken, dass hier etwas geändert wurde.
    // Sonst überschreibt der nächste Abgleich diese Änderungen ohne Sicherung.
    if (!this.token) return;
    this.st.dirty = true;
    this.st.modified = isoSeconds(new Date());
    this._save();
    this.scheduleSync(4);
  }

  scheduleSync(seconds) {
    if (this._closing) return;
    if (this.isSyncing) { this._again = true; return; }
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.sync(), seconds * 1000);
  }

  async sync() {
    if (this._closing) return;
    if (this.token && !this.key && !this.isSyncing) {
      try { await this._refreshAccount(); await this._ensureKey(); } catch (e) { if (e.isAuth) { this._lost(e); return; } this.lastError = e.message; }
      this.emit();
    }
    if (!this.isActive || this.isSyncing) return;
    this.isSyncing = true; this.lastError = null; this.emit();
    try {
      await this._refreshAccount();
      if (!this.account.licencia.tiene && store.license) { await this._linkLicense(); await this._refreshAccount(); }
      if (store.license && !this.st.licenseShared) { this.st.dirty = true; this._save(); }
      await this._syncData();
      this.st.lastSync = new Date().toISOString(); this._save();
    } catch (e) {
      if (e.isAuth) this._lost(e); else this.lastError = e.message;
    } finally {
      this.isSyncing = false;
      this.emit();
      if (this._again) { this._again = false; this.scheduleSync(1); }
    }
  }

  async _syncData() {
    for (let attempt = 0; attempt < 3; attempt++) {
      let base = this._lastVersion;
      const remote = await call('bloque.php?clave=daten', { token: this.token });
      if (remote) {
        if (remote.version !== this._lastVersion) {
          const plain = lzfseDecode(await open(unb64(remote.contenido), this.key, 'block:daten'));
          const payload = JSON.parse(new TextDecoder().decode(plain));
          if (!this._dirty || new Date(payload.modifiedAt) >= this._localModified) {
            if (this._dirty) writeJSON(BACKUP, store.snapshot());
            this.st.documents = payload.state.documents || [];
            await store.applyRemote(payload.state);
            await this._adoptLicense(payload);
            this.st.version = remote.version; this.st.dirty = false; this._save();
            return;
          }
          base = remote.version;   // dieser Browser ist neuer: überschreiben
          this.st.documents = payload.state.documents || [];   // aber die Belegliste des Macs behalten
        }
      } else if (this._lastVersion !== 0) {
        base = 0; this._dirty = true;   // Cloud leer (z.B. gelöscht): neu hochladen
      } else if (!this._dirty) {
        return;
      }
      if (!this._dirty || !this.canWrite) return;

      const started = this.st.modified || isoSeconds(new Date());
      const lic = store.license;
      const payload = {
        modifiedAt: started,
        device: deviceName(),
        state: { ...store.snapshot(), documents: this.st.documents || [], version: 1 },
        ...(lic?.key ? { licenseKey: lic.key } : {}),
        ...(lic?.activatedAt ? { licenseActivatedAt: isoSeconds(lic.activatedAt) } : {}),
      };
      const packed = lzfseEncodeRaw(utf8(JSON.stringify(payload)));
      const sealed = await seal(packed, this.key, 'block:daten');
      try {
        const r = await call('bloque-guardar.php', { method: 'POST', json: { clave: 'daten', version_base: Math.max(base, 0), contenido: b64(sealed) }, token: this.token });
        this.st.version = r.version;
        if (this.st.modified === started) this.st.dirty = false;
        if (payload.licenseKey) this.st.licenseShared = true;
        this._save();
        return;
      } catch (e) {
        if (e.code === 'conflicto') continue;   // ein anderes Gerät war schneller: neu laden und vergleichen
        throw e;
      }
    }
  }

  /** Lizenz aus der Cloud übernehmen, wenn dieser Browser keine (gültige) hat – mit dem ursprünglichen Datum. */
  async _adoptLicense(p) {
    if (!p.licenseKey || (store.license && !store.licenseExpired)) return;
    try { await store.adoptLicense(p.licenseKey, p.licenseActivatedAt); } catch { /* ungültig: ignorieren */ }
  }

  /** Lokale Kopie, die vor dem Übernehmen aus der Cloud gemacht wurde (falls vorhanden). */
  get backup() { return readJSON(BACKUP, null); }
}

export const cloud = new Cloud();

// Änderungen im Browser → Cloud; zurück im Fenster → abgleichen; alle 10 Minuten sowieso.
store.onLocalSave = () => cloud.localChanged();
store.addEventListener('license', () => cloud.licenseActivated());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && cloud.isSignedIn && Date.now() - (cloud.lastSync?.getTime() || 0) > 120000) cloud.scheduleSync(0.5);
});
setInterval(() => { if (cloud.isSignedIn) cloud.scheduleSync(0); }, 600000);
