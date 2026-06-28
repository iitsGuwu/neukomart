# NEUKO Market — Mainnet manual test checklist

Walk these with a funded wallet on the live site. The frontend signing paths
can't be tested headlessly, so this is the real validation. Tests are tagged:

- 🟢 **read-only** — no cost, no asset movement.
- 🟡 **costs gas** — a small SOL fee + reclaimable rent (~0.01–0.02 SOL).
- 🔴 **moves value** — actually spends SOL/$GBOY or transfers an NFT. Use a
  second wallet you control, or be willing to really trade.

For every failure, note: the **exact** toast/error text, which action, the
asset id, and **whether the wallet popup appeared** (no popup = it failed in
pre-flight simulation, before signing).

---

## 0. Prep
- [ ] Wallet (Phantom/Solflare) with **≥ 0.1 SOL**, some **$GBOY**, and **≥ 3 ecosystem NFTs**.
- [ ] Helpful to have one NFT **already listed on Magic Eden or Tensor**, and at least one **unlisted**.
- [ ] A **second wallet** for buy/accept/swap tests (so you're not trading with yourself).

## 1. Connect & holdings — 🟢
- [ ] Connect → header button shows your address (not "Select Wallet").
- [ ] Portfolio shows correct $GBOY balance + Badges/Harmies counts.
- [ ] "Items" grid shows your real NFTs (real images, real names).

## 2. Listing — 🟡
- [ ] **List an UNLISTED asset for SOL** → wallet popup → confirm → "Listed!" → appears under *Your active listings* and in the Market grid with a Buy button.
- [ ] **List for $GBOY** → same, price shown in $GBOY.
- [ ] In the grid, an asset **already listed on Magic Eden/Tensor** shows **"Delist on ME/Tensor"** (if we can see the listing) or a neutral **"Locked"** chip — **never a plain "List" button**.
- [ ] Trying to list a **frozen / already-listed** asset gives a clear "already listed elsewhere" message — **not** a raw `0xf` error. *(regression: the 0xf bug)*

## 3. Delisting — 🟡 *(the bug you reported — test carefully)*
- [ ] **Delist a NEUKO listing you just made** → wallet popup → "Listing cancelled!" → removed from grid.
  - ❗ It must **actually open the wallet and cancel on-chain**. If it instead says *"That listing was already removed on-chain"* **without** a wallet popup for a listing you know is live, that's the bug returning — report it.
- [ ] After delisting, the asset is **unfrozen** (you can re-list it, or list it on ME).
- [ ] **Delist an ME/Tensor listing** from Portfolio → opens that marketplace in a new tab; the listing card shows the origin badge.

## 4. Buying — 🔴
- [ ] **Buy a NEUKO SOL listing** (second wallet) → seller receives **95%**, creator receives **5%** royalty. Verify both balances moved.
- [ ] **Buy a NEUKO $GBOY listing** → same 95/5 split in $GBOY; creator ATA created if needed.
- [ ] **Buy an ME/Tensor listing** → opens that marketplace (redirect), does not attempt a NEUKO tx.
- [ ] **Sweep cart**: add several NEUKO listings → Buy all → completes in 1 tx (or chunks of 5) and all clear from the grid.

## 5. Offers — 🟡/🔴
- [ ] **Make a collection floor offer (SOL)** → "Offer created!" → shows under *Offers you've made*. 🔴 escrows SOL.
- [ ] **Make a specific-asset offer ($GBOY)** → escrow ATA funded.
- [ ] **Withdraw an offer** → "Offer withdrawn!" → escrow refunded. *(tests the retried account read — should never wrongly say "Offer account not found")*
- [ ] **Accept an offer** on an asset you hold (second wallet makes the offer) → asset transfers to bidder, you receive 95%, creator 5%.

## 6. Swaps — 🔴
- [ ] **Create a swap**: give 1 asset, want 1 asset → "assets escrowed" → appears under *My offers*. Confirm the given asset is now frozen/escrowed.
- [ ] **Create a swap with a $GBOY top-up** (give or want side) → escrow ATA funded.
- [ ] **Accept an open swap** (second wallet) → assets exchange both ways; any SOL/$GBOY top-up settles.
- [ ] **Cancel your own swap** → escrowed assets/$GBOY returned to you.
- [ ] **Swap locked to a specific taker** → only that taker can accept; others see "locked to a specific counterparty."

## 7. Live data & refresh (upgrade #3) — 🟢
- [ ] After listing/delisting, switch to another browser tab and back → the grid **refreshes on focus**; your change persists (the grid is **not** blanked).
- [ ] Leave the Market tab open ~1 min → it refreshes on its own (60s poll); listings don't disappear.
- [ ] **Activity → Analytics** → if real sales exist, the disclaimer reads *"Built from real sales…"* and the volume bar reflects actual sale amounts (not a smooth random curve).

## 8. Error handling — 🟢/🟡
- [ ] Action from a **0-SOL wallet** → clear *"Not enough funds — your wallet has no SOL…"* (no cryptic popup, no wallet prompt).
- [ ] **Buy priced above your balance** → clear "Not enough funds — add more SOL…".
- [ ] Any program rejection surfaces a **readable** reason (e.g. "You are not the seller of this listing", "The price exceeds the maximum you agreed to pay") — never a raw JSON dump.

---

### Priority smoke test (if short on time)
1. List for SOL (§2) → 2. **Delist it** (§3) → 3. Make + withdraw an offer (§5) →
4. Create + cancel a swap (§6). These four cover the recently-changed paths and
the bug you hit.
