# NEUKO Market — the native G\*BOY marketplace

A **feeless, ecosystem-locked** NFT marketplace for the NEUKO / G\*BOY ecosystem on
Solana. Buy, sell and **barter** the two collections (Badges & Harmies) with **SOL** or
the native **$GBOY** SPL token. The protocol takes **zero fees** — users pay only Solana
gas.

```
neuko market/
├── app/                # Vite + React + TypeScript frontend  (localhost:5173)
├── program/            # Anchor (Rust) on-chain marketplace program
└── README.md
```

---

## Ecosystem registry (verified on mainnet-beta)

| Asset    | Standard            | Address |
|----------|---------------------|---------|
| Badges   | Metaplex **Core** Collection ("G\*BOY Badges", 1,500) | `EEahNmYDk2KW8GJ34cnS6KqBS3B4QdezCCSenUQGpPL8` |
| Harmies  | Metaplex **Core** Collection ("Harmies", 500)         | `5yKCYuZCcJU3aXwppGK87Gi59T6ceNKrTzyXYvJfsp3q` |
| $GBOY    | SPL Token (10 decimals)                                | `svy5ErijNYy9hEVzxknCdwWdZ3NeXJTdpb9Ndnso17f` |

> All three addresses are verified on mainnet-beta and are compiled into the
> on-chain program as an immutable allow-list — the marketplace will only ever
> touch these collections and this token.

These three are the **only** assets the program or UI will ever touch. Any foreign
collection or token is rejected by design — both in the smart contract and the client.

---

## On-chain program (`program/`)

Anchor 0.32 program (`neuko_market`) implementing:

**Listings (escrowless)**
- `list_asset` — delegate freeze + transfer authority to the listing PDA and freeze
  the asset, so **it stays in the seller's wallet** (still visible) until sold
- `update_listing` — change price / currency
- `cancel_listing` — thaw + release the delegates back to the seller
- `purchase_with_sol` / `purchase_with_gboy` — atomic buy, **seller receives 100%**

**Offers / bids**
- `create_offer` — escrow SOL or $GBOY as a standing bid on a specific asset, or on
  a whole collection (floor bid)
- `cancel_offer` — reclaim the escrow
- `accept_offer` — any matching asset owner delivers the asset and is paid from escrow

**Barter / swaps** (the headline feature)
- `create_swap` — escrow N assets + optional SOL/$GBOY, request a set of assets +
  optional SOL/$GBOY. Supports NFT↔NFT, many↔one and mixed top-ups on either side.
  Optionally lock the offer to a specific counterparty.
- `accept_swap` — atomic exchange
- `cancel_swap` — maker reclaims everything

**Design guarantees**
- **Feeless:** no treasury, no fee skim. The only costs are network gas and reclaimable
  account rent.
- **Ecosystem-locked:** every instruction decodes the touched Core asset and rejects
  anything not in the Badges/Harmies collections; token legs must use $GBOY.
- **Non-custodial:** assets sit in per-listing / per-swap PDA escrows that only release
  on a valid buy/accept/cancel.

The program calls MPL Core `TransferV1` directly (no `mpl-core` crate dependency) so it
stays pinned to Anchor's Solana SDK version.

Program ID: `Foz4ZtLQKKdSk4V1d6cDp6Gr3gActoQGUhh5B4YTafA2`

### Build & deploy

```bash
cd program
anchor build                    # produces target/deploy/neuko_market.so (~362 KB)

# Devnet (free — airdrop test SOL):
solana airdrop 5 --url devnet
anchor deploy --provider.cluster devnet

# Mainnet (real cost — see below):
anchor deploy --provider.cluster mainnet
```

---

## Frontend (`app/`)

Vite + React + TypeScript + Tailwind, `@solana/wallet-adapter`, framer-motion.

```bash
cd app
npm install
cp .env.example .env      # optional — configure RPC
npm run dev               # http://localhost:5173
```

**Features**
- Browse both real collections with full filtering: collection, listing status,
  currency, price range, and per-collection traits — including **background-color
  swatches** for Harmies and Emblem/Rank for Badges. Paginated grid.
- Swap Studio: build multi-asset barter offers and **counter** any open offer
  (pre-fills the inverse terms to negotiate).
- **Offers / bids**: make an offer on any item or a collection floor bid; manage
  incoming/outgoing offers from the Portfolio and accept/withdraw.
- **Escrowless listings**: listed NFTs stay in your wallet (frozen) until sold.
- **Sweep cart**: add multiple listings and buy them in one go (chunked across
  transactions when needed).
- **Light & dark themes**, **PWA** (installable), **shareable links** with dynamic
  OG images.
- Portfolio (real holdings), Activity feed, per-asset detail with traits & offers.

**Transaction pipeline** (`lib/tx.ts`)
- Versioned (v0) transactions with **Address Lookup Tables** so large multi-asset
  swaps fit under the size limit, **dynamic priority fees** (median of recent
  blocks, clamped), and a **pre-flight simulation** that sizes the compute-unit
  limit and **aborts doomed transactions before the user pays a failed-tx fee**.

**Live indexer** (`app/api/*`, Vercel serverless)
- A Helius webhook posts confirmed transactions to `/api/webhook`, which decodes
  the program's Anchor events and upserts listings/offers/activity into Upstash
  Redis. `/api/market` serves them; the UI joins them with DAS metadata. Falls
  back to the demo layer until configured.

**Data sources**
- Configured with a **DAS-enabled Helius RPC** (`VITE_RPC_URL`), so the UI is driven
  by **real on-chain data**: every Badge & Harmie (id, art, traits) and the connected
  wallet's real holdings & balances.
- Because the marketplace program isn't deployed yet, listings & swap offers are a
  thin simulated layer built **on top of the real NFTs** (clearly labelled, stored
  locally). Once the contract is live, real on-chain listings replace them with no
  UI changes.
- On a non-DAS RPC the app falls back to a small bundled set so it still renders.

### Deploying to Vercel

1. **Import the repo** in Vercel and set the **Root Directory to `app/`** (framework
   preset: Vite). `vercel.json` handles SPA routing and the `/api` functions.
2. **Environment variables** (see `.env.example`):
   - `VITE_RPC_URL` — your DAS RPC (Helius). Domain-lock the key.
   - For the indexer: add the **Upstash** integration (sets `KV_REST_API_URL` /
     `KV_REST_API_TOKEN`), then create a **Helius webhook** → URL `/api/webhook`,
     program address = the marketplace program id, and set `HELIUS_WEBHOOK_SECRET`.
   - Optional: `VITE_LOOKUP_TABLE` after creating the swap lookup table in-app.
3. `npm run build` is run automatically; the PWA service worker is generated at
   build time.

---

## Costs (summary)

| Item | Cost |
|------|------|
| Deploy contract to **mainnet** | **~3.53 SOL** one-time (program-data rent, reclaimable) + ~0.01 SOL tx fees |
| Deploy with 1.5× upgrade headroom | ~5.30 SOL |
| Deploy to **devnet** | Free (airdropped SOL) |
| Marketplace fee | **0** — always |
| Per user action | ~0.000005 SOL gas + reclaimable PDA rent (~0.0015 SOL) |
| Frontend hosting | Free tier (Vercel/Netlify) |

Rent is recoverable: closing the program returns the program-data rent; closing a
listing/swap returns its PDA rent to the user who opened it.
