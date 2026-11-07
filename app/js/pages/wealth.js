// Steuerhilfe Web · Vermögen & Schulden (wie WealthView.swift, mit LIWealthHeader).
import { store } from '../store.js';
import { icon } from '../icons.js';
import { chf, sum, nonNeg, round } from '../../engine/money.js';
import * as M from '../../engine/model.js';
import { resultValue } from '../../engine/calculator.js';
import { vehicleValue } from '../../engine/liechtenstein.js';
import { fields, header, section, live, resultRow, staticRow, empty, addBtn, delBtn, confirmDialog, editDialog, note, esc } from '../forms.js';

const KIND = { konto: 'Konto (Bank/Post)', wertschrift: 'Wertschrift / Fonds', steuerauszug: 'Steuerauszug Bank (Total)', darlehen: 'Darlehen / Forderung', krypto: 'Kryptowährung', anderes: 'Andere Kapitalanlage' };

function securities(c) {
  const li = store.isLI;
  const list = c.securities;
  const rows = list.map((s, i) => `<div class="list-row">
      <span class="lr-ic">${icon('bank')}</span>
      <span class="lr-main"><b>${esc(s.description || s.institution || KIND[s.kind])}</b><small>${esc([KIND[s.kind], s.institution, s.code].filter(Boolean).join(' · '))}</small></span>
      <span class="lr-val"><b>${chf(s.taxValue)}</b><small>Steuerwert</small></span>
      ${li ? '' : `<span class="lr-val hide-sm"><b>${chf(s.incomeWithWithholding)}</b><small>mit VSt</small></span><span class="lr-val hide-sm"><b>${chf(s.incomeWithoutWithholding)}</b><small>ohne VSt</small></span>`}
      <button type="button" class="icon-btn" data-act="editSec" data-i="${i}" title="Bearbeiten" aria-label="Bearbeiten">${icon('edit')}</button>
      ${delBtn('delSec', { i }, 'Löschen')}</div>`).join('');
  const total = list.length ? `<div class="list-row total"><span class="lr-ic"></span><span class="lr-main"><b>Total</b></span>
      <span class="lr-val"><b>${chf(sum(list, (s) => s.taxValue))}</b></span>
      ${li ? '' : `<span class="lr-val hide-sm"><b>${chf(sum(list, (s) => s.incomeWithWithholding))}</b></span><span class="lr-val hide-sm"><b>${chf(sum(list, (s) => s.incomeWithoutWithholding))}</b></span>`}
      <span class="spacer2"></span></div>` : '';
  return section(li ? 'Konten und Wertschriften' : 'Konten und Wertschriften (Formular 2)',
    (list.length ? rows + total : empty('bank', 'Keine Konten erfasst', `Erfassen Sie alle Bank- und Postkonten (auch Lohnkonto, Sparkonto, Mietkaution) mit dem Saldo am ${li ? '1.1.' : '31.12.'}${li ? '' : ' und dem Zins'}.`))
    + `<div class="add-row">${addBtn('addSec', 'Konto', { kind: 'konto' })}${addBtn('addSec', 'Wertschrift', { kind: 'wertschrift' })}${addBtn('addSec', 'Steuerauszug-Total', { kind: 'steuerauszug' })}</div>`,
    { help: li ? undefined : 'Spalte «mit VSt»: Erträge, von denen 35% Verrechnungssteuer abgezogen wurde (Zinsen über Fr. 200, Schweizer Aktien und Fonds). Sie erhalten diese 35% über die Steuererklärung zurück. Spalte «ohne VSt»: kleine Zinsen bis Fr. 200, ausländische Wertschriften.' });
}

