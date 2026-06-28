import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  PROGRAM_ID,
  MPL_CORE_PROGRAM_ID,
  GBOY_MINT,
  GBOY_DECIMALS,
  COLLECTIONS,
  type CollectionKey,
} from './constants';
import type { Currency } from './types';

/**
 * Thin, IDL-free client for the NEUKO Market program. Instruction data is built
 * from the Anchor 8-byte discriminators + borsh-encoded args, and account metas
 * mirror the on-chain `#[derive(Accounts)]` order exactly.
 */

const IX = {
  list_asset: Buffer.from([11, 25, 254, 205, 61, 252, 23, 15]),
  update_listing: Buffer.from([192, 174, 210, 68, 116, 40, 242, 253]),
  cancel_listing: Buffer.from([41, 183, 50, 232, 230, 233, 157, 70]),
  purchase_with_sol: Buffer.from([27, 238, 240, 155, 170, 180, 26, 118]),
  purchase_with_gboy: Buffer.from([35, 75, 217, 23, 181, 147, 238, 135]),
  create_swap: Buffer.from([176, 207, 238, 60, 195, 2, 203, 91]),
  accept_swap: Buffer.from([166, 173, 240, 207, 167, 11, 3, 20]),
  cancel_swap: Buffer.from([88, 174, 98, 148, 24, 252, 93, 89]),
  create_offer: Buffer.from([237, 233, 192, 168, 248, 7, 249, 241]),
  cancel_offer: Buffer.from([92, 203, 223, 40, 92, 89, 53, 119]),
  accept_offer: Buffer.from([227, 82, 234, 131, 1, 18, 48, 2]),
};

// ---- amount helpers -------------------------------------------------------

export function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * 1e9));
}
export function gboyToBase(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** GBOY_DECIMALS));
}

// ---- borsh-lite encoders --------------------------------------------------

function u64(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}
function u8(n: number): Buffer {
  return Buffer.from([n & 0xff]);
}
function pubkey(pk: PublicKey): Buffer {
  return Buffer.from(pk.toBytes());
}
function vecPubkey(keys: PublicKey[]): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(keys.length);
  return Buffer.concat([len, ...keys.map(pubkey)]);
}
function optionPubkey(pk?: PublicKey | null): Buffer {
  return pk ? Buffer.concat([u8(1), pubkey(pk)]) : u8(0);
}

// ---- PDAs -----------------------------------------------------------------

export function listingPda(asset: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('listing'), asset.toBytes()],
    PROGRAM_ID,
  );
}
export function swapPda(maker: PublicKey, nonce: bigint): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('swap'), maker.toBytes(), u64(nonce)],
    PROGRAM_ID,
  );
}
export function offerPda(bidder: PublicKey, nonce: bigint): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('offer'), bidder.toBytes(), u64(nonce)],
    PROGRAM_ID,
  );
}

export function collectionAddress(key: CollectionKey): PublicKey {
  return COLLECTIONS[key].address;
}

const META = {
  signer: (k: PublicKey) => ({ pubkey: k, isSigner: true, isWritable: true }),
  signerRO: (k: PublicKey) => ({ pubkey: k, isSigner: true, isWritable: false }),
  w: (k: PublicKey) => ({ pubkey: k, isSigner: false, isWritable: true }),
  ro: (k: PublicKey) => ({ pubkey: k, isSigner: false, isWritable: false }),
};

const CURRENCY_CODE: Record<Currency, number> = { sol: 0, gboy: 1 };

// ===================== LISTINGS =====================

export function buildListIx(params: {
  seller: PublicKey;
  asset: PublicKey;
  collection: CollectionKey;
  price: bigint;
  currency: Currency;
}): TransactionInstruction {
  const [listing] = listingPda(params.asset);
  const data = Buffer.concat([
    IX.list_asset,
    u64(params.price),
    u8(CURRENCY_CODE[params.currency]),
  ]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      META.signer(params.seller),
      META.w(listing),
      META.w(params.asset),
      // collection is writable: MPL Core marks it mut on AddPlugin/Freeze.
      META.w(collectionAddress(params.collection)),
      META.ro(MPL_CORE_PROGRAM_ID),
      META.ro(SystemProgram.programId),
    ],
    data,
  });
}

