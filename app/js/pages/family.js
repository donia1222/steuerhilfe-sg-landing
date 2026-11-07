// Steuerhilfe Web · Personen & Familie (wie FamilyView.swift).
import { store } from '../store.js';
import { icon } from '../icons.js';
import { chf } from '../../engine/money.js';
import * as M from '../../engine/model.js';
import { ageAtEndOf, suggestedEducation } from '../../engine/calculator.js';
import { zuschlag } from '../../engine/liechtenstein.js';
import { municipalityNamed } from '../../engine/rules.js';
import { fields, header, section, staticRow, empty, addBtn, delBtn, confirmDialog } from '../forms.js';

const CIVIL = [['ledig', 'ledig'], ['verheiratet', 'verheiratet'], ['eingetragenePartnerschaft', 'eingetragene Partnerschaft'], ['getrennt', 'getrennt'], ['geschieden', 'geschieden'], ['verwitwet', 'verwitwet']];
const CONF = [['keine', 'keine / konfessionslos'], ['roemischKatholisch', 'römisch-katholisch'], ['evangelischReformiert', 'evangelisch-reformiert'], ['christkatholisch', 'christkatholisch'], ['andere', 'andere (keine Kirchensteuer)']];
const EMPL = [['unselbstaendig', 'unselbständig'], ['selbstaendig', 'selbständig'], ['nichtErwerbstaetig', 'nicht erwerbstätig']];
const EDU = [['vorschule', 'noch nicht schulpflichtig'], ['schule', 'Kindergarten / Volksschule'], ['ausbildung', 'Lehre / Mittelschule / Studium'], ['keine', 'keine Ausbildung (kein Abzug)']];

function municipality(c, f) {
  if (store.isLI) {
    const list = store.liRules.gemeinden.map((g) => [g.name, g.name]);
    const z = zuschlag(store.liRules, c.municipality);
    return f.select('municipality', 'Wohngemeinde', list)
      + (z !== null ? staticRow(`Gemeindesteuerzuschlag ${store.year}`, `${chf(z)} % der Landessteuer${store.liRules.vorlaeufig ? ' (vorläufig)' : ''}`) : '');
  }
  const ml = store.rules.municipalities;
  const list = ml.municipalities.map((m) => m.name).sort((a, b) => a.localeCompare(b, 'de-CH')).map((n) => [n, n]);
  const m = municipalityNamed(ml, c.municipality);
  let html = f.select('municipality', 'Wohngemeinde', list);
  if (m) {
    if (m.parishes.length > 1) {
      if (!c.parish) c.parish = m.parishes[0].name;
      html += f.select('parish', 'Kirchgemeinde', m.parishes.map((p) => [p.name, p.name]));
    }
    html += staticRow(`Steuerfuss ${store.year}`, `Kanton ${chf(ml.kantonSteuerfuss)}% · Gemeinde ${chf(m.steuerfuss)}%`);
  }
  return html;
}

function person(c, key, title) {
  const p = c[key];
  const f = fields(c);
  return section(title,
    f.text(`${key}.firstName`, 'Vorname', { auto: 'given-name' })
    + f.text(`${key}.lastName`, 'Nachname', { auto: 'family-name' })
    + f.date(`${key}.birthDate`, 'Geburtsdatum')
    + (store.isLI ? '' : f.select(`${key}.confession`, 'Konfession', CONF))   // Liechtenstein kennt keine Kirchensteuer
    + f.text(`${key}.profession`, 'Beruf')
    + f.select(`${key}.employment`, 'Erwerbsart', EMPL)
    + (p.employment === 'unselbstaendig' ? f.text(`${key}.employer`, 'Arbeitgeber') : '')
    + (p.employment !== 'nichtErwerbstaetig' ? f.toggle(`${key}.hasPensionFund`, 'Pensionskasse (2. Säule) vorhanden',
      { help: 'Mit Pensionskasse sind höchstens Fr. 7’258 in die Säule 3a abziehbar. Ohne Pensionskasse 20% des Erwerbseinkommens, höchstens Fr. 36’288.' }) : ''));
}

