import bs58 from 'bs58';

/**
 * Decodes NEUKO Market Anchor events from a transaction's program logs.
 * Anchor emits events via `sol_log_data`: "Program data: <base64>" where the
 * payload is an 8-byte event discriminator + borsh-serialized struct.
 */

const DISC = {
  Listed: [243, 173, 136, 195, 125, 241, 12, 99],
  Sold: [205, 203, 210, 202, 96, 11, 192, 10],
  SwapCreated: [95, 3, 86, 52, 73, 22, 116, 203],
  SwapAccepted: [226, 86, 141, 186, 157, 59, 108, 143],
  OfferCreated: [31, 236, 215, 144, 75, 45, 157, 87],
  OfferAccepted: [81, 238, 238, 115, 140, 18, 8, 20],
};

function matches(buf: Buffer, disc: number[]): boolean {
  return disc.every((b, i) => buf[i] === b);
}

class Reader {
  off = 8; // skip discriminator
  constructor(private buf: Buffer) {}
  pubkey(): string {
    if (this.off + 32 > this.buf.length) throw new Error('Buffer underflow');
    const b = this.buf.subarray(this.off, this.off + 32);
    this.off += 32;
    return bs58.encode(b);
  }
  u64(): bigint {
    if (this.off + 8 > this.buf.length) throw new Error('Buffer underflow');
    const v = this.buf.readBigUInt64LE(this.off);
    this.off += 8;
    return v;
  }
  u8(): number {
    if (this.off + 1 > this.buf.length) throw new Error('Buffer underflow');
    return this.buf[this.off++];
  }
}

export type DecodedEvent =
  | { type: 'Listed'; asset: string; seller: string; price: bigint; currency: number }
  | { type: 'Sold'; asset: string; seller: string; buyer: string; price: bigint; currency: number }
  | { type: 'SwapCreated'; swap: string; maker: string }
  | { type: 'SwapAccepted'; swap: string; maker: string; taker: string }
  | { type: 'OfferCreated'; offer: string; bidder: string; collection: string; asset: string; amount: bigint; currency: number }
  | { type: 'OfferAccepted'; offer: string; bidder: string; seller: string; asset: string; amount: bigint; currency: number };

export function decodeEvents(logs: string[]): DecodedEvent[] {
  const out: DecodedEvent[] = [];
  for (const line of logs) {
    if (!line.startsWith('Program data: ')) continue;
    let buf: Buffer;
    try {
      buf = Buffer.from(line.slice('Program data: '.length), 'base64');
    } catch {
      continue;
    }
    if (buf.length < 8) continue;
    try {
      if (matches(buf, DISC.Listed)) {
        const r = new Reader(buf);
        out.push({ type: 'Listed', asset: r.pubkey(), seller: r.pubkey(), price: r.u64(), currency: r.u8() });
      } else if (matches(buf, DISC.Sold)) {
        const r = new Reader(buf);
        out.push({ type: 'Sold', asset: r.pubkey(), seller: r.pubkey(), buyer: r.pubkey(), price: r.u64(), currency: r.u8() });
      } else if (matches(buf, DISC.SwapCreated)) {
        const r = new Reader(buf);
        out.push({ type: 'SwapCreated', swap: r.pubkey(), maker: r.pubkey() });
      } else if (matches(buf, DISC.SwapAccepted)) {
        const r = new Reader(buf);
        out.push({ type: 'SwapAccepted', swap: r.pubkey(), maker: r.pubkey(), taker: r.pubkey() });
      } else if (matches(buf, DISC.OfferCreated)) {
        const r = new Reader(buf);
        out.push({
          type: 'OfferCreated',
          offer: r.pubkey(),
          bidder: r.pubkey(),
          collection: r.pubkey(),
          asset: r.pubkey(),
          amount: r.u64(),
          currency: r.u8(),
        });
      } else if (matches(buf, DISC.OfferAccepted)) {
        const r = new Reader(buf);
        out.push({
          type: 'OfferAccepted',
          offer: r.pubkey(),
          bidder: r.pubkey(),
          seller: r.pubkey(),
          asset: r.pubkey(),
          amount: r.u64(),
          currency: r.u8(),
        });
      }
    } catch (e) {
      continue;
    }
  }
  return out;
}
