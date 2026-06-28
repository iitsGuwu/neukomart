import type { CollectionKey } from './constants';

export type Currency = 'sol' | 'gboy';

export interface Attribute {
  trait_type: string;
  value: string;
}

/** A normalized ecosystem NFT (Badge or Harmie). */
export interface NeukoAsset {
  id: string; // asset address (base58)
  name: string;
  collection: CollectionKey;
  image: string; // url or data-uri
  number?: number;
  owner?: string;
  attributes: Attribute[];
  /** procedurally-rendered art (true) vs real fetched image (false). */
  generative?: boolean;
  /** MPL Core frozen flag (DAS). Frozen ⇒ already listed/delegated somewhere
   *  (NEUKO, Magic Eden or Tensor) — it can't be re-listed until delisted. */
  frozen?: boolean;
}

/** Where a listing originates. */
export type MarketOrigin = 'magiceden' | 'tensor' | 'neukomart';

export interface Listing {
  id: string; // PDA or synthetic id
  asset: NeukoAsset;
  seller: string;
  price: number; // UI amount
  currency: Currency;
  createdAt: number; // unix seconds
  /** marketplace the listing comes from. */
  origin?: MarketOrigin;
}

export interface SwapSide {
  assets: NeukoAsset[];
  sol: number;
  gboy: number;
}

export type SwapStatus = 'open' | 'accepted' | 'cancelled';

export interface SwapOffer {
  id: string;
  maker: string;
  taker?: string; // gated counterparty, if any
  give: SwapSide; // what the maker escrows
  want: SwapSide; // what the maker requests
  createdAt: number;
  status: SwapStatus;
  /** id of the offer this one counters, if any. */
  counteredFrom?: string;
}

export type OfferStatus = 'open' | 'accepted' | 'cancelled';

export interface Offer {
  id: string;
  bidder: string;
  collection: CollectionKey;
  /** specific asset id; undefined = collection floor bid. */
  asset?: string;
  assetName?: string;
  image?: string;
  amount: number;
  currency: Currency;
  createdAt: number;
  status: OfferStatus;
}

export type ActivityKind = 'list' | 'sale' | 'swap' | 'offer';

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  asset?: NeukoAsset;
  price?: number;
  currency?: Currency;
  from?: string;
  to?: string;
  time: number;
}
