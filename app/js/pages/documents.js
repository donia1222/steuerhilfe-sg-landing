// Steuerhilfe Web · Belege. In der Mac-App liest Steuerhilfe Lohnausweise und Bescheinigungen selbst;
// im Browser folgt das in einem nächsten Schritt. Bis dahin: was man bereithalten sollte.
import { store } from '../store.js';
import { icon } from '../icons.js';
import { header } from '../forms.js';

export default {
  render() {
    const li = store.isLI;
    const items = [
      ['briefcase', 'Lohnausweise', 'Von jedem Arbeitgeber. Daraus kommen Bruttolohn, AHV-Beiträge und Pensionskasse.', 'income'],
      ['pension', li ? 'Pensionskasse' : 'Säule 3a und Pensionskasse', li ? 'Bestätigung über freiwillige Einkäufe.' : 'Bescheinigungen der Bank oder Versicherung über die Einzahlungen.', 'pension'],
      ['bank', 'Bank- und Postkonten', `Saldo per ${li ? '1. Januar' : '31. Dezember'} und die Zinsen – am einfachsten der Steuerauszug der Bank.`, 'wealth'],
      ['other', 'Krankenkasse', li ? 'Kostenübersicht: Franchise, Selbstbehalt, Zahnarzt.' : 'Prämienbestätigung und Kostenübersicht (Franchise, Selbstbehalt).', li ? 'other' : 'pension'],
      ['child', 'Kinderbetreuung', 'Rechnungen von Kita, Hort oder Tagesfamilie.', 'other'],
      ['heart', 'Spenden', 'Spendenbestätigungen ab Fr. 100.', 'other'],
    ];
    return header('Belege', 'Was Sie für die Steuererklärung bereithalten sollten. Belege hochladen und automatisch auslesen lassen folgt im Browser in Kürze – in der Mac-App gibt es das schon.', 'documents')
      + `<section class="card"><div class="docs">${items.map(([ic, t, d, page]) => `<a class="doc" href="#/${page}">${icon(ic === 'heart' ? 'other' : ic)}<span><b>${t}</b><small>${d}</small></span>${icon('chevron', 'ic chev')}</a>`).join('')}</div></section>`;
  },
};