export function buildCancelListingIx(params: {
  seller: PublicKey;
  asset: PublicKey;
  collection: CollectionKey;
}): TransactionInstruction {
  const [listing] = listingPda(params.asset);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      META.signer(params.seller),
      META.w(listing),
      META.w(params.asset),
      // collection is writable: MPL Core marks it mut on plugin updates/removal.
      META.w(collectionAddress(params.collection)),
      META.ro(MPL_CORE_PROGRAM_ID),
      META.ro(SystemProgram.programId),
    ],
    data: IX.cancel_listing,
  });
}

export function buildPurchaseSolIx(params: {
  buyer: PublicKey;
  seller: PublicKey;
  asset: PublicKey;
  collection: CollectionKey;
  /** Slippage guard: the price the buyer agreed to (raw lamports). The tx
   *  reverts if the seller front-ran update_listing above this. */
  maxPrice: bigint;
}): TransactionInstruction {
  const [listing] = listingPda(params.asset);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      META.signer(params.buyer),
      META.w(params.seller),
      META.w(listing),
      META.w(params.asset),
      // collection is writable: MPL Core marks it mut on plugin thaw/removal.
      META.w(collectionAddress(params.collection)),
      META.w(COLLECTIONS[params.collection].creator),
      META.ro(MPL_CORE_PROGRAM_ID),
      META.ro(SystemProgram.programId),
    ],
    data: Buffer.concat([IX.purchase_with_sol, u64(params.maxPrice)]),
  });
}

export function buildPurchaseGboyIx(params: {
  buyer: PublicKey;
  seller: PublicKey;
  asset: PublicKey;
  collection: CollectionKey;
  /** Slippage guard: the price the buyer agreed to (raw $GBOY units). */
  maxPrice: bigint;
}): TransactionInstruction {
  const [listing] = listingPda(params.asset);
  const buyerGboy = getAssociatedTokenAddressSync(GBOY_MINT, params.buyer);
  const sellerGboy = getAssociatedTokenAddressSync(GBOY_MINT, params.seller);
  const creator = COLLECTIONS[params.collection].creator;
  const creatorGboy = getAssociatedTokenAddressSync(GBOY_MINT, creator, true);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      META.signer(params.buyer),
      META.w(params.seller),
      META.w(listing),
      META.ro(GBOY_MINT),
      META.w(buyerGboy),
      META.w(sellerGboy),
      META.w(creator),
      META.w(creatorGboy),
      META.w(params.asset),
      // collection is writable: MPL Core marks it mut on plugin thaw/removal.
      META.w(collectionAddress(params.collection)),
      META.ro(MPL_CORE_PROGRAM_ID),
      META.ro(TOKEN_PROGRAM_ID),
      META.ro(SystemProgram.programId),
    ],
    data: Buffer.concat([IX.purchase_with_gboy, u64(params.maxPrice)]),
  });
}

// ===================== SWAPS =====================

export interface SwapAssetRef {
  asset: PublicKey;
  collection: CollectionKey;
}

/** Build a create_swap instruction. `offered` assets are escrowed; `requested`
 *  assets must be delivered by the taker on accept. */
export function buildCreateSwapIx(params: {
  maker: PublicKey;
  nonce: bigint;
  offered: SwapAssetRef[];
  requested: SwapAssetRef[];
  solOffered: bigint;
  gboyOffered: bigint;
  solRequested: bigint;
  gboyRequested: bigint;
  taker?: PublicKey | null;
}): TransactionInstruction {
  const [swap] = swapPda(params.maker, params.nonce);
  const usesGboy = params.gboyOffered > 0n;
  const makerGboy = usesGboy
    ? getAssociatedTokenAddressSync(GBOY_MINT, params.maker)
    : PROGRAM_ID;
  const swapGboy = usesGboy
    ? getAssociatedTokenAddressSync(GBOY_MINT, swap, true)
    : PROGRAM_ID;

  const data = Buffer.concat([
    IX.create_swap,
    u64(params.nonce),
    u8(params.offered.length),
    vecPubkey(params.requested.map((r) => r.asset)),
    u64(params.solOffered),
    u64(params.gboyOffered),
    u64(params.solRequested),
    u64(params.gboyRequested),
    optionPubkey(params.taker ?? null),
  ]);

  const keys = [
    META.signer(params.maker),
    META.w(swap),
    usesGboy ? META.w(makerGboy) : META.ro(makerGboy),
    usesGboy ? META.w(swapGboy) : META.ro(swapGboy),
    META.ro(MPL_CORE_PROGRAM_ID),
    META.ro(TOKEN_PROGRAM_ID),
    META.ro(ASSOCIATED_TOKEN_PROGRAM_ID),
    META.ro(SystemProgram.programId),
  ];
  // remaining: [asset(w), collection(ro)] per offered asset
  for (const o of params.offered) {
    keys.push(META.w(o.asset), META.ro(collectionAddress(o.collection)));
  }
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data });
}

