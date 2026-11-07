// Steuerhilfe Web · LZFSE, das Kompressionsformat von Apple.
// Die Mac-App packt den Cloud-Block mit NSData.compressed(using: .lzfse). Der Browser kennt
// nur gzip/deflate, darum hier ein eigener Leser – übertragen aus der Referenz von Apple
// (github.com/lzfse/lzfse, BSD-Lizenz): Blöcke «bvx2» (FSE), «bvx1», «bvxn» (LZVN) und «bvx-».
// Schreiben tut der Browser als unkomprimierten Block «bvx-»: den liest jede Apple-Version.

const MAGIC_END = 0x24787662;   // bvx$
const MAGIC_RAW = 0x2d787662;   // bvx-
const MAGIC_V1 = 0x31787662;    // bvx1
const MAGIC_V2 = 0x32787662;    // bvx2
const MAGIC_LZVN = 0x6e787662;  // bvxn

const L_SYMBOLS = 20, M_SYMBOLS = 20, D_SYMBOLS = 64, LIT_SYMBOLS = 256;
const L_STATES = 64, M_STATES = 64, D_STATES = 256, LIT_STATES = 1024;

const L_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 5, 8];
const L_BASE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 28, 60];
const M_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 5, 8, 11];
const M_BASE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 24, 56, 312];
const D_EXTRA = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 7, 7, 7, 7,
  8, 8, 8, 8, 9, 9, 9, 9, 10, 10, 10, 10, 11, 11, 11, 11, 12, 12, 12, 12, 13, 13, 13, 13, 14, 14, 14, 14, 15, 15, 15, 15];
const D_BASE = [0, 1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 28, 36, 44, 52, 60, 76, 92, 108, 124, 156, 188, 220,
  252, 316, 380, 444, 508, 636, 764, 892, 1020, 1276, 1532, 1788, 2044, 2556, 3068, 3580, 4092, 5116, 6140,
  7164, 8188, 10236, 12284, 14332, 16380, 20476, 24572, 28668, 32764, 40956, 49148, 57340, 65532, 81916,
  98300, 114684, 131068, 163836, 196604, 229372];

const FREQ_NBITS = [2, 3, 2, 5, 2, 3, 2, 8, 2, 3, 2, 5, 2, 3, 2, 14, 2, 3, 2, 5, 2, 3, 2, 8, 2, 3, 2, 5, 2, 3, 2, 14];
const FREQ_VALUE = [0, 2, 1, 4, 0, 3, 1, -1, 0, 2, 1, 5, 0, 3, 1, -1, 0, 2, 1, 6, 0, 3, 1, -1, 0, 2, 1, 7, 0, 3, 1, -1];

class Bad extends Error { constructor(m) { super('LZFSE: ' + m); } }
const check = (ok, m) => { if (!ok) throw new Bad(m); };

const clz32 = Math.clz32;

/** Wachsender Ausgabepuffer. Treffer dürfen auf alles davor zeigen, auch über Blockgrenzen. */
class Out {
  constructor(n = 1 << 16) { this.b = new Uint8Array(n); this.n = 0; this.limit = Infinity; }
  need(k) {
    check(this.n + k <= this.limit, 'Block länger als angegeben');
    if (this.n + k <= this.b.length) return;
    let s = this.b.length * 2;
    while (s < this.n + k) s *= 2;
    const nb = new Uint8Array(s); nb.set(this.b.subarray(0, this.n)); this.b = nb;
  }
  copyFrom(src, at, len) { this.need(len); this.b.set(src.subarray(at, at + len), this.n); this.n += len; }
  match(d, len) {
    check(d > 0 && d <= this.n, 'Distanz');
    this.need(len);
    const b = this.b; let p = this.n;
    for (let i = 0; i < len; i++, p++) b[p] = b[p - d];   // Byte für Byte: Überlappung erlaubt
    this.n = p;
  }
}

// ---------------------------------------------------------------- FSE-Tabellen
function decoderTable(nstates, nsymbols, freq) {
  const t = new Array(nstates);
  const nClz = clz32(nstates);
  let pos = 0, total = 0;
  for (let i = 0; i < nsymbols; i++) {
    const f = freq[i];
    if (!f) continue;
    total += f; check(total <= nstates, 'Häufigkeiten');
    const k = clz32(f) - nClz;
    const j0 = ((2 * nstates) >> k) - f;
    for (let j = 0; j < f; j++) {
      t[pos++] = j < j0
        ? { k, sym: i, delta: ((f + j) << k) - nstates }
        : { k: k - 1, sym: i, delta: (j - j0) << (k - 1) };
    }
  }
  return t;
}

