// Steuerhilfe Web · Einkommen (wie IncomeView.swift): Lohnausweise, Renten, weitere Einkünfte.
import { store } from '../store.js';
import { icon } from '../icons.js';
import { chf } from '../../engine/money.js';
import * as M from '../../engine/model.js';
import { resultValue } from '../../engine/calculator.js';
import { fields, header, section, staticRow, empty, addBtn, delBtn, live, resultRow, note, confirmDialog, editDialog, esc } from '../forms.js';

const open = {};   // aufgeklappte «Renten, Taggelder …» je Person

function salaryRow(s, key, i) {
  const li = store.isLI;
  return `<div class="list-row">
    <span class="lr-ic">${icon('briefcase')}</span>
    <span class="lr-main"><b>${esc(s.employer || 'Arbeitgeber')}</b><small>${s.isMainEmployment ? 'Haupterwerb' : 'Nebenerwerb'}${s.employerInLiechtenstein ? ' · 🇱🇮 Grenzgänger' : ''}</small></span>
    <span class="lr-val"><b>${chf(li ? s.grossSalary : M.netSalary(s))} CHF</b><small>${li ? 'Bruttolohn' : 'Nettolohn (Ziffer 11)'}</small></span>
    <button type="button" class="btn btn-ghost sm" data-act="editSalary" data-key="${key}" data-i="${i}">Bearbeiten</button>
    ${delBtn('delSalary', { key, i }, 'Lohnausweis löschen')}
  </div>`;
}

function personIncome(c, n) {
  const key = `income${n}`;
  const inc = c[key];
  const p = c[`person${n}`];
  const name = p.firstName || `Person ${n}`;
  const f = fields(c);
  const pensions = inc.pensions.map((x, i) => `<div class="trow">
      <span class="ziffer">3.2</span>${f.cellText(`${key}.pensions.${i}.label`, 'Rente / Pension (z.B. Pensionskasse)')}
      ${f.cellChf(`${key}.pensions.${i}.amount`)}
      ${f.cellSelect(`${key}.pensions.${i}.taxablePercent`, [[100, '100%'], [80, '80%']], { cast: 'num', aria: 'steuerbarer Anteil' })}
      ${delBtn('delPension', { key, i })}</div>`).join('');
  const more = `<details class="more" data-more="${n}"${open[n] ? ' open' : ''}><summary>Renten, Taggelder, selbständige Tätigkeit</summary>
      ${f.chf(`${key}.ahvPension`, 'AHV/IV-Renten', { ziffer: '3.1' })}
      ${pensions}${addBtn('addPension', 'Rente / Pension hinzufügen', { key })}
      ${f.chf(`${key}.dailyAllowances`, 'Taggelder (Kranken-, Unfall-, Mutterschaft, Militär)', { ziffer: '3.3', help: 'Nur soweit nicht im Lohnausweis enthalten.' })}
      ${f.chf(`${key}.unemployment`, 'Arbeitslosentaggelder', { ziffer: '3.4', help: 'Nur soweit nicht im Lohnausweis enthalten.' })}
      ${f.chf(`${key}.boardFees`, 'Sitzungsgelder, VR-Honorare', { ziffer: '1.3' })}
      ${f.chf(`${key}.selfEmployment`, 'Selbständige Erwerbstätigkeit (Reingewinn)', { ziffer: '2.1', help: 'Gewinn gemäss Jahresrechnung. Bilanz und Erfolgsrechnung beilegen.' })}
      ${f.chf(`${key}.partnership`, 'Kollektiv-/Kommanditgesellschaften', { ziffer: '2.2' })}
    </details>`;
  return section(`Einkommen ${esc(name)}`,
    (inc.salaries.length ? inc.salaries.map((s, i) => salaryRow(s, key, i)).join('')
      : empty('doc', 'Noch kein Lohnausweis', 'Fügen Sie für jeden Arbeitgeber den Lohnausweis hinzu.'))
    + addBtn('addSalary', 'Lohnausweis hinzufügen', { key, n })
    + more);
}