function securityEditor(c, i, kind) {
  const isNew = i === undefined;
  const draft = isNew ? { ...M.newSecurity(), kind } : structuredClone(c.securities[i]);
  if (isNew && kind !== 'konto') draft.isSavingsAccount = false;
  if (isNew && kind === 'steuerauszug') draft.managedByThirdParty = true;
  editDialog({
    title: isNew ? 'Neuer Eintrag' : 'Eintrag bearbeiten', subtitle: 'Wertschriften- und Guthabenverzeichnis', ic: 'bank', draft,
    render: (d) => {
      const f = fields(d);
      return section('', f.select('kind', 'Art', Object.entries(KIND))
          + f.text('institution', 'Bank / Institut')
          + f.text('description', d.kind === 'konto' ? 'Bezeichnung (z.B. Sparkonto)' : 'Titel (z.B. Namenaktien Nestlé)')
          + f.text('ibanOrValor', d.kind === 'konto' ? 'IBAN' : 'Valoren-Nr.')
          + f.select('owner', 'Gehört', [['gemeinsam', 'gemeinsam'], ['person1', 'Person 1'], ['person2', 'Person 2'], ['kinder', 'Kinder']]))
        + section(store.isLI ? 'Werte per 1.1.' : 'Werte per 31.12.',
          f.chf('taxValue', 'Steuerwert / Saldo')
          + f.chf('incomeWithWithholding', 'Bruttoertrag mit Verrechnungssteuer (A)', { help: 'Bruttobetrag vor Abzug der 35% Verrechnungssteuer.' })
          + f.chf('incomeWithoutWithholding', 'Bruttoertrag ohne Verrechnungssteuer (B)')
          + (d.kind === 'konto' ? f.toggle('isSavingsAccount', 'Zins zählt als Sparzins (Formular 6)', { rerender: false }) : '')
          + f.toggle('managedByThirdParty', 'Durch die Bank verwaltet (Depot) – für Pauschale 2‰', { rerender: false })
          + f.select('code', 'Code', [['', '–'], ['BP', 'BP – Beteiligung ab 10% (privat)'], ['E', 'E – neu aus Erbschaft'], ['S', 'S – neu aus Schenkung'], ['N', 'N – Nutzniessung'], ['G', 'G – Geschäftsvermögen']]));
    },
    onSave: (d) => store.update((cc) => { if (isNew) cc.securities.push(d); else cc.securities[i] = d; }),
  });
}

function others(c) {
  const f = fields(c);
  const li = store.isLI;
  const ins = c.insurances.map((p, i) => `<div class="trow">${f.cellText(`insurances.${i}.company`, 'Versicherungsgesellschaft')}<span class="tcell"><small>Rückkaufswert</small>${f.cellChf(`insurances.${i}.surrenderValue`)}</span>${delBtn('delIns', { i })}</div>`).join('');
  const veh = c.vehicles.map((v, i) => {
    const years = Math.max(0, store.year - (v.purchaseYear ?? store.year));
    const val = li ? vehicleValue(store.liRules, v, store.year) : round(nonNeg(v.purchasePrice * (1 - 0.2 * years)), 0);
    return `<div class="trow wrap">${icon('car')}${f.cellText(`vehicles.${i}.description`, 'z.B. VW Golf')}
      <span class="tcell"><small>Kaufpreis</small>${f.cellChf(`vehicles.${i}.purchasePrice`, 'Kaufpreis')}</span>
      <span class="tcell"><small>Kaufjahr</small>${f.cellInt(`vehicles.${i}.purchaseYear`, 'Kaufjahr', { kind: 'optint', cls: 'xs', rerender: true })}</span>
      <span class="tcell"><small>Steuerwert</small><span class="sval">${chf(val)}</span></span>${delBtn('delVeh', { i })}</div>`;
  }).join('');
  return section('Weitere Vermögenswerte',
    f.chf('cash', 'Bargeld, Gold und Edelmetalle', { ziffer: li ? '3.1' : '30.2' })
    + `<h4 class="sub">Lebensversicherungen mit Rückkaufswert <span class="ziffer">${li ? '3.6' : '30.3'}</span></h4>${ins}${addBtn('addIns', 'Lebensversicherung mit Rückkaufswert')}`
    + `<h4 class="sub">Fahrzeuge <span class="ziffer">${li ? '3.82' : '30.4'}</span></h4>${veh}${addBtn('addVeh', 'Auto / Motorrad')}`
    + f.chf('undividedEstatesWealth', 'Anteile an unverteilten Erbschaften', { ziffer: li ? '3.7' : '30.5' })
    + f.chf('otherAssets', 'Übrige Vermögenswerte (Boote, Sammlungen …)', { ziffer: li ? '3.9' : '30.6', help: li ? 'Kunst, Schmuck, Sammlungen, Reitpferde usw. Den Hausrat oben separat angeben.' : 'Hausrat und persönliche Gebrauchsgegenstände sind steuerfrei und werden nicht angegeben.' }));
}