function valueDecoderTable(nstates, nsymbols, freq, vbits, vbase) {
  const t = new Array(nstates);
  const nClz = clz32(nstates);
  let pos = 0, total = 0;
  for (let i = 0; i < nsymbols; i++) {
    const f = freq[i];
    if (!f) continue;
    total += f; check(total <= nstates, 'Häufigkeiten');
    const k = clz32(f) - nClz;
    const j0 = ((2 * nstates) >> k) - f;
    for (let j = 0; j < f; j++) {
      t[pos++] = j < j0
        ? { total: k + vbits[i], vbits: vbits[i], vbase: vbase[i], delta: ((f + j) << k) - nstates }
        : { total: k - 1 + vbits[i], vbits: vbits[i], vbase: vbase[i], delta: (j - j0) << (k - 1) };
    }
  }
  return t;
}

// ---------------------------------------------------------------- Bitstrom (rückwärts, 64 bit)
const MASK64 = (1n << 64n) - 1n;
const u64 = (b, p) => {   // little endian, 8 Bytes ab p
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[p + i] ?? 0);
  return v;
};
const maskLsb = (x, n) => (n <= 0 ? 0n : x & ((1n << BigInt(n)) - 1n));

class InStream {
  // Wie in der Referenz: der Anfang wird gegen den eigenen Bereich geprüft, das Nachladen nur gegen
  // den Anfang der ganzen Eingabe – beim Nachladen wird vorausgelesen, auch Bytes, die nie gebraucht werden.
  constructor(src, start, end, nbits) {
    this.src = src; this.start = 0; this.p = end;
    if (nbits !== 0) {
      check(this.p >= start + 8, 'Bitstrom');
      this.p -= 8; this.accum = u64(src, this.p); this.nbits = nbits + 64;
    } else {
      check(this.p >= start + 7, 'Bitstrom');
      this.p -= 7; this.accum = u64(src, this.p) & 0xffffffffffffffn; this.nbits = nbits + 56;
    }
    check(this.nbits >= 56 && this.nbits < 64 && (this.accum >> BigInt(this.nbits)) === 0n, 'Bitstrom-Anfang');
  }
  flush() {
    const nbits = (63 - this.nbits) & -8;
    const nbytes = nbits >> 3;
    const p = this.p - nbytes;
    check(p >= this.start, 'Bitstrom zu kurz');
    const incoming = u64(this.src, p);
    this.accum = ((this.accum << BigInt(nbits)) & MASK64) | maskLsb(incoming, nbits);
    this.nbits += nbits;
    this.p = p;
  }
  pull(n) {
    this.nbits -= n;
    const r = this.accum >> BigInt(this.nbits);
    this.accum = maskLsb(this.accum, this.nbits);
    return Number(r);
  }
}

// ---------------------------------------------------------------- bvx1 / bvx2
const le32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
const le16 = (b, p) => b[p] | (b[p + 1] << 8);
const field = (v, off, n) => Number((v >> BigInt(off)) & ((1n << BigInt(n)) - 1n));

function readV1Header(b, p) {
  const h = {
    nRaw: le32(b, p + 4), nPayload: le32(b, p + 8), nLiterals: le32(b, p + 12), nMatches: le32(b, p + 16),
    nLitPayload: le32(b, p + 20), nLmdPayload: le32(b, p + 24),
    litBits: le32(b, p + 28) | 0,
    litState: [le16(b, p + 32), le16(b, p + 34), le16(b, p + 36), le16(b, p + 38)],
    lmdBits: le32(b, p + 40) | 0,
    lState: le16(b, p + 44), mState: le16(b, p + 46), dState: le16(b, p + 48),
  };
  let q = p + 50;
  const freqs = [];
  for (let i = 0; i < L_SYMBOLS + M_SYMBOLS + D_SYMBOLS + LIT_SYMBOLS; i++, q += 2) freqs.push(le16(b, q));
  splitFreqs(h, freqs);
  h.headerSize = q - p;
  return h;
}

