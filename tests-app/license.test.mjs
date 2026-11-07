// Prueba: los códigos de licencia generados para la Mac valen igual en la web.
// Lee la lista de ~/steuer-mac/lizenzen (fuera del repositorio: los códigos no se suben nunca).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { verifyLicense, covers } from '../app/engine/license.js';

const LISTE = `${homedir()}/steuer-mac/lizenzen/Lizenzen-Steuerhilfe-SG.txt`;

test('Los 500 códigos del Vorrat se aceptan en la web', async (t) => {
  let text;
  try { text = await readFile(LISTE, 'utf8'); } catch { t.skip('lista de códigos no disponible en este equipo'); return; }
  const keys = [...text.matchAll(/(?:SGSTEUER-|ORDNIG-)[A-Za-z0-9_\-.]+/g)].map((m) => m[0]);
  assert.equal(new Set(keys).size, keys.length, 'códigos repetidos');
  let ok = 0;
  const dur = new Map(), years = new Map(), ids = new Set();
  for (const k of keys) {
    const info = await verifyLicense(k);
    if (!info) continue;
    ok++;
    ids.add(info.id);
    dur.set(String(info.durationDays), (dur.get(String(info.durationDays)) || 0) + 1);
    years.set(JSON.stringify(info.years), (years.get(JSON.stringify(info.years)) || 0) + 1);
    assert.ok(covers(info, 2025) && covers(info, 2026));
  }
  console.log(`Códigos: ${keys.length} · válidos: ${ok} · IDs distintos: ${ids.size} · duración(días): ${JSON.stringify(Object.fromEntries(dur))} · años: ${JSON.stringify(Object.fromEntries(years))}`);
  assert.equal(ok, keys.length);
  assert.equal(ids.size, keys.length);
});

test('Un código alterado o inventado no vale', async () => {
  assert.equal(await verifyLicense('SGSTEUER-abc.def'), null);
  assert.equal(await verifyLicense('hola'), null);
  let text;
  try { text = await readFile(LISTE, 'utf8'); } catch { return; }
  const k = text.match(/SGSTEUER-[A-Za-z0-9_\-.]+/)[0];
  const i = k.indexOf('.') - 3;
  const changed = k.slice(0, i) + (k[i] === 'A' ? 'B' : 'A') + k.slice(i + 1);
  assert.equal(await verifyLicense(changed), null);
  assert.ok(await verifyLicense(` ${k.slice(0, 40)}\n${k.slice(40)} `), 'con espacios y salto de línea también vale');
});