function household(c) {
  const f = fields(c);
  return section('Weitere Einkünfte (gemeinsam)',
    f.chf('householdIncome.familyAllowancesDirect', 'Familienzulagen direkt von der Ausgleichskasse', { ziffer: '3.5', help: 'Nur wenn nicht im Lohnausweis enthalten – z.B. bei Arbeitgeber im Fürstentum Liechtenstein.' })
    + f.chf('householdIncome.alimonyReceivedSelf', 'Erhaltene Unterhaltsbeiträge für sich', { ziffer: '6.1' })
    + f.chf('householdIncome.alimonyReceivedChildren', 'Erhaltene Unterhaltsbeiträge für Kinder', { ziffer: '6.1' })
    + f.chf('householdIncome.undividedEstates', 'Ertrag aus unverteilten Erbschaften', { ziffer: '6.2' })
    + f.chf('householdIncome.otherIncome', 'Übrige Einkünfte', { ziffer: '6.3', rerender: true, help: 'z.B. Provisionen, Trinkgelder, Lizenzen, Solarstrom-Verkauf über Eigenverbrauch, Plattform-Einkünfte (Airbnb, Ricardo).' })
    + (c.householdIncome.otherIncome > 0 ? f.text('householdIncome.otherIncomeDescription', 'Art der übrigen Einkünfte') : '')
    + f.chf('householdIncome.simplifiedSettlementIncome', 'Vereinfacht abgerechnete Einkünfte (Information)', { ziffer: '8.1', help: 'Kleine Löhne, die der Arbeitgeber direkt mit der AHV abgerechnet hat (5% Quellensteuer). Nur zur Information.' }));
}

/** Lohnausweis bearbeiten (wie SalaryEditor.swift). */
function salaryEditor(c, key, i) {
  const isNew = i === undefined;
  const p = c[`person${key.slice(-1)}`];
  const draft = isNew
    ? { ...M.newSalary(), employer: c[key].salaries.length ? '' : p.employer, isMainEmployment: !c[key].salaries.length }
    : structuredClone(c[key].salaries[i]);
  const ui = { manualNet: draft.netSalaryOverride !== undefined };
  const sg = !store.isLI;
  editDialog({
    title: 'Lohnausweis', subtitle: 'Die Nummern entsprechen den Ziffern auf dem amtlichen Lohnausweis.', ic: 'doc', draft,
    render: (d) => {
      const f = fields(d);
      const net = M.netSalary({ ...d, netSalaryOverride: undefined });
      return section('', f.text('employer', 'Arbeitgeber')
          + f.seg('isMainEmployment', [[true, 'Haupterwerb'], [false, 'Nebenerwerb']], { cast: 'bool', label: 'Art' })
          + (sg ? f.toggle('employerInLiechtenstein', '🇱🇮 Arbeitgeber in Liechtenstein (Grenzgänger)', { help: 'Wer in der Schweiz wohnt und in Liechtenstein arbeitet, versteuert den Lohn in der Schweiz (Doppelbesteuerungsabkommen CH–FL, Art. 15 Abs. 4). Liechtenstein zieht keine Steuer ab. Übertragen Sie die Beträge aus dem Liechtensteiner Lohnausweis: Bruttolohn, AHV/IV/ALV-Beiträge und Pensionskasse.' }) : ''))
        + (sg && d.employerInLiechtenstein ? section('Grenzgänger nach Liechtenstein',
          note('Der Liechtensteiner Lohnausweis sieht anders aus: Bruttolohn → Ziffer 8, Beiträge AHV/IV/FAK/ALV und Unfall → Ziffer 9, Pensionskasse → Ziffer 10. Weist er einen Steuerabzug aus, ist das ein Fehler – Grenzgänger aus der Schweiz zahlen in Liechtenstein keine Steuer. Bitte beim Arbeitgeber zurückfordern.')
          + note('Wer mehr als 45 Arbeitstage im Jahr nicht nach Hause zurückkehrt, gilt nicht mehr als Grenzgänger – dann bitte beim Steueramt nachfragen.', 'warn')) : '')
        + section('Beträge',
          f.chf('grossSalary', 'Bruttolohn total', { ziffer: sg ? '8' : undefined, rerender: true })
          + f.chf('socialContributions', 'Beiträge AHV/IV/EO/ALV/NBUV', { ziffer: '9', rerender: true })
          + f.chf('pensionContributions', 'Berufliche Vorsorge – ordentliche Beiträge', { ziffer: '10.1', rerender: true })
          + f.chf('pensionBuyIn', 'Berufliche Vorsorge – Beiträge für den Einkauf', { ziffer: '10.2', rerender: true })
          + `<label class="fr tog"><span class="lbl"><span>Nettolohn abweichend eingeben</span></span><span class="ctl"><input type="checkbox" role="switch" data-act="toggleNet"${ui.manualNet ? ' checked' : ''}><i></i></span></label>`
          + (ui.manualNet ? f.chf('netSalaryOverride', 'Nettolohn', { ziffer: '11', optional: true })
            : staticRow('Nettolohn (berechnet)', `<b>${chf(net)} CHF</b>`, { ziffer: '11' })))
        + (sg ? section('Kästchen und Spesen',
          f.toggle('fieldF', '<span class="ziffer">F</span> Unentgeltliche Beförderung zum Arbeitsort')
          + f.toggle('fieldG', '<span class="ziffer">G</span> Kantinenverpflegung / Lunch-Checks')
          + f.chf('flatRateExpenses', 'Pauschalspesen', { ziffer: '13', help: 'Ziffer 13.1.2 / 13.2.3. Bei Pauschalspesen entfällt der Pauschalabzug für übrige Berufskosten.' })
          + f.area('remarks', 'Bemerkungen (Ziffer 15)')) : '');
    },
    actions: {
      toggleNet: (_, el) => {
        ui.manualNet = el.checked;
        if (ui.manualNet) draft.netSalaryOverride = M.netSalary({ ...draft, netSalaryOverride: undefined });
        else delete draft.netSalaryOverride;
      },
    },
    onSave: (d) => {
      if (!ui.manualNet) delete d.netSalaryOverride;
      if (!d.employerInLiechtenstein) delete d.employerInLiechtenstein;
      store.update((cc) => {
        if (isNew) cc[key].salaries.push(d);
        else cc[key].salaries[i] = d;
      });
    },
  });
}