export function buildAcceptSwapIx(params: {
  taker: PublicKey;
  maker: PublicKey;
  nonce: bigint;
  requested: SwapAssetRef[];
  offered: SwapAssetRef[];
  /** Maker escrowed $GBOY (taker receives it; the escrow ATA exists). */
  gboyOffered: boolean;
  /** Taker pays $GBOY to the maker. */
  gboyRequested: boolean;
}): TransactionInstruction {
  const [swap] = swapPda(params.maker, params.nonce);
  // Pass each optional $GBOY account ONLY when the program actually touches it,
  // else None (= program-id sentinel). Critically, swap_gboy (the escrow ATA) is
  // created only when $GBOY was OFFERED — passing it for a requested-only swap
  // references an uninitialized account → AccountNotInitialized.
  const needTaker = params.gboyOffered || params.gboyRequested; // taker receives and/or pays
  const needMaker = params.gboyRequested; // maker receives the taker's payment
  const needSwap = params.gboyOffered; // escrow is the source of offered $GBOY
  const takerGboy = needTaker ? getAssociatedTokenAddressSync(GBOY_MINT, params.taker) : PROGRAM_ID;
  const makerGboy = needMaker ? getAssociatedTokenAddressSync(GBOY_MINT, params.maker) : PROGRAM_ID;
  const swapGboy = needSwap ? getAssociatedTokenAddressSync(GBOY_MINT, swap, true) : PROGRAM_ID;

  const keys = [
    META.signer(params.taker),
    META.w(params.maker),
    META.w(swap),
    needTaker ? META.w(takerGboy) : META.ro(takerGboy),
    needMaker ? META.w(makerGboy) : META.ro(makerGboy),
    needSwap ? META.w(swapGboy) : META.ro(swapGboy),
    META.ro(MPL_CORE_PROGRAM_ID),
    META.ro(TOKEN_PROGRAM_ID),
    META.ro(SystemProgram.programId),
  ];
  // remaining: requested pairs (taker -> maker), then offered pairs (escrow -> taker)
  for (const r of params.requested) {
    keys.push(META.w(r.asset), META.ro(collectionAddress(r.collection)));
  }
  for (const o of params.offered) {
    keys.push(META.w(o.asset), META.ro(collectionAddress(o.collection)));
  }
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data: IX.accept_swap });
}

export function buildCancelSwapIx(params: {
  maker: PublicKey;
  nonce: bigint;
  offered: SwapAssetRef[];
  usesGboy: boolean;
}): TransactionInstruction {
  const [swap] = swapPda(params.maker, params.nonce);
  const makerGboy = params.usesGboy
    ? getAssociatedTokenAddressSync(GBOY_MINT, params.maker)
    : PROGRAM_ID;
  const swapGboy = params.usesGboy
    ? getAssociatedTokenAddressSync(GBOY_MINT, swap, true)
    : PROGRAM_ID;
  const keys = [
    META.signer(params.maker),
    META.w(swap),
    params.usesGboy ? META.w(makerGboy) : META.ro(makerGboy),
    params.usesGboy ? META.w(swapGboy) : META.ro(swapGboy),
    META.ro(MPL_CORE_PROGRAM_ID),
    META.ro(TOKEN_PROGRAM_ID),
    META.ro(SystemProgram.programId),
  ];
  for (const o of params.offered) {
    keys.push(META.w(o.asset), META.ro(collectionAddress(o.collection)));
  }
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data: IX.cancel_swap });
}