function splitFreqs(h, f) {
  h.lFreq = f.slice(0, 20); h.mFreq = f.slice(20, 40); h.dFreq = f.slice(40, 104); h.litFreq = f.slice(104, 360);
}

function readV2Header(b, p) {
  const v0 = u64(b, p + 8), v1 = u64(b, p + 16), v2 = u64(b, p + 24);
  const h = {
    nRaw: le32(b, p + 4),
    nLiterals: field(v0, 0, 20), nLitPayload: field(v0, 20, 20), nMatches: field(v0, 40, 20),
    litBits: field(v0, 60, 3) - 7,
    litState: [field(v1, 0, 10), field(v1, 10, 10), field(v1, 20, 10), field(v1, 30, 10)],
    nLmdPayload: field(v1, 40, 20), lmdBits: field(v1, 60, 3) - 7,
    headerSize: field(v2, 0, 32),
    lState: field(v2, 32, 10), mState: field(v2, 42, 10), dState: field(v2, 52, 10),
  };
  h.nPayload = h.nLitPayload + h.nLmdPayload;
  const n = L_SYMBOLS + M_SYMBOLS + D_SYMBOLS + LIT_SYMBOLS;
  const freqs = new Array(n).fill(0);
  if (h.headerSize > 32) {
    let src = p + 32;
    const end = p + h.headerSize;
    let accum = 0, accumBits = 0;   // höchstens 32 Bit: als Number exakt
    for (let i = 0; i < n; i++) {
      while (src < end && accumBits + 8 <= 32) { accum += b[src] * 2 ** accumBits; accumBits += 8; src++; }
      const low = accum % 32;
      const nb = FREQ_NBITS[low];
      check(nb <= accumBits, 'Kopf');
      let value;
      if (nb === 8) value = 8 + (Math.floor(accum / 16) % 16);
      else if (nb === 14) value = 24 + (Math.floor(accum / 16) % 1024);
      else value = FREQ_VALUE[low];
      freqs[i] = value;
      accum = Math.floor(accum / 2 ** nb); accumBits -= nb;
    }
    check(accumBits < 8 && src === end, 'Kopf-Ende');
  }
  splitFreqs(h, freqs);
  return h;
}

function decodeCompressed(b, p, h, out) {
  check(h.nLiterals <= 40000 && h.nMatches <= 10000, 'Blockgrösse');
  check(h.litState.every((s) => s < LIT_STATES) && h.lState < L_STATES && h.mState < M_STATES && h.dState < D_STATES, 'Zustände');
  const payload = p + h.headerSize;
  check(payload + h.nLitPayload + h.nLmdPayload <= b.length, 'abgeschnitten');

  // Literale: vier verschränkte FSE-Ströme
  const litTable = decoderTable(LIT_STATES, LIT_SYMBOLS, h.litFreq);
  const lits = new Uint8Array(h.nLiterals + 4);
  {
    const s = h.litState.slice();
    const inp = new InStream(b, payload, payload + h.nLitPayload, h.litBits);
    for (let i = 0; i < h.nLiterals; i += 4) {
      inp.flush();
      for (let k = 0; k < 4; k++) {
        const e = litTable[s[k]];
        check(e, 'Literal');
        s[k] = e.delta + inp.pull(e.k);
        lits[i + k] = e.sym;
      }
    }
  }

  // L/M/D: Literale kopieren, dann Treffer
  const lT = valueDecoderTable(L_STATES, L_SYMBOLS, h.lFreq, L_EXTRA, L_BASE);
  const mT = valueDecoderTable(M_STATES, M_SYMBOLS, h.mFreq, M_EXTRA, M_BASE);
  const dT = valueDecoderTable(D_STATES, D_SYMBOLS, h.dFreq, D_EXTRA, D_BASE);
  const lmdStart = payload + h.nLitPayload;
  const inp = new InStream(b, lmdStart, lmdStart + h.nLmdPayload, h.lmdBits);
  let ls = h.lState, ms = h.mState, ds = h.dState, D = -1, lit = 0;
  const value = (t, state) => {
    const e = t[state];
    check(e, 'Wert');
    const sv = inp.pull(e.total);
    return [e.delta + Math.floor(sv / 2 ** e.vbits), e.vbase + (sv % 2 ** e.vbits)];
  };
  const startN = out.n;
  for (let m = 0; m < h.nMatches; m++) {
    inp.flush();
    let L, M, nd;
    [ls, L] = value(lT, ls);
    [ms, M] = value(mT, ms);
    [ds, nd] = value(dT, ds);
    if (nd) D = nd;
    check(lit + L <= lits.length, 'Literale');
    out.copyFrom(lits, lit, L); lit += L;
    if (M) out.match(D, M);
  }
  check(out.n - startN === h.nRaw, 'Länge');
  return payload + h.nPayload;
}