export default {
  render(c) {
    const li = store.isLI;
    return header('Einkommen', `Lohnausweise, Renten und weitere Einkünfte ${store.year}. Wertschriftenerträge erfassen Sie unter «Vermögen».`, 'income')
      + personIncome(c, 1)
      + (M.isJoint(c) ? personIncome(c, 2) : '')
      + household(c)
      + section(li ? 'Ergebnis Seite 3' : 'Ergebnis Seite 2', live('total'));
  },
  live: {
    total: (r) => (store.isLI ? resultRow('Total Erwerb inkl. Sollertrag (Ziffer 15)', resultValue(r, '570')) : resultRow('Total der Einkünfte (Ziffer 7)', resultValue(r, '168'))),
  },
  after(el) {
    el.querySelectorAll('details[data-more]').forEach((d) => d.addEventListener('toggle', () => { open[d.dataset.more] = d.open; }));
  },
  actions: {
    addSalary(c, d) { salaryEditor(c, d.key); return false; },
    editSalary(c, d) { salaryEditor(c, d.key, Number(d.i)); return false; },
    async delSalary(c, d) {
      const s = c[d.key].salaries[Number(d.i)];
      if (!(await confirmDialog('Lohnausweis löschen?', `Der Lohnausweis von «${s.employer || 'ohne Namen'}» wird entfernt.`))) return false;
      c[d.key].salaries.splice(Number(d.i), 1);
    },
    addPension(c, d) { open[d.key.slice(-1)] = true; c[d.key].pensions.push(M.newPensionIncome()); },
    delPension(c, d) { c[d.key].pensions.splice(Number(d.i), 1); },
  },
};