// ===================== OFFERS / BIDS =====================

/** Create an offer escrowing SOL or $GBOY on a specific asset (or a whole
 *  collection floor bid when `asset` is omitted). */
export function buildCreateOfferIx(params: {
  bidder: PublicKey;
  nonce: bigint;
  collection: CollectionKey;
  asset?: PublicKey | null;
  amount: bigint;
  currency: Currency;
}): TransactionInstruction {
  const [offer] = offerPda(params.bidder, params.nonce);
  const usesGboy = params.currency === 'gboy';
  const bidderGboy = usesGboy ? getAssociatedTokenAddressSync(GBOY_MINT, params.bidder) : PROGRAM_ID;
  const offerGboy = usesGboy ? getAssociatedTokenAddressSync(GBOY_MINT, offer, true) : PROGRAM_ID;

  const data = Buffer.concat([
    IX.create_offer,
    u64(params.nonce),
    pubkey(collectionAddress(params.collection)),
    optionPubkey(params.asset ?? null),
    u64(params.amount),
    u8(CURRENCY_CODE[params.currency]),
  ]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      META.signer(params.bidder),
      META.w(offer),
      usesGboy ? META.w(bidderGboy) : META.ro(bidderGboy),
      usesGboy ? META.w(offerGboy) : META.ro(offerGboy),
      META.ro(TOKEN_PROGRAM_ID),
      META.ro(ASSOCIATED_TOKEN_PROGRAM_ID),
      META.ro(SystemProgram.programId),
    ],
    data,
  });
}

export function buildCancelOfferIx(params: {
  bidder: PublicKey;
  nonce: bigint;
  currency: Currency;
}): TransactionInstruction {
  const [offer] = offerPda(params.bidder, params.nonce);
  const usesGboy = params.currency === 'gboy';
  const bidderGboy = usesGboy ? getAssociatedTokenAddressSync(GBOY_MINT, params.bidder) : PROGRAM_ID;
  const offerGboy = usesGboy ? getAssociatedTokenAddressSync(GBOY_MINT, offer, true) : PROGRAM_ID;
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      META.signer(params.bidder),
      META.w(offer),
      usesGboy ? META.w(bidderGboy) : META.ro(bidderGboy),
      usesGboy ? META.w(offerGboy) : META.ro(offerGboy),
      META.ro(TOKEN_PROGRAM_ID),
      META.ro(SystemProgram.programId),
    ],
    data: IX.cancel_offer,
  });
}

export function buildAcceptOfferIx(params: {
  seller: PublicKey;
  bidder: PublicKey;
  nonce: bigint;
  asset: PublicKey;
  collection: CollectionKey;
  currency: Currency;
}): TransactionInstruction {
  const [offer] = offerPda(params.bidder, params.nonce);
  const usesGboy = params.currency === 'gboy';
  const offerGboy = usesGboy ? getAssociatedTokenAddressSync(GBOY_MINT, offer, true) : PROGRAM_ID;
  const sellerGboy = usesGboy ? getAssociatedTokenAddressSync(GBOY_MINT, params.seller) : PROGRAM_ID;
  const creator = COLLECTIONS[params.collection].creator;
  const creatorGboy = usesGboy ? getAssociatedTokenAddressSync(GBOY_MINT, creator, true) : PROGRAM_ID;
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      META.signer(params.seller),
      META.w(params.bidder),
      META.w(offer),
      META.w(params.asset),
      META.ro(collectionAddress(params.collection)),
      META.w(creator),
      usesGboy ? META.w(offerGboy) : META.ro(offerGboy),
      usesGboy ? META.w(sellerGboy) : META.ro(sellerGboy),
      usesGboy ? META.w(creatorGboy) : META.ro(creatorGboy),
      META.ro(MPL_CORE_PROGRAM_ID),
      META.ro(TOKEN_PROGRAM_ID),
      META.ro(SystemProgram.programId),
    ],
    data: IX.accept_offer,
  });
}