function children(c) {
  const f = fields(c);
  const list = c.children.map((ch, i) => {
    const age = ageAtEndOf(ch.birthDate, c.year);
    return `<div class="item">
      <div class="item-head">${icon('child')}${f.cellText(`children.${i}.firstName`, 'Vorname')}${f.cellText(`children.${i}.lastName`, 'Nachname')}${delBtn('delChild', { i }, 'Kind entfernen')}</div>
      ${f.date(`children.${i}.birthDate`, `Geburtsdatum${age !== null ? ` <small class="muted">· ${age} Jahre am 31.12.</small>` : ''}`, { rerender: true })}
      ${f.select(`children.${i}.education`, 'Schule / Ausbildung', EDU)}
      ${ch.education === 'ausbildung' ? f.text(`children.${i}.school`, 'Schule oder Lehrfirma') + f.text(`children.${i}.educationUntil`, 'Ausbildung dauert bis') : ''}
      ${f.toggle(`children.${i}.livesInHousehold`, 'Lebt in meinem Haushalt', { help: 'Ausschalten, wenn das Kind beim anderen Elternteil wohnt und Sie Unterhaltsbeiträge zahlen: Dann ziehen Sie die Unterhaltsbeiträge ab (Weitere Abzüge), und der Kinderabzug geht an den anderen Elternteil. Ein Kind in Ausbildung, das auswärts wohnt und von Ihnen unterstützt wird, zählt weiterhin.' })}
    </div>`;
  }).join('');
  return section('Kinder',
    (c.children.length ? list : empty('child', 'Keine Kinder erfasst', 'Erfassen Sie Kinder, für deren Unterhalt Sie zur Hauptsache aufkommen.'))
    + addBtn('addChild', 'Kind hinzufügen'),
    { help: store.isLI
      ? 'Kinderabzug Liechtenstein: CHF 12’700 pro Kind. Dazu ein Pauschalbetrag für private Versicherungen je nach Alter des Kindes.'
      : 'Kinderabzug Kanton: Fr. 7’600 (noch nicht schulpflichtig) bzw. Fr. 10’800 (Kindergarten, Schule, Ausbildung). Bund: Fr. 6’800 pro Kind und Fr. 263 Abzug vom Steuerbetrag. Vermögen: Fr. 20’000 pro minderjähriges Kind.' });
}

export default {
  render(c) {
    const f = fields(c);
    const joint = M.isJoint(c);
    return header('Personen & Familie', `Angaben per 31. Dezember ${store.year}. Sie bestimmen Tarif${store.isLI ? ', Kinderabzüge und den Gemeindezuschlag.' : ', Kinderabzüge und Kirchensteuer.'}`, 'family')
      + section('Haushalt',
        f.select('civilStatus', 'Zivilstand', CIVIL)
        + municipality(c, f)
        + f.text('registerNumber', 'Register-Nr. (auf der Steuererklärung)')
        + f.text('iban', 'IBAN für Rückzahlungen', { placeholder: 'CH00 0000 0000 0000 0000 0' }))
      + person(c, 'person1', joint ? 'Person 1' : 'Steuerpflichtige Person')
      + (joint ? person(c, 'person2', 'Person 2') : '')
      + children(c);
  },
  onChange(c, path) {
    // Neues Geburtsdatum: Kategorie wie in der Mac-App vorschlagen
    const m = /^children\.(\d+)\.birthDate$/.exec(path || '');
    if (m) {
      const ch = c.children[Number(m[1])];
      if (ch?.birthDate) ch.education = suggestedEducation(ch.birthDate, c.year);
    }
    if (path === 'municipality' && !store.isLI) delete c.parish;
  },
  actions: {
    addChild(c) { c.children.push({ ...M.newChild(), lastName: c.person1.lastName }); },
    async delChild(c, d) {
      const ch = c.children[Number(d.i)];
      const ok = await confirmDialog('Kind entfernen?', `${ch.firstName || 'Dieses Kind'} und die erfassten Betreuungskosten werden aus dem Steuerjahr ${store.year} entfernt.`, 'Entfernen');
      if (!ok) return false;
      c.children.splice(Number(d.i), 1);
    },
  },
};
