// Steuerhilfe · Lizenzschlüssel prüfen (Port von License.swift).
// Die Schlüssel sind von Lweb mit Ed25519 signiert; geprüft wird komplett offline
// mit dem öffentlichen Schlüssel, der auch in der Mac-App steckt. Dieselben Schlüssel
// gelten deshalb in der Mac-App und im Browser.

export const PUBLIC_KEY = 'jzrz_UGq0yb_hl5HfEN89YxjgI38H_Cc0Ssxmz_7BRI';
export const PREFIXES = ['SGSTEUER-', 'ORDNIG-'];   // «ORDNIG-» = ältere Schlüssel, bleiben gültig

const subtle = globalThis.crypto?.subtle;

function b64url(s) {
  let t = s.replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let keyPromise = null;
const publicKey = () => (keyPromise ??= subtle.importKey('raw', b64url(PUBLIC_KEY), { name: 'Ed25519' }, false, ['verify']));

/** Schlüssel bereinigen wie die Mac-App (Leerzeichen und Zeilenumbrüche weg). */
export const normalizeKey = (raw) => String(raw || '').trim().replace(/[\s\n]/g, '');
export const prefixOf = (key) => PREFIXES.find((p) => key.startsWith(p)) || null;

/**
 * Prüft einen Schlüssel. Ergebnis: { id, name, email, years, issued, durationDays } oder null.
 * years: freigeschaltete Steuerjahre, [0] = alle. durationDays: Laufzeit ab Aktivierung (oder undefined = unbefristet).
 */
export async function verifyLicense(raw) {
  const key = normalizeKey(raw);
  const p = prefixOf(key);
  if (!p) return null;
  const parts = key.slice(p.length).split('.');
  if (parts.length !== 2) return null;
  let payload, sig;
  try { payload = b64url(parts[0]); sig = b64url(parts[1]); } catch { return null; }
  let ok = false;
  try { ok = await subtle.verify({ name: 'Ed25519' }, await publicKey(), sig, payload); } catch { return null; }
  if (!ok) return null;
  let obj;
  try { obj = JSON.parse(new TextDecoder().decode(payload)); } catch { return null; }
  return {
    id: obj.id ?? '', name: obj.n ?? '', email: obj.e ?? '', years: Array.isArray(obj.y) ? obj.y : [],
    issued: obj.d ?? '', durationDays: Number.isInteger(obj.dur) ? obj.dur : undefined,
  };
}

export const covers = (info, year) => info.years.includes(0) || info.years.includes(year);

/** Ablaufdatum: Aktivierung + Laufzeit (in Tagen). */
export function expiresAt(info, activatedAtISO) {
  if (info.durationDays === undefined || !activatedAtISO) return null;
  const d = new Date(activatedAtISO);
  d.setDate(d.getDate() + info.durationDays);
  return d;
}
