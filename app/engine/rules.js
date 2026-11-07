// Steuerhilfe · Regelwerk eines Steuerjahres (Port von TaxCore/Rules/Rules.swift).
// Dieselben JSON-Dateien wie die Mac-App (app/rules/). Im Browser per fetch,
// in den Tests (Node) über einen eigenen Lader.

export const SUPPORTED_YEARS = [2025, 2026];

let loader = async (name) => {
  const res = await fetch(new URL(`../rules/${name}.json`, import.meta.url));
  if (!res.ok) throw new Error(`Regeldatei fehlt: ${name}.json`);
  return res.json();
};

/** Für Node-Tests: eigenen Lader setzen (z.B. fs.readFile). */
export function setRuleLoader(fn) {
  loader = fn;
  cache.clear();
}

const cache = new Map();

/** Regelwerk St.Gallen + Bund für ein Jahr. */
export async function loadRuleBook(year, canton = 'SG') {
  const key = `${canton}-${year}`;
  if (cache.has(key)) return cache.get(key);
  const c = canton.toLowerCase();
  const [params, dbst, tarif, steuerfuesse] = await Promise.all([
    loader(`${c}-params-${year}`), loader(`dbst-${year}`), loader(`${c}-tarif-${year}`), loader(`${c}-steuerfuesse-${year}`),
  ]);
  const book = {
    year, canton,
    cantonal: params,          // DeductionParams (Kanton)
    cantonalExtra: params,     // CantonExtraParams: liegt in derselben Datei
    federal: dbst,             // DeductionParams (Bund)
    federalRules: dbst,        // tarif + kapitalleistungAnteil
    sgTariff: tarif,
    municipalities: steuerfuesse,
  };
  cache.set(key, book);
  return book;
}

/** Regeln Liechtenstein für ein Jahr. */
export async function loadLIRules(year) {
  const key = `LI-${year}`;
  if (cache.has(key)) return cache.get(key);
  const r = await loader(`li-${year}`);
  cache.set(key, r);
  return r;
}

export function municipalityNamed(list, name) {
  const n = String(name || '').toLocaleLowerCase('de-CH');
  return list.municipalities.find((m) => m.name.toLocaleLowerCase('de-CH') === n) || null;
}