function realEstate(c) {
  const f = fields(c);
  const list = c.realEstate.map((re, i) => `<div class="item">
      <div class="item-head">${icon('house')}${f.cellText(`realEstate.${i}.description`, 'Bezeichnung (z.B. Einfamilienhaus)')}${delBtn('delRE', { i }, 'Liegenschaft entfernen')}</div>
      <div class="trow">${f.cellText(`realEstate.${i}.municipality`, 'Gemeinde')}${f.cellText(`realEstate.${i}.parcelNumber`, 'Grundstück-Nr.')}${store.isLI ? f.cellText(`realEstate.${i}.canton`, 'Land/Kanton (FL = Liechtenstein)') : ''}</div>
      ${f.seg(`realEstate.${i}.use`, [['selbstbewohnt', 'selbst bewohnt'], ['vermietet', 'vermietet'], ['gemischt', 'gemischt']], { label: 'Nutzung' })}
      ${f.chf(`realEstate.${i}.taxValue`, 'Steuerwert (amtliche Schätzung)', { ziffer: store.isLI ? '1.1' : '31' })}
      ${re.use !== 'vermietet' ? f.chf(`realEstate.${i}.imputedRentalValue`, 'Eigenmietwert gemäss Schätzung', { help: 'Brutto-Eigenmietwert aus der Schätzung. Für das selbst bewohnte Eigenheim am Wohnort wird er automatisch um 30% reduziert.' })
        + f.toggle(`realEstate.${i}.isPrimaryResidence`, 'Dauernd selbst bewohntes Eigenheim am Wohnort (−30%)', { rerender: false }) : ''}
      ${re.use !== 'selbstbewohnt' ? f.chf(`realEstate.${i}.rentalIncome`, 'Mietzinseinnahmen (ohne Nebenkosten)') : ''}
      ${f.int(`realEstate.${i}.buildingYear`, 'Baujahr', { help: 'Für die Pauschale: Gebäude, die zu Beginn des Steuerjahres höchstens 10 Jahre alt sind, 10% – ältere 20%. Ohne Angabe rechnet Steuerhilfe mit 20%.', rerender: true })}
      ${f.seg(`realEstate.${i}.useFlatRateMaintenance`, [[true, `Pauschal ${Number(re.buildingYear) > 1000 && c.year - Number(re.buildingYear) <= 10 ? '10' : '20'}%`], [false, 'Tatsächliche Kosten']], { cast: 'bool', label: 'Unterhaltskosten' })}
      ${!re.useFlatRateMaintenance ? f.chf(`realEstate.${i}.actualMaintenanceCosts`, 'Tatsächliche Unterhalts- und Verwaltungskosten', { help: 'Reparaturen, Renovationen (werterhaltend), Gebäudeversicherung, Grundsteuer, Liegenschaftsunterhalt, Energiespar-Investitionen. Nicht: Strom, Wasser, Heizkosten bei Eigengebrauch.' }) : ''}
    </div>`).join('');
  return section(store.isLI ? 'Liegenschaften' : 'Liegenschaften (Formular 7)', list + addBtn('addRE', 'Liegenschaft hinzufügen') + (c.realEstate.length && !store.isLI ? live('re') : ''));
}

function debts(c) {
  const f = fields(c);
  const rows = c.debts.map((d, i) => `<div class="trow wrap">${f.cellText(`debts.${i}.creditor`, 'z.B. Hypothek Raiffeisenbank')}
      <span class="tcell"><small>Schuld ${store.isLI ? '1.1.' : '31.12.'}</small>${f.cellChf(`debts.${i}.amount`, 'Schuld')}</span>
      <span class="tcell"><small>Zinsen</small>${f.cellChf(`debts.${i}.interest`, 'Zinsen')}</span>
      <span class="tcell"><small>Geschäft</small>${f.cellCheck(`debts.${i}.isBusiness`, 'Geschäftsschuld')}</span>${delBtn('delDebt', { i })}</div>`).join('');
  return section(store.isLI ? 'Schulden' : 'Schulden und Schuldzinsen (Formular 5)', rows + addBtn('addDebt', 'Schuld hinzufügen'));
}

function capital(c) {
  const f = fields(c);
  const rows = c.capitalPayments.map((p, i) => `<div class="trow">${f.cellSelect(`capitalPayments.${i}.kind`, [['saeule3a', 'Säule 3a'], ['saeule2', 'Pensionskasse'], ['uebrige', 'Übrige']], { aria: 'Art' })}${f.cellChf(`capitalPayments.${i}.amount`)}${delBtn('delCap', { i })}</div>`).join('');
  return section('Kapitalbezüge aus Vorsorge (Ziffer 40)', rows + addBtn('addCap', 'Kapitalbezug hinzufügen') + live('cap'),
    { help: 'Bezüge aus Säule 3a oder Pensionskasse (z.B. Pensionierung, Wohneigentum) werden getrennt vom übrigen Einkommen zu einem reduzierten Satz besteuert.' });
}