// ---------------------------------------------------------------- LZVN
function decodeLzvn(b, p, end, nRaw, out) {
  const startN = out.n;
  let D = 0;
  const lits = (q, L) => { check(q + L <= end, 'LZVN Literale'); out.copyFrom(b, q, L); return q + L; };
  while (p < end) {
    const opc = b[p];
    if (opc === 0x06) break;                                   // eos
    if (opc === 0x0e || opc === 0x16) { p += 1; continue; }     // nop
    const hi = opc >> 4, lo3 = opc & 7;
    if (opc === 0xe0) { p = lits(p + 2, b[p + 1] + 16); continue; }          // large literal
    if (hi === 0xe) { p = lits(p + 1, opc & 0xf); continue; }               // small literal
    if (opc === 0xf0) { out.match(D, b[p + 1] + 16); p += 2; continue; }    // large match
    if (hi === 0xf) { out.match(D, opc & 0xf); p += 1; continue; }          // small match
    check(!(hi === 0x7 || hi === 0xd), 'LZVN Opcode');
    if ((opc & 0xe0) === 0xa0) {                                              // medium distance
      const L = (opc >> 3) & 3, w = le16(b, p + 1);
      const M = (((opc & 7) << 2) | (w & 3)) + 3;
      D = w >> 2; p = lits(p + 3, L); out.match(D, M); continue;
    }
    const L = (opc >> 6) & 3, M = ((opc >> 3) & 7) + 3;
    if (lo3 === 7) { D = le16(b, p + 1); p = lits(p + 3, L); out.match(D, M); continue; }   // large distance
    if (lo3 === 6) { check(opc >= 0x40, 'LZVN Opcode'); p = lits(p + 1, L); out.match(D, M); continue; } // previous distance
    D = (lo3 << 8) | b[p + 1]; p = lits(p + 2, L); out.match(D, M);         // small distance
  }
  check(out.n - startN === nRaw, 'LZVN Länge');
}

// ---------------------------------------------------------------- öffentlich
/** Entpackt einen LZFSE-Strom (wie NSData.decompressed(using: .lzfse)). */
export function lzfseDecode(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const out = new Out(Math.min(Math.max(1024, b.length * 4), 1 << 24));
  let p = 0;
  for (;;) {
    check(p + 4 <= b.length, 'Ende fehlt');
    const magic = le32(b, p);
    if (magic === MAGIC_END) break;
    if (magic === MAGIC_RAW) {
      const n = le32(b, p + 4);
      check(p + 8 + n <= b.length, 'abgeschnitten');
      out.copyFrom(b, p + 8, n); p += 8 + n;
    } else if (magic === MAGIC_LZVN) {
      const nRaw = le32(b, p + 4), nPay = le32(b, p + 8);
      check(p + 12 + nPay <= b.length, 'abgeschnitten');
      out.limit = out.n + nRaw;
      decodeLzvn(b, p + 12, p + 12 + nPay, nRaw, out); p += 12 + nPay;
      out.limit = Infinity;
    } else if (magic === MAGIC_V2 || magic === MAGIC_V1) {
      const h = magic === MAGIC_V2 ? readV2Header(b, p) : readV1Header(b, p);
      out.limit = out.n + h.nRaw;
      p = decodeCompressed(b, p, h, out);
      out.limit = Infinity;
    } else throw new Bad('unbekannter Block');
  }
  return out.b.slice(0, out.n);
}

/** Verpackt Daten als gültigen LZFSE-Strom – unkomprimiert («bvx-»), das genügt: die Daten sind klein. */
export function lzfseEncodeRaw(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const out = new Uint8Array(b.length + 12);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC_RAW, true);
  dv.setUint32(4, b.length, true);
  out.set(b, 8);
  dv.setUint32(8 + b.length, MAGIC_END, true);
  return out;
}