function liHeader(c) {
  const f = fields(c);
  if (!c.li) c.li = M.liExtras(c);
  return section('Liechtenstein',
    note(`In Liechtenstein gilt das Vermögen am 1. Januar ${store.year}. 4 % davon (Sollertrag) zählen als Erwerb – eine separate Vermögenssteuer gibt es nicht.`)
    + f.chf('li.householdGoods', 'Hausrat und persönliche Gegenstände', { ziffer: '3.81', help: 'Verkehrswert, in der Regel ⅓ des Versicherungswerts. Bei einfachen Verhältnissen CHF 5’000 bis 10’000. Zusammen mit den Fahrzeugen frei bis CHF 26’400 (Ehepaare 52’800).' })
    + live('soll'));
}

export default {
  render(c) {
    const li = store.isLI;
    return header('Vermögen & Schulden', li
      ? `Stand am 1. Januar ${store.year} (Seite 2 der Steuererklärung). Bewertung wie im Hilfsformular A1.`
      : `Stand am 31. Dezember ${store.year}. Konten und Wertschriften bilden das Wertschriftenverzeichnis (Formular 2) und bestimmen die Rückerstattung der Verrechnungssteuer.`, 'wealth')
      + (li ? liHeader(c) : '')
      + securities(c) + others(c) + realEstate(c) + debts(c)
      + (li ? '' : capital(c))
      + section(li ? 'Ergebnis Seite 2' : 'Ergebnis Seite 4', live('total'));
  },
  live: {
    soll: (r) => staticRow('Sollertrag (Ziffer 7.1)', `<b>${chf(resultValue(r, '885'))} CHF</b>`),
    re: (r) => resultRow('Ertrag Liegenschaften (Ziffer 5)', resultValue(r, '712')) + resultRow('Unterhaltskosten (Ziffer 15)', resultValue(r, '716')),
    cap: (r) => (r.capitalPaymentTax ? resultRow('Separate Steuer auf Kapitalleistungen', r.capitalPaymentTax.canton, r.capitalPaymentTax.federal) : ''),
    total: (r) => (store.isLI
      ? resultRow('Total der Vermögenswerte (Ziffer 4)', resultValue(r, '800')) + resultRow('Gesamtvermögen (Ziffer 6)', resultValue(r, '880')) + resultRow('Sollertrag 4 % (Ziffer 7.1 → 14.6)', resultValue(r, '885'))
      : resultRow('Total Vermögenswerte (Ziffer 33)', resultValue(r, '322')) + resultRow('Reinvermögen (Ziffer 35)', resultValue(r, '326'))
        + resultRow('Steuerbares Vermögen (Ziffer 37)', resultValue(r, '338')) + `<div class="rr"><span>Verrechnungssteuer-Rückerstattung (35%)</span><span class="rr-v"><b>${chf(r.withholdingTaxRefund, 2)} CHF</b></span></div>`),
  },
  actions: {
    addSec(c, d) { securityEditor(c, undefined, d.kind); return false; },
    editSec(c, d) { securityEditor(c, Number(d.i)); return false; },
    async delSec(c, d) {
      const s = c.securities[Number(d.i)];
      if (!(await confirmDialog('Eintrag löschen?', `«${s.description || s.institution || 'Eintrag'}» wird aus dem Wertschriftenverzeichnis entfernt.`))) return false;
      c.securities.splice(Number(d.i), 1);
    },
    addIns(c) { c.insurances.push(M.newInsurancePolicy()); },
    delIns(c, d) { c.insurances.splice(Number(d.i), 1); },
    addVeh(c) { c.vehicles.push({ ...M.newVehicle(), purchaseYear: store.year }); },
    delVeh(c, d) { c.vehicles.splice(Number(d.i), 1); },
    addRE(c) { c.realEstate.push({ ...M.newRealEstate(), municipality: c.municipality, canton: store.isLI ? 'FL' : 'SG' }); },
    async delRE(c, d) {
      if (!(await confirmDialog('Liegenschaft entfernen?', 'Die Liegenschaft und ihre Werte werden aus diesem Steuerjahr entfernt.'))) return false;
      c.realEstate.splice(Number(d.i), 1);
    },
    addDebt(c) { c.debts.push(M.newDebt()); },
    delDebt(c, d) { c.debts.splice(Number(d.i), 1); },
    addCap(c) { c.capitalPayments.push(M.newCapitalPayment()); },
    delCap(c, d) { c.capitalPayments.splice(Number(d.i), 1); },
  },
};
