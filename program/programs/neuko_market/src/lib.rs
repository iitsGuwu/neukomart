//! NEUKO Market — an ecosystem-locked marketplace program for the
//! G*BOY (NEUKO) ecosystem.
//!
//! Scope is locked to exactly three on-chain assets:
//!   * Badges  collection (Metaplex Core)
//!   * Harmies collection (Metaplex Core)
//!   * $GBOY   SPL token
//!
//! The program takes zero marketplace fees. A 5% creator royalty is enforced
//! on every sale (fixed-price purchases and offer acceptances), honouring the
//! on-chain royalty plugins set by the collection creators. Barter swaps are
//! royalty-free. The only other costs are network gas and (reclaimable) rent.
//!
//! Features
//!   * Fixed-price listings priced in SOL or $GBOY
//!   * Direct, atomic barter swaps:
//!       - NFT(s)  <->  NFT(s)
//!       - NFT(s) + SOL/$GBOY  <->  NFT(s) + SOL/$GBOY  (top-ups either side)
//!
//! Every instruction validates that touched assets belong to one of the two
//! allow-listed collections and that any token leg uses $GBOY. Anything else
//! is rejected.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_lang::solana_program::pubkey;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer as SplTransfer};
use mpl_core::instructions::{
    AddPluginV1CpiBuilder, RemovePluginV1CpiBuilder, UpdatePluginV1CpiBuilder,
};
use mpl_core::types::{FreezeDelegate, Plugin, PluginAuthority, PluginType, TransferDelegate};

declare_id!("Foz4ZtLQKKdSk4V1d6cDp6Gr3gActoQGUhh5B4YTafA2");

// ---------------------------------------------------------------------------
// Ecosystem registry — the ONLY assets this market will ever touch.
//
// The default build hard-codes the verified MAINNET addresses (this is the
// audited configuration). Building with `--features devnet` swaps in the
// throwaway devnet collections/mint created by `scripts/setup-devnet.ts`, so the
// program can be exercised end-to-end on devnet without ever loosening the
// mainnet allow-list. The two sets are mutually exclusive at compile time.
// ---------------------------------------------------------------------------
#[cfg(not(feature = "devnet"))]
pub const BADGES_COLLECTION: Pubkey = pubkey!("EEahNmYDk2KW8GJ34cnS6KqBS3B4QdezCCSenUQGpPL8");
#[cfg(not(feature = "devnet"))]
pub const HARMIES_COLLECTION: Pubkey = pubkey!("5yKCYuZCcJU3aXwppGK87Gi59T6ceNKrTzyXYvJfsp3q");
#[cfg(not(feature = "devnet"))]
pub const GBOY_MINT: Pubkey = pubkey!("svy5ErijNYy9hEVzxknCdwWdZ3NeXJTdpb9Ndnso17f");

#[cfg(feature = "devnet")]
pub const BADGES_COLLECTION: Pubkey = pubkey!("7BT68wwawSB123AbPHbdrDbSKLKUEnYxLY4rsmMW1YGE");
#[cfg(feature = "devnet")]
pub const HARMIES_COLLECTION: Pubkey = pubkey!("CR2uSgUPMvAwV59doVwMxXd6Ahc2XxDmnjsHJsJK7i5N");
#[cfg(feature = "devnet")]
pub const GBOY_MINT: Pubkey = pubkey!("7xrbFbfQ9T7h3hR5HtP9eAuHJ3zo1KWbmmaXgW964VNs");

// ---------------------------------------------------------------------------
// Creator royalty registry — verified on-chain via each collection's Royalty
// plugin. Both collections configure 500 bps (5%) with a single creator.
// ---------------------------------------------------------------------------
pub const BADGES_CREATOR: Pubkey = pubkey!("DQ1LJZ2ET1oHcCgojCN3kXakTQSkuCxgEqXguf2UrYS5");
pub const HARMIES_CREATOR: Pubkey = pubkey!("57MFtfGrJheHeRzeSpARcUEBqa9jXELGGZrRszysf4VB");

/// Creator royalty in basis points (500 = 5%).
pub const ROYALTY_BPS: u64 = 500;

/// Metaplex Core program — the only NFT standard this market touches.
pub const MPL_CORE_PROGRAM: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

/// MPL Core `TransferV1` instruction discriminator (single byte).
const CORE_TRANSFER_V1_DISCRIMINATOR: u8 = 14;

/// Account-layout cap: the on-chain Vecs are sized for this many assets per side.
/// Kept at 8 for storage-layout stability across upgrades.
pub const MAX_SWAP_ASSETS: usize = 8;

/// Trade-policy cap: the maximum number of NFTs allowed on EACH side of a swap
/// (offered, and requested exact + group slots combined). SOL / $GBOY top-ups are
/// uncapped. This is stricter than the account-layout cap and is the limit the
/// program actually enforces on new swaps.
pub const MAX_TRADE_NFTS_PER_SIDE: usize = 5;

/// Max Merkle proof depth accepted per trait-group slot. A proof of depth `d`
/// covers a tree of up to `2^d` leaves, so 24 spans 16M+ assets — far beyond any
/// real collection — while bounding the per-slot hashing work an accept can
/// request (defense-in-depth against a self-inflicted compute blow-up).
pub const MAX_PROOF_DEPTH: usize = 24;

#[program]
pub mod neuko_market {
    use super::*;

    // ===================== LISTINGS (escrowless) =====================
    //
    // Listings never move the asset into a vault. Instead the seller delegates
    // freeze + transfer authority to the listing PDA and freezes the asset, so
    // it stays in the seller's wallet (still visible) until sold or delisted.

    /// List an owned Core asset for a fixed price in SOL or $GBOY.
    pub fn list_asset(ctx: Context<ListAsset>, price: u64, currency: Currency) -> Result<()> {
        require!(price > 0, MarketError::ZeroPrice);

        let collection = ctx.accounts.collection.key();
        assert_allowed_collection(&collection)?;
        assert_asset_owned_by(
            &ctx.accounts.asset.to_account_info(),
            &collection,
            &ctx.accounts.seller.key(),
        )?;

        // Delegate freeze + transfer authority to the listing PDA and freeze.
        let delegate = ctx.accounts.listing.key();
        add_delegates_and_freeze(
            &ctx.accounts.mpl_core_program.to_account_info(),
            &ctx.accounts.asset.to_account_info(),
            &ctx.accounts.collection.to_account_info(),
            &ctx.accounts.seller.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            delegate,
        )?;

        let listing = &mut ctx.accounts.listing;
        listing.seller = ctx.accounts.seller.key();
        listing.asset = ctx.accounts.asset.key();
        listing.collection = collection;
        listing.price = price;
        listing.currency = currency;
        listing.created_at = Clock::get()?.unix_timestamp;
        listing.bump = ctx.bumps.listing;

        emit!(Listed {
            asset: listing.asset,
            seller: listing.seller,
            price,
            currency,
        });
        Ok(())
    }

    /// Change the price / currency of an existing listing.
    pub fn update_listing(
        ctx: Context<UpdateListing>,
        new_price: u64,
        new_currency: Currency,
    ) -> Result<()> {
        require!(new_price > 0, MarketError::ZeroPrice);
        let listing = &mut ctx.accounts.listing;
        listing.price = new_price;
        listing.currency = new_currency;

        // Emit so the indexer can keep the cached price/currency in sync. Without
        // this a re-price is invisible to event consumers (the on-chain Listing
        // PDA is authoritative, but the Redis cache would otherwise go stale).
        emit!(ListingUpdated {
            asset: listing.asset,
            seller: listing.seller,
            price: new_price,
            currency: new_currency,
        });
        Ok(())
    }

    /// Delist: thaw the asset and release the marketplace delegates back to the
    /// seller (who has held it the whole time).
    pub fn cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
        let asset_key = ctx.accounts.asset.key();
        let bump = ctx.accounts.listing.bump;
        let seeds: &[&[u8]] = &[b"listing", asset_key.as_ref(), &[bump]];

        thaw_and_release(
            &ctx.accounts.mpl_core_program.to_account_info(),
            &ctx.accounts.asset.to_account_info(),
            &ctx.accounts.collection.to_account_info(),
            &ctx.accounts.listing.to_account_info(),
            &ctx.accounts.seller.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            &[seeds],
        )?;
        Ok(())
    }

    /// Buy a SOL-priced listing. 5% creator royalty is deducted and sent to
    /// the collection creator; the seller receives the remaining 95%.
    ///
    /// `max_price` is the buyer's slippage guard: the price the buyer agreed to
    /// when signing. If the seller front-runs with `update_listing` to raise the
    /// price above this, the purchase reverts instead of silently overcharging.
    pub fn purchase_with_sol(ctx: Context<PurchaseWithSol>, max_price: u64) -> Result<()> {
        let listing = &ctx.accounts.listing;
        require!(listing.currency == Currency::Sol, MarketError::WrongCurrency);
        require!(listing.price <= max_price, MarketError::PriceExceedsMax);

        // Validate the creator account matches the collection.
        let expected_creator = creator_for_collection(&listing.collection)?;
        require_keys_eq!(ctx.accounts.creator.key(), expected_creator, MarketError::InvalidCreator);

        let royalty = compute_royalty(listing.price);
        let seller_amount = listing.price.checked_sub(royalty).unwrap();

        // Pay creator royalty.
        if royalty > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.buyer.to_account_info(),
                        to: ctx.accounts.creator.to_account_info(),
                    },
                ),
                royalty,
            )?;
        }

        // Pay seller (price minus royalty).
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.seller.to_account_info(),
                },
            ),
            seller_amount,
        )?;

        settle_listing_to_buyer(
            &ctx.accounts.mpl_core_program.to_account_info(),
            &ctx.accounts.asset.to_account_info(),
            &ctx.accounts.collection.to_account_info(),
            &ctx.accounts.listing.to_account_info(),
            &ctx.accounts.buyer.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            ctx.accounts.asset.key(),
            listing.bump,
        )?;

        emit!(Sold {
            asset: ctx.accounts.asset.key(),
            seller: ctx.accounts.seller.key(),
            buyer: ctx.accounts.buyer.key(),
            price: listing.price,
            currency: Currency::Sol,
        });
        Ok(())
    }

    /// Buy a $GBOY-priced listing. 5% creator royalty is deducted and sent to
    /// the collection creator's ATA; the seller receives the remaining 95%.
    ///
    /// `max_price` is the buyer's slippage guard (see `purchase_with_sol`).
    pub fn purchase_with_gboy(ctx: Context<PurchaseWithGboy>, max_price: u64) -> Result<()> {
        let listing = &ctx.accounts.listing;
        require!(listing.currency == Currency::Gboy, MarketError::WrongCurrency);
        require!(listing.price <= max_price, MarketError::PriceExceedsMax);

        // Validate the creator account matches the collection.
        let expected_creator = creator_for_collection(&listing.collection)?;
        require_keys_eq!(ctx.accounts.creator.key(), expected_creator, MarketError::InvalidCreator);

        let royalty = compute_royalty(listing.price);
        let seller_amount = listing.price.checked_sub(royalty).unwrap();

        // Pay creator royalty in $GBOY.
        if royalty > 0 {
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    SplTransfer {
                        from: ctx.accounts.buyer_gboy.to_account_info(),
                        to: ctx.accounts.creator_gboy.to_account_info(),
                        authority: ctx.accounts.buyer.to_account_info(),
                    },
                ),
                royalty,
            )?;
        }

        // Pay seller (price minus royalty) in $GBOY.
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                SplTransfer {
                    from: ctx.accounts.buyer_gboy.to_account_info(),
                    to: ctx.accounts.seller_gboy.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            seller_amount,
        )?;

        settle_listing_to_buyer(
            &ctx.accounts.mpl_core_program.to_account_info(),
            &ctx.accounts.asset.to_account_info(),
            &ctx.accounts.collection.to_account_info(),
            &ctx.accounts.listing.to_account_info(),
            &ctx.accounts.buyer.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            ctx.accounts.asset.key(),
            listing.bump,
        )?;

        emit!(Sold {
            asset: ctx.accounts.asset.key(),
            seller: ctx.accounts.seller.key(),
            buyer: ctx.accounts.buyer.key(),
            price: listing.price,
            currency: Currency::Gboy,
        });
        Ok(())
    }

    // ===================== SWAPS / BARTER =====================

    /// Create a barter offer. The maker escrows `offered_count` assets (passed
    /// in `remaining_accounts` as [asset, collection] pairs) plus optional
    /// SOL / $GBOY top-ups, in exchange for a fixed set of requested assets
    /// (+ optional SOL / $GBOY) the taker must provide on accept.
    pub fn create_swap<'info>(
        ctx: Context<'_, '_, '_, 'info, CreateSwap<'info>>,
        nonce: u64,
        args: SwapArgs,
    ) -> Result<()> {
        // Trade-policy cap: at most 5 NFTs offered, and at most 5 requested
        // (exact + "any of type" group slots combined). Tokens are uncapped.
        require!(
            args.offered_count as usize <= MAX_TRADE_NFTS_PER_SIDE,
            MarketError::TooManyAssets
        );
        // The taker must deliver one asset per requested slot (exact + group), so
        // keep the requested total bounded too.
        require!(
            args.requested_assets.len() + args.requested_groups.len() <= MAX_TRADE_NFTS_PER_SIDE,
            MarketError::TooManyGroups
        );
        require!(
            args.offered_count as usize != 0
                || args.sol_offered > 0
                || args.gboy_offered > 0,
            MarketError::EmptyOffer
        );

        let rem = ctx.remaining_accounts;
        require!(
            rem.len() == args.offered_count as usize * 2,
            MarketError::AccountMismatch
        );

        let swap_key = ctx.accounts.swap_offer.key();
        let mut offered_assets: Vec<Pubkey> = Vec::with_capacity(args.offered_count as usize);

        // Escrow each offered asset: maker -> swap PDA.
        for i in 0..args.offered_count as usize {
            let asset_ai = &rem[i * 2];
            let coll_ai = &rem[i * 2 + 1];
            assert_allowed_collection(&coll_ai.key())?;
            assert_asset_owned_by(asset_ai, &coll_ai.key(), &ctx.accounts.maker.key())?;
            transfer_core(
                &ctx.accounts.mpl_core_program,
                asset_ai,
                coll_ai,
                &ctx.accounts.maker.to_account_info(),
                &ctx.accounts.swap_offer.to_account_info(),
                &ctx.accounts.maker.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                None,
            )?;
            offered_assets.push(asset_ai.key());
        }

        // Validate the request is non-empty (exact asset, trait group, SOL or $GBOY).
        require!(
            !args.requested_assets.is_empty()
                || !args.requested_groups.is_empty()
                || args.sol_requested > 0
                || args.gboy_requested > 0,
            MarketError::EmptyRequest
        );

        // Reject duplicate exact-requested assets up front: accept_swap dedups the
        // delivered set, so a swap requesting the same asset twice could never be
        // filled — fail fast instead of letting the maker strand rent in it. (n<=8.)
        for i in 0..args.requested_assets.len() {
            for j in (i + 1)..args.requested_assets.len() {
                require!(
                    args.requested_assets[i] != args.requested_assets[j],
                    MarketError::DuplicateSwapAsset
                );
            }
        }

        // SOL top-up: maker -> swap PDA.
        if args.sol_offered > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.maker.to_account_info(),
                        to: ctx.accounts.swap_offer.to_account_info(),
                    },
                ),
                args.sol_offered,
            )?;
        }

        // $GBOY top-up: maker ATA -> swap PDA ATA.
        if args.gboy_offered > 0 {
            let maker_ata = ctx
                .accounts
                .maker_gboy
                .as_ref()
                .ok_or(MarketError::MissingTokenAccount)?;
            let swap_ata = ctx
                .accounts
                .swap_gboy
                .as_ref()
                .ok_or(MarketError::MissingTokenAccount)?;
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    SplTransfer {
                        from: maker_ata.to_account_info(),
                        to: swap_ata.to_account_info(),
                        authority: ctx.accounts.maker.to_account_info(),
                    },
                ),
                args.gboy_offered,
            )?;
        }

        let swap = &mut ctx.accounts.swap_offer;
        swap.maker = ctx.accounts.maker.key();
        swap.taker = args.taker.unwrap_or_default();
        swap.offered_assets = offered_assets;
        swap.requested_assets = args.requested_assets;
        swap.requested_groups = args.requested_groups;
        swap.sol_offered = args.sol_offered;
        swap.gboy_offered = args.gboy_offered;
        swap.sol_requested = args.sol_requested;
        swap.gboy_requested = args.gboy_requested;
        swap.nonce = nonce;
        swap.created_at = Clock::get()?.unix_timestamp;
        swap.bump = ctx.bumps.swap_offer;

        emit!(SwapCreated {
            swap: swap_key,
            maker: swap.maker,
        });
        Ok(())
    }

    /// Accept a barter offer. Atomic: taker delivers the requested assets (+ any
    /// requested SOL/$GBOY) to the maker, and receives the escrowed assets (+
    /// any offered SOL/$GBOY).
    ///
    /// `remaining_accounts` layout:
    ///   [ requested_exact pairs ]   (taker -> maker; exact pubkey match)
    ///   [ requested_group pairs ]   (taker -> maker; any asset proving into the slot's root)
    ///   [ offered pairs ]           (escrow -> taker)
    ///
    /// `proofs[i]` is the Merkle proof for the asset delivered into group slot i.
    pub fn accept_swap<'info>(
        ctx: Context<'_, '_, '_, 'info, AcceptSwap<'info>>,
        proofs: Vec<Vec<[u8; 32]>>,
    ) -> Result<()> {
        let swap = &ctx.accounts.swap_offer;

        // Gated taker?
        if swap.taker != Pubkey::default() {
            require_keys_eq!(
                ctx.accounts.taker.key(),
                swap.taker,
                MarketError::NotDesignatedTaker
            );
        }

        let req_n = swap.requested_assets.len();
        let grp_n = swap.requested_groups.len();
        let off_n = swap.offered_assets.len();
        let rem = ctx.remaining_accounts;
        require!(rem.len() == (req_n + grp_n + off_n) * 2, MarketError::AccountMismatch);
        require!(proofs.len() == grp_n, MarketError::AccountMismatch);
        // Bound the hashing work each group slot can request.
        require!(
            proofs.iter().all(|p| p.len() <= MAX_PROOF_DEPTH),
            MarketError::ProofTooLong
        );

        // Track every asset the taker hands over so a single NFT can't be used to
        // fill more than one requested slot.
        let mut delivered: Vec<Pubkey> = Vec::with_capacity(req_n + grp_n);

        // 1) Taker delivers the exact requested assets -> maker.
        for i in 0..req_n {
            let asset_ai = &rem[i * 2];
            let coll_ai = &rem[i * 2 + 1];
            require_keys_eq!(asset_ai.key(), swap.requested_assets[i], MarketError::AssetMismatch);
            require!(!delivered.contains(&asset_ai.key()), MarketError::DuplicateSwapAsset);
            assert_allowed_collection(&coll_ai.key())?;
            assert_asset_owned_by(asset_ai, &coll_ai.key(), &ctx.accounts.taker.key())?;
            transfer_core(
                &ctx.accounts.mpl_core_program,
                asset_ai,
                coll_ai,
                &ctx.accounts.taker.to_account_info(),
                &ctx.accounts.maker.to_account_info(),
                &ctx.accounts.taker.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                None,
            )?;
            delivered.push(asset_ai.key());
        }

        // 1b) Taker fills each trait-group slot with any owned asset that proves
        //     into that slot's Merkle root -> maker. Membership in the root (built
        //     off-chain over e.g. every "Snake" badge) is what makes the slot
        //     fillable by ANY holder of that type.
        for i in 0..grp_n {
            let asset_ai = &rem[(req_n + i) * 2];
            let coll_ai = &rem[(req_n + i) * 2 + 1];
            require!(!delivered.contains(&asset_ai.key()), MarketError::DuplicateSwapAsset);
            assert_allowed_collection(&coll_ai.key())?;
            assert_asset_owned_by(asset_ai, &coll_ai.key(), &ctx.accounts.taker.key())?;
            require!(
                merkle_member(&asset_ai.key(), &proofs[i], &swap.requested_groups[i]),
                MarketError::InvalidMerkleProof
            );
            transfer_core(
                &ctx.accounts.mpl_core_program,
                asset_ai,
                coll_ai,
                &ctx.accounts.taker.to_account_info(),
                &ctx.accounts.maker.to_account_info(),
                &ctx.accounts.taker.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                None,
            )?;
            delivered.push(asset_ai.key());
        }

        // 2) Taker pays requested SOL / $GBOY -> maker.
        if swap.sol_requested > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.taker.to_account_info(),
                        to: ctx.accounts.maker.to_account_info(),
                    },
                ),
                swap.sol_requested,
            )?;
        }
        if swap.gboy_requested > 0 {
            let taker_ata = ctx.accounts.taker_gboy.as_ref().ok_or(MarketError::MissingTokenAccount)?;
            let maker_ata = ctx.accounts.maker_gboy.as_ref().ok_or(MarketError::MissingTokenAccount)?;
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    SplTransfer {
                        from: taker_ata.to_account_info(),
                        to: maker_ata.to_account_info(),
                        authority: ctx.accounts.taker.to_account_info(),
                    },
                ),
                swap.gboy_requested,
            )?;
        }

        // 3) Escrow delivers offered assets -> taker.
        let maker_key = swap.maker;
        let nonce_bytes = swap.nonce.to_le_bytes();
        let bump = swap.bump;
        let seeds: &[&[u8]] = &[b"swap", maker_key.as_ref(), nonce_bytes.as_ref(), &[bump]];
        for i in 0..off_n {
            let asset_ai = &rem[(req_n + grp_n + i) * 2];
            let coll_ai = &rem[(req_n + grp_n + i) * 2 + 1];
            require_keys_eq!(asset_ai.key(), swap.offered_assets[i], MarketError::AssetMismatch);
            transfer_core(
                &ctx.accounts.mpl_core_program,
                asset_ai,
                coll_ai,
                &ctx.accounts.swap_offer.to_account_info(),
                &ctx.accounts.taker.to_account_info(),
                &ctx.accounts.taker.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                Some(&[seeds]),
            )?;
        }

        // 4) Offered $GBOY top-up: swap PDA ATA -> taker ATA.
        if swap.gboy_offered > 0 {
            let swap_ata = ctx.accounts.swap_gboy.as_ref().ok_or(MarketError::MissingTokenAccount)?;
            let taker_ata = ctx.accounts.taker_gboy.as_ref().ok_or(MarketError::MissingTokenAccount)?;
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    SplTransfer {
                        from: swap_ata.to_account_info(),
                        to: taker_ata.to_account_info(),
                        authority: ctx.accounts.swap_offer.to_account_info(),
                    },
                    &[seeds],
                ),
                swap.gboy_offered,
            )?;
            // Reclaim the now-empty escrow ATA's rent back to the maker.
            token::close_account(CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                CloseAccount {
                    account: swap_ata.to_account_info(),
                    destination: ctx.accounts.maker.to_account_info(),
                    authority: ctx.accounts.swap_offer.to_account_info(),
                },
                &[seeds],
            ))?;
        }

        // 5) Offered SOL top-up: swap PDA lamports -> taker.
        if swap.sol_offered > 0 {
            // Guard against underflow: PDA must have enough lamports beyond what
            // the `close = maker` rent sweep will reclaim.
            let pda_lamports = ctx.accounts.swap_offer.to_account_info().lamports();
            require!(
                pda_lamports >= swap.sol_offered,
                MarketError::InsufficientFunds
            );
            **ctx
                .accounts
                .swap_offer
                .to_account_info()
                .try_borrow_mut_lamports()? -= swap.sol_offered;
            **ctx.accounts.taker.to_account_info().try_borrow_mut_lamports()? +=
                swap.sol_offered;
        }

        emit!(SwapAccepted {
            swap: ctx.accounts.swap_offer.key(),
            maker: swap.maker,
            taker: ctx.accounts.taker.key(),
        });

        // The `close = maker` constraint sweeps remaining rent back to the maker
        // after this handler returns (the offered SOL top-up was already routed
        // to the taker above).
        Ok(())
    }

    /// Cancel a barter offer; maker reclaims all escrowed assets, SOL and $GBOY.
    pub fn cancel_swap<'info>(
        ctx: Context<'_, '_, '_, 'info, CancelSwap<'info>>,
    ) -> Result<()> {
        let swap = &ctx.accounts.swap_offer;
        let off_n = swap.offered_assets.len();
        let rem = ctx.remaining_accounts;
        require!(rem.len() == off_n * 2, MarketError::AccountMismatch);

        let maker_key = swap.maker;
        let nonce_bytes = swap.nonce.to_le_bytes();
        let bump = swap.bump;
        let seeds: &[&[u8]] = &[b"swap", maker_key.as_ref(), nonce_bytes.as_ref(), &[bump]];

        for i in 0..off_n {
            let asset_ai = &rem[i * 2];
            let coll_ai = &rem[i * 2 + 1];
            require_keys_eq!(asset_ai.key(), swap.offered_assets[i], MarketError::AssetMismatch);
            transfer_core(
                &ctx.accounts.mpl_core_program,
                asset_ai,
                coll_ai,
                &ctx.accounts.swap_offer.to_account_info(),
                &ctx.accounts.maker.to_account_info(),
                &ctx.accounts.maker.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                Some(&[seeds]),
            )?;
        }

        if swap.gboy_offered > 0 {
            let swap_ata = ctx.accounts.swap_gboy.as_ref().ok_or(MarketError::MissingTokenAccount)?;
            let maker_ata = ctx.accounts.maker_gboy.as_ref().ok_or(MarketError::MissingTokenAccount)?;
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    SplTransfer {
                        from: swap_ata.to_account_info(),
                        to: maker_ata.to_account_info(),
                        authority: ctx.accounts.swap_offer.to_account_info(),
                    },
                    &[seeds],
                ),
                swap.gboy_offered,
            )?;
            // Reclaim the now-empty escrow ATA's rent back to the maker.
            token::close_account(CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                CloseAccount {
                    account: swap_ata.to_account_info(),
                    destination: ctx.accounts.maker.to_account_info(),
                    authority: ctx.accounts.swap_offer.to_account_info(),
                },
                &[seeds],
            ))?;
        }
        // sol_offered is returned automatically via the `close = maker` rent sweep.
        Ok(())
    }

    // ===================== OFFERS / BIDS =====================
    //
    // A bidder escrows SOL or $GBOY as a standing offer on a specific asset, or
    // on a whole collection (floor bid). Any matching asset owner can accept.

    /// Create an offer. Escrows `amount` of SOL or $GBOY.
    pub fn create_offer(ctx: Context<CreateOffer>, nonce: u64, args: OfferArgs) -> Result<()> {
        require!(args.amount > 0, MarketError::ZeroPrice);
        assert_allowed_collection(&args.collection)?;

        match args.currency {
            Currency::Sol => {
                system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: ctx.accounts.bidder.to_account_info(),
                            to: ctx.accounts.offer.to_account_info(),
                        },
                    ),
                    args.amount,
                )?;
            }
            Currency::Gboy => {
                let bidder_ata = ctx
                    .accounts
                    .bidder_gboy
                    .as_ref()
                    .ok_or(MarketError::MissingTokenAccount)?;
                let offer_ata = ctx
                    .accounts
                    .offer_gboy
                    .as_ref()
                    .ok_or(MarketError::MissingTokenAccount)?;
                token::transfer(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        SplTransfer {
                            from: bidder_ata.to_account_info(),
                            to: offer_ata.to_account_info(),
                            authority: ctx.accounts.bidder.to_account_info(),
                        },
                    ),
                    args.amount,
                )?;
            }
        }

        let offer = &mut ctx.accounts.offer;
        offer.bidder = ctx.accounts.bidder.key();
        offer.collection = args.collection;
        offer.asset = args.asset.unwrap_or_default();
        offer.amount = args.amount;
        offer.currency = args.currency;
        offer.nonce = nonce;
        offer.created_at = Clock::get()?.unix_timestamp;
        offer.bump = ctx.bumps.offer;

        emit!(OfferCreated {
            offer: offer.key(),
            bidder: offer.bidder,
            collection: offer.collection,
            asset: offer.asset,
            amount: offer.amount,
            currency: offer.currency,
        });
        Ok(())
    }

    /// Cancel an offer; the bidder reclaims the escrowed SOL / $GBOY.
    pub fn cancel_offer(ctx: Context<CancelOffer>) -> Result<()> {
        let offer = &ctx.accounts.offer;
        if offer.currency == Currency::Gboy {
            let offer_ata = ctx.accounts.offer_gboy.as_ref().ok_or(MarketError::MissingTokenAccount)?;
            let bidder_ata = ctx.accounts.bidder_gboy.as_ref().ok_or(MarketError::MissingTokenAccount)?;
            let nonce_bytes = offer.nonce.to_le_bytes();
            let seeds: &[&[u8]] = &[b"offer", offer.bidder.as_ref(), nonce_bytes.as_ref(), &[offer.bump]];
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    SplTransfer {
                        from: offer_ata.to_account_info(),
                        to: bidder_ata.to_account_info(),
                        authority: ctx.accounts.offer.to_account_info(),
                    },
                    &[seeds],
                ),
                offer.amount,
            )?;
            token::close_account(CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                CloseAccount {
                    account: offer_ata.to_account_info(),
                    destination: ctx.accounts.bidder.to_account_info(),
                    authority: ctx.accounts.offer.to_account_info(),
                },
                &[seeds],
            ))?;
        }
        // SOL escrow is returned via the `close = bidder` rent sweep.
        Ok(())
    }

    /// Accept an offer: the asset owner delivers the asset to the bidder and
    /// receives the escrowed SOL / $GBOY minus a 5% creator royalty.
    pub fn accept_offer(ctx: Context<AcceptOffer>) -> Result<()> {
        let collection = ctx.accounts.collection.key();
        let (currency, amount, asset_filter, bidder, nonce, bump) = {
            let o = &ctx.accounts.offer;
            (o.currency, o.amount, o.asset, o.bidder, o.nonce, o.bump)
        };
        require_keys_eq!(collection, ctx.accounts.offer.collection, MarketError::AssetCollectionMismatch);
        if asset_filter != Pubkey::default() {
            require_keys_eq!(ctx.accounts.asset.key(), asset_filter, MarketError::AssetMismatch);
        }
        assert_asset_owned_by(
            &ctx.accounts.asset.to_account_info(),
            &collection,
            &ctx.accounts.seller.key(),
        )?;

        // Validate creator.
        let expected_creator = creator_for_collection(&collection)?;
        require_keys_eq!(ctx.accounts.creator.key(), expected_creator, MarketError::InvalidCreator);

        let royalty = compute_royalty(amount);
        let seller_amount = amount.checked_sub(royalty).unwrap();

        // Seller delivers the asset to the bidder.
        transfer_core(
            &ctx.accounts.mpl_core_program.to_account_info(),
            &ctx.accounts.asset.to_account_info(),
            &ctx.accounts.collection.to_account_info(),
            &ctx.accounts.seller.to_account_info(),
            &ctx.accounts.bidder.to_account_info(),
            &ctx.accounts.seller.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            None,
        )?;

        // Pay the seller and creator from escrow.
        match currency {
            Currency::Sol => {
                let pda_lamports = ctx.accounts.offer.to_account_info().lamports();
                require!(
                    pda_lamports >= amount,
                    MarketError::InsufficientFunds
                );
                // Creator royalty.
                if royalty > 0 {
                    **ctx.accounts.offer.to_account_info().try_borrow_mut_lamports()? -= royalty;
                    **ctx.accounts.creator.to_account_info().try_borrow_mut_lamports()? += royalty;
                }
                // Seller receives remainder.
                **ctx.accounts.offer.to_account_info().try_borrow_mut_lamports()? -= seller_amount;
                **ctx.accounts.seller.to_account_info().try_borrow_mut_lamports()? += seller_amount;
            }
            Currency::Gboy => {
                let offer_ata = ctx.accounts.offer_gboy.as_ref().ok_or(MarketError::MissingTokenAccount)?;
                let seller_ata = ctx.accounts.seller_gboy.as_ref().ok_or(MarketError::MissingTokenAccount)?;
                let creator_ata = ctx.accounts.creator_gboy.as_ref().ok_or(MarketError::MissingTokenAccount)?;
                let nonce_bytes = nonce.to_le_bytes();
                let seeds: &[&[u8]] = &[b"offer", bidder.as_ref(), nonce_bytes.as_ref(), &[bump]];
                // Creator royalty.
                if royalty > 0 {
                    token::transfer(
                        CpiContext::new_with_signer(
                            ctx.accounts.token_program.to_account_info(),
                            SplTransfer {
                                from: offer_ata.to_account_info(),
                                to: creator_ata.to_account_info(),
                                authority: ctx.accounts.offer.to_account_info(),
                            },
                            &[seeds],
                        ),
                        royalty,
                    )?;
                }
                // Seller receives remainder.
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        SplTransfer {
                            from: offer_ata.to_account_info(),
                            to: seller_ata.to_account_info(),
                            authority: ctx.accounts.offer.to_account_info(),
                        },
                        &[seeds],
                    ),
                    seller_amount,
                )?;
                token::close_account(CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    CloseAccount {
                        account: offer_ata.to_account_info(),
                        destination: ctx.accounts.bidder.to_account_info(),
                        authority: ctx.accounts.offer.to_account_info(),
                    },
                    &[seeds],
                ))?;
            }
        }

        emit!(OfferAccepted {
            offer: ctx.accounts.offer.key(),
            bidder,
            seller: ctx.accounts.seller.key(),
            asset: ctx.accounts.asset.key(),
            amount,
            currency,
        });
        // `close = bidder` returns the offer account rent to the bidder.
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

fn assert_allowed_collection(collection: &Pubkey) -> Result<()> {
    require!(
        *collection == BADGES_COLLECTION || *collection == HARMIES_COLLECTION,
        MarketError::CollectionNotAllowed
    );
    Ok(())
}

/// Return the verified creator wallet for a given collection.
fn creator_for_collection(collection: &Pubkey) -> Result<Pubkey> {
    if *collection == BADGES_COLLECTION {
        Ok(BADGES_CREATOR)
    } else if *collection == HARMIES_COLLECTION {
        Ok(HARMIES_CREATOR)
    } else {
        err!(MarketError::CollectionNotAllowed)
    }
}

/// Compute the 5% creator royalty (500 basis points) from a sale price.
fn compute_royalty(price: u64) -> u64 {
    ((price as u128) * (ROYALTY_BPS as u128) / 10_000) as u64
}

/// Verify a leaf belongs to a Merkle tree with the given `root`, using
/// sorted-pair SHA-256 hashing (OpenZeppelin-style, so proofs carry no
/// direction bits). The leaf is `sha256(asset_pubkey)`; the tree is built
/// off-chain over the set of asset pubkeys that satisfy a requested trait group
/// (e.g. every "Snake" badge), so a valid proof proves the delivered asset is a
/// member of that group without the program needing any off-chain trait data.
fn merkle_member(asset_key: &Pubkey, proof: &[[u8; 32]], root: &[u8; 32]) -> bool {
    let mut computed = solana_sha256_hasher::hashv(&[asset_key.as_ref()]).to_bytes();
    for node in proof {
        computed = if computed <= *node {
            solana_sha256_hasher::hashv(&[&computed, node]).to_bytes()
        } else {
            solana_sha256_hasher::hashv(&[node, &computed]).to_bytes()
        };
    }
    &computed == root
}

/// Verify `asset_ai` is a Core asset that belongs to `collection` and is
/// currently owned by `owner`.
///
/// MPL Core `AssetV1` account layout (prefix):
///   [0]      key (1 = AssetV1)
///   [1..33]  owner: Pubkey
///   [33]     update_authority kind (0 = None, 1 = Address, 2 = Collection)
///   [34..66] update_authority pubkey (present for Address / Collection)
fn assert_asset_owned_by(
    asset_ai: &AccountInfo,
    collection: &Pubkey,
    owner: &Pubkey,
) -> Result<()> {
    require_keys_eq!(
        *asset_ai.owner,
        MPL_CORE_PROGRAM,
        MarketError::InvalidAssetProgram
    );
    let data = asset_ai.try_borrow_data()?;
    require!(data.len() >= 66, MarketError::InvalidAsset);
    require!(data[0] == 1, MarketError::InvalidAsset); // AssetV1

    let asset_owner = Pubkey::new_from_array(
        <[u8; 32]>::try_from(&data[1..33]).map_err(|_| error!(MarketError::InvalidAsset))?,
    );
    // update_authority must be a Collection (kind == 2).
    require!(data[33] == 2, MarketError::AssetNotInCollection);
    let asset_collection = Pubkey::new_from_array(
        <[u8; 32]>::try_from(&data[34..66]).map_err(|_| error!(MarketError::InvalidAsset))?,
    );

    require_keys_eq!(asset_collection, *collection, MarketError::AssetCollectionMismatch);
    require_keys_eq!(asset_owner, *owner, MarketError::NotAssetOwner);
    Ok(())
}

/// Invoke MPL Core `TransferV1` directly (no mpl-core crate dependency, so the
/// program stays pinned to anchor's Solana SDK version).
///
/// Account order matches the Core program's expectation:
///   0 asset (w)  1 collection  2 payer (w,s)  3 authority (s)
///   4 new_owner  5 system_program  6 log_wrapper (sentinel = Core program id)
#[allow(clippy::too_many_arguments)]
fn transfer_core<'info>(
    mpl_core_program: &AccountInfo<'info>,
    asset: &AccountInfo<'info>,
    collection: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    new_owner: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    signer_seeds: Option<&[&[&[u8]]]>,
) -> Result<()> {
    let accounts = vec![
        AccountMeta::new(*asset.key, false),
        AccountMeta::new_readonly(*collection.key, false),
        AccountMeta::new(*payer.key, true),
        AccountMeta::new_readonly(*authority.key, authority.is_signer || signer_seeds.is_some()),
        AccountMeta::new_readonly(*new_owner.key, false),
        AccountMeta::new_readonly(*system_program.key, false),
        // log_wrapper is unused; Core accepts its own program id as the "none" sentinel.
        AccountMeta::new_readonly(MPL_CORE_PROGRAM, false),
    ];
    // TransferV1 discriminator (14) + borsh `Option<CompressionProof>::None` (0).
    let data = vec![CORE_TRANSFER_V1_DISCRIMINATOR, 0u8];
    let ix = Instruction {
        program_id: MPL_CORE_PROGRAM,
        accounts,
        data,
    };
    let infos = [
        mpl_core_program.clone(),
        asset.clone(),
        collection.clone(),
        payer.clone(),
        authority.clone(),
        new_owner.clone(),
        system_program.clone(),
    ];
    match signer_seeds {
        Some(seeds) => invoke_signed(&ix, &infos, seeds)?,
        None => invoke(&ix, &infos)?,
    }
    Ok(())
}

/// Delegate freeze + transfer authority to `delegate` and freeze the asset
/// (escrowless listing). The owner signs as authority for adding the plugins.
fn add_delegates_and_freeze<'info>(
    mpl_core_program: &AccountInfo<'info>,
    asset: &AccountInfo<'info>,
    collection: &AccountInfo<'info>,
    owner: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    delegate: Pubkey,
) -> Result<()> {
    AddPluginV1CpiBuilder::new(mpl_core_program)
        .asset(asset)
        .collection(Some(collection))
        .payer(owner)
        .authority(Some(owner))
        .system_program(system_program)
        .plugin(Plugin::TransferDelegate(TransferDelegate {}))
        .init_authority(PluginAuthority::Address { address: delegate })
        .invoke()?;
    AddPluginV1CpiBuilder::new(mpl_core_program)
        .asset(asset)
        .collection(Some(collection))
        .payer(owner)
        .authority(Some(owner))
        .system_program(system_program)
        .plugin(Plugin::FreezeDelegate(FreezeDelegate { frozen: true }))
        .init_authority(PluginAuthority::Address { address: delegate })
        .invoke()?;
    Ok(())
}

/// Thaw the asset and remove the marketplace delegates. Used on delist — the
/// asset never left the seller's wallet.
///
/// Authority split (verified against MPL Core): only the freeze delegate (the
/// listing PDA) may THAW, but only the asset OWNER may REMOVE an owner-managed
/// plugin — a delegate can update/thaw but not remove. So the PDA thaws
/// (PDA-signed) and the seller, who signs `cancel_listing`, removes the
/// delegates directly. Removal also refunds the plugin rent to the seller.
fn thaw_and_release<'info>(
    mpl_core_program: &AccountInfo<'info>,
    asset: &AccountInfo<'info>,
    collection: &AccountInfo<'info>,
    listing_pda: &AccountInfo<'info>,
    owner: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    seeds: &[&[&[u8]]],
) -> Result<()> {
    // 1) Thaw — freeze-delegate (listing PDA) signs via seeds.
    UpdatePluginV1CpiBuilder::new(mpl_core_program)
        .asset(asset)
        .collection(Some(collection))
        .payer(owner)
        .authority(Some(listing_pda))
        .system_program(system_program)
        .plugin(Plugin::FreezeDelegate(FreezeDelegate { frozen: false }))
        .invoke_signed(seeds)?;
    // 2) Remove the delegates — only the owner (seller) may, so it signs directly.
    RemovePluginV1CpiBuilder::new(mpl_core_program)
        .asset(asset)
        .collection(Some(collection))
        .payer(owner)
        .authority(Some(owner))
        .system_program(system_program)
        .plugin_type(PluginType::FreezeDelegate)
        .invoke()?;
    RemovePluginV1CpiBuilder::new(mpl_core_program)
        .asset(asset)
        .collection(Some(collection))
        .payer(owner)
        .authority(Some(owner))
        .system_program(system_program)
        .plugin_type(PluginType::TransferDelegate)
        .invoke()?;
    Ok(())
}

/// On sale: thaw, transfer (as the transfer delegate) seller -> buyer, then strip
/// the marketplace delegates so the asset leaves the market clean.
///
/// MPL Core does NOT remove owner-managed plugins on transfer — it merely resets
/// their authority to the new owner. If left behind, the freeze/transfer
/// delegates would block the buyer from ever re-listing (AddPlugin would fail
/// with "plugin already exists"). After the transfer the buyer is the owner and
/// signs this purchase, so the buyer removes them (only the owner can — verified
/// against MPL Core).
#[allow(clippy::too_many_arguments)]
fn settle_listing_to_buyer<'info>(
    mpl_core_program: &AccountInfo<'info>,
    asset: &AccountInfo<'info>,
    collection: &AccountInfo<'info>,
    listing_pda: &AccountInfo<'info>,
    buyer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    asset_key: Pubkey,
    bump: u8,
) -> Result<()> {
    let seeds: &[&[u8]] = &[b"listing", asset_key.as_ref(), &[bump]];
    UpdatePluginV1CpiBuilder::new(mpl_core_program)
        .asset(asset)
        .collection(Some(collection))
        .payer(buyer)
        .authority(Some(listing_pda))
        .system_program(system_program)
        .plugin(Plugin::FreezeDelegate(FreezeDelegate { frozen: false }))
        .invoke_signed(&[seeds])?;
    transfer_core(
        mpl_core_program,
        asset,
        collection,
        listing_pda,
        buyer,
        buyer,
        system_program,
        Some(&[seeds]),
    )?;
    // Delegates' authority is now the buyer (owner); the buyer signs, so remove
    // them. Refund goes to the buyer.
    RemovePluginV1CpiBuilder::new(mpl_core_program)
        .asset(asset)
        .collection(Some(collection))
        .payer(buyer)
        .authority(Some(buyer))
        .system_program(system_program)
        .plugin_type(PluginType::FreezeDelegate)
        .invoke()?;
    RemovePluginV1CpiBuilder::new(mpl_core_program)
        .asset(asset)
        .collection(Some(collection))
        .payer(buyer)
        .authority(Some(buyer))
        .system_program(system_program)
        .plugin_type(PluginType::TransferDelegate)
        .invoke()?;
    Ok(())
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum Currency {
    Sol,
    Gboy,
}

#[account]
#[derive(InitSpace)]
pub struct Listing {
    pub seller: Pubkey,
    pub asset: Pubkey,
    pub collection: Pubkey,
    pub price: u64,
    pub currency: Currency,
    pub created_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct SwapOffer {
    pub maker: Pubkey,
    /// Pubkey::default() = open to anyone.
    pub taker: Pubkey,
    #[max_len(MAX_SWAP_ASSETS)]
    pub offered_assets: Vec<Pubkey>,
    /// Specific assets the taker must deliver (exact pubkey match).
    #[max_len(MAX_SWAP_ASSETS)]
    pub requested_assets: Vec<Pubkey>,
    /// Trait-group slots: each is a Merkle root over the set of asset pubkeys
    /// that satisfy a requested type (e.g. "any Snake badge"). The taker fills
    /// each slot with any asset they own that proves into the corresponding
    /// root. Order matters: proofs and delivered group assets line up by index.
    #[max_len(MAX_SWAP_ASSETS)]
    pub requested_groups: Vec<[u8; 32]>,
    pub sol_offered: u64,
    pub gboy_offered: u64,
    pub sol_requested: u64,
    pub gboy_requested: u64,
    pub nonce: u64,
    pub created_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SwapArgs {
    pub offered_count: u8,
    pub requested_assets: Vec<Pubkey>,
    /// Merkle roots for "any asset matching this trait" slots (see SwapOffer).
    pub requested_groups: Vec<[u8; 32]>,
    pub sol_offered: u64,
    pub gboy_offered: u64,
    pub sol_requested: u64,
    pub gboy_requested: u64,
    pub taker: Option<Pubkey>,
}

#[account]
#[derive(InitSpace)]
pub struct Offer {
    pub bidder: Pubkey,
    pub collection: Pubkey,
    /// Pubkey::default() = any asset in the collection (floor bid).
    pub asset: Pubkey,
    pub amount: u64,
    pub currency: Currency,
    pub nonce: u64,
    pub created_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OfferArgs {
    pub collection: Pubkey,
    /// None = collection floor bid; Some = bid on one specific asset.
    pub asset: Option<Pubkey>,
    pub amount: u64,
    pub currency: Currency,
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ListAsset<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(
        init,
        payer = seller,
        space = 8 + Listing::INIT_SPACE,
        seeds = [b"listing", asset.key().as_ref()],
        bump
    )]
    pub listing: Account<'info, Listing>,

    /// CHECK: validated as a Core asset in the allow-listed collection.
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,

    /// CHECK: must be an allow-listed Core collection (validated in handler).
    /// `mut` because MPL Core marks the collection writable on AddPlugin/Freeze.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,

    /// CHECK: MPL Core program.
    #[account(address = MPL_CORE_PROGRAM)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateListing<'info> {
    pub seller: Signer<'info>,
    #[account(
        mut,
        has_one = seller @ MarketError::NotSeller,
        seeds = [b"listing", listing.asset.as_ref()],
        bump = listing.bump,
    )]
    pub listing: Account<'info, Listing>,
}

#[derive(Accounts)]
pub struct CancelListing<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(
        mut,
        close = seller,
        has_one = seller @ MarketError::NotSeller,
        has_one = asset @ MarketError::AssetMismatch,
        seeds = [b"listing", asset.key().as_ref()],
        bump = listing.bump,
    )]
    pub listing: Account<'info, Listing>,

    /// CHECK: the escrowed Core asset.
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,
    /// CHECK: the asset's Core collection; bound to the listing's collection.
    /// `mut` because MPL Core marks the collection writable on plugin updates.
    #[account(mut, constraint = collection.key() == listing.collection @ MarketError::AssetCollectionMismatch)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: MPL Core program.
    #[account(address = MPL_CORE_PROGRAM)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PurchaseWithSol<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: validated against listing.seller via has_one.
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,

    #[account(
        mut,
        close = seller,
        has_one = seller @ MarketError::NotSeller,
        has_one = asset @ MarketError::AssetMismatch,
        seeds = [b"listing", asset.key().as_ref()],
        bump = listing.bump,
    )]
    pub listing: Account<'info, Listing>,

    /// CHECK: the escrowed Core asset.
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,
    /// CHECK: the asset's Core collection; bound to the listing's collection.
    /// `mut` because MPL Core marks the collection writable on plugin updates.
    #[account(mut, constraint = collection.key() == listing.collection @ MarketError::AssetCollectionMismatch)]
    pub collection: UncheckedAccount<'info>,

    /// CHECK: creator wallet for the collection. Receives the 5% royalty.
    /// Validated in the handler via `creator_for_collection`.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,

    /// CHECK: MPL Core program.
    #[account(address = MPL_CORE_PROGRAM)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PurchaseWithGboy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: validated against listing.seller via has_one.
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,

    #[account(
        mut,
        close = seller,
        has_one = seller @ MarketError::NotSeller,
        has_one = asset @ MarketError::AssetMismatch,
        seeds = [b"listing", asset.key().as_ref()],
        bump = listing.bump,
    )]
    pub listing: Account<'info, Listing>,

    #[account(address = GBOY_MINT @ MarketError::WrongToken)]
    pub gboy_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = buyer_gboy.mint == GBOY_MINT @ MarketError::WrongToken,
        constraint = buyer_gboy.owner == buyer.key() @ MarketError::WrongToken,
    )]
    pub buyer_gboy: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = seller_gboy.mint == GBOY_MINT @ MarketError::WrongToken,
        constraint = seller_gboy.owner == seller.key() @ MarketError::WrongToken,
    )]
    pub seller_gboy: Account<'info, TokenAccount>,

    /// CHECK: creator wallet for the collection. Validated in handler.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,

    /// Creator's $GBOY ATA — receives the 5% royalty.
    #[account(
        mut,
        constraint = creator_gboy.mint == GBOY_MINT @ MarketError::WrongToken,
        constraint = creator_gboy.owner == creator.key() @ MarketError::WrongToken,
    )]
    pub creator_gboy: Account<'info, TokenAccount>,

    /// CHECK: the escrowed Core asset.
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,
    /// CHECK: the asset's Core collection; bound to the listing's collection.
    /// `mut` because MPL Core marks the collection writable on plugin updates.
    #[account(mut, constraint = collection.key() == listing.collection @ MarketError::AssetCollectionMismatch)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: MPL Core program.
    #[account(address = MPL_CORE_PROGRAM)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreateSwap<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,

    #[account(
        init,
        payer = maker,
        space = 8 + SwapOffer::INIT_SPACE,
        seeds = [b"swap", maker.key().as_ref(), nonce.to_le_bytes().as_ref()],
        bump
    )]
    pub swap_offer: Account<'info, SwapOffer>,

    #[account(
        mut,
        constraint = maker_gboy.mint == GBOY_MINT @ MarketError::WrongToken,
        constraint = maker_gboy.owner == maker.key() @ MarketError::WrongToken,
    )]
    pub maker_gboy: Option<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = swap_gboy.mint == GBOY_MINT @ MarketError::WrongToken,
        constraint = swap_gboy.owner == swap_offer.key() @ MarketError::WrongToken,
    )]
    pub swap_gboy: Option<Account<'info, TokenAccount>>,

    /// CHECK: MPL Core program.
    #[account(address = MPL_CORE_PROGRAM)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptSwap<'info> {
    #[account(mut)]
    pub taker: Signer<'info>,

    /// CHECK: validated against swap.maker via has_one.
    #[account(mut)]
    pub maker: UncheckedAccount<'info>,

    #[account(
        mut,
        close = maker,
        has_one = maker @ MarketError::NotMaker,
        seeds = [b"swap", maker.key().as_ref(), swap_offer.nonce.to_le_bytes().as_ref()],
        bump = swap_offer.bump,
    )]
    pub swap_offer: Account<'info, SwapOffer>,

    #[account(
        mut,
        constraint = taker_gboy.mint == GBOY_MINT @ MarketError::WrongToken,
        constraint = taker_gboy.owner == taker.key() @ MarketError::WrongToken,
    )]
    pub taker_gboy: Option<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = maker_gboy.mint == GBOY_MINT @ MarketError::WrongToken,
        constraint = maker_gboy.owner == maker.key() @ MarketError::WrongToken,
    )]
    pub maker_gboy: Option<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = swap_gboy.mint == GBOY_MINT @ MarketError::WrongToken,
        constraint = swap_gboy.owner == swap_offer.key() @ MarketError::WrongToken,
    )]
    pub swap_gboy: Option<Account<'info, TokenAccount>>,

    /// CHECK: MPL Core program.
    #[account(address = MPL_CORE_PROGRAM)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelSwap<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,

    #[account(
        mut,
        close = maker,
        has_one = maker @ MarketError::NotMaker,
        seeds = [b"swap", maker.key().as_ref(), swap_offer.nonce.to_le_bytes().as_ref()],
        bump = swap_offer.bump,
    )]
    pub swap_offer: Account<'info, SwapOffer>,

    #[account(
        mut,
        constraint = maker_gboy.mint == GBOY_MINT @ MarketError::WrongToken,
        constraint = maker_gboy.owner == maker.key() @ MarketError::WrongToken,
    )]
    pub maker_gboy: Option<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = swap_gboy.mint == GBOY_MINT @ MarketError::WrongToken,
        constraint = swap_gboy.owner == swap_offer.key() @ MarketError::WrongToken,
    )]
    pub swap_gboy: Option<Account<'info, TokenAccount>>,

    /// CHECK: MPL Core program.
    #[account(address = MPL_CORE_PROGRAM)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreateOffer<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,

    #[account(
        init,
        payer = bidder,
        space = 8 + Offer::INIT_SPACE,
        seeds = [b"offer", bidder.key().as_ref(), nonce.to_le_bytes().as_ref()],
        bump
    )]
    pub offer: Account<'info, Offer>,

    #[account(
        mut,
        constraint = bidder_gboy.mint == GBOY_MINT @ MarketError::WrongToken,
        constraint = bidder_gboy.owner == bidder.key() @ MarketError::WrongToken,
    )]
    pub bidder_gboy: Option<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = offer_gboy.mint == GBOY_MINT @ MarketError::WrongToken,
        constraint = offer_gboy.owner == offer.key() @ MarketError::WrongToken,
    )]
    pub offer_gboy: Option<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelOffer<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,

    #[account(
        mut,
        close = bidder,
        has_one = bidder @ MarketError::NotBidder,
        seeds = [b"offer", bidder.key().as_ref(), offer.nonce.to_le_bytes().as_ref()],
        bump = offer.bump,
    )]
    pub offer: Account<'info, Offer>,

    #[account(
        mut,
        constraint = bidder_gboy.mint == GBOY_MINT @ MarketError::WrongToken,
        constraint = bidder_gboy.owner == bidder.key() @ MarketError::WrongToken,
    )]
    pub bidder_gboy: Option<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = offer_gboy.mint == GBOY_MINT @ MarketError::WrongToken,
        constraint = offer_gboy.owner == offer.key() @ MarketError::WrongToken,
    )]
    pub offer_gboy: Option<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptOffer<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    /// CHECK: validated against offer.bidder via has_one.
    #[account(mut)]
    pub bidder: UncheckedAccount<'info>,

    #[account(
        mut,
        close = bidder,
        has_one = bidder @ MarketError::NotBidder,
        seeds = [b"offer", bidder.key().as_ref(), offer.nonce.to_le_bytes().as_ref()],
        bump = offer.bump,
    )]
    pub offer: Account<'info, Offer>,

    /// CHECK: the Core asset the seller delivers.
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,
    /// CHECK: must match offer.collection.
    #[account(constraint = collection.key() == offer.collection @ MarketError::AssetCollectionMismatch)]
    pub collection: UncheckedAccount<'info>,

    /// CHECK: creator wallet for the collection. Receives the 5% royalty.
    /// Validated in the handler via `creator_for_collection`.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = offer_gboy.mint == GBOY_MINT @ MarketError::WrongToken,
        constraint = offer_gboy.owner == offer.key() @ MarketError::WrongToken,
    )]
    pub offer_gboy: Option<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = seller_gboy.mint == GBOY_MINT @ MarketError::WrongToken,
        constraint = seller_gboy.owner == seller.key() @ MarketError::WrongToken,
    )]
    pub seller_gboy: Option<Account<'info, TokenAccount>>,

    /// Creator's $GBOY ATA — receives the 5% royalty on $GBOY offers.
    #[account(
        mut,
        constraint = creator_gboy.mint == GBOY_MINT @ MarketError::WrongToken,
        constraint = creator_gboy.owner == creator.key() @ MarketError::WrongToken,
    )]
    pub creator_gboy: Option<Account<'info, TokenAccount>>,

    /// CHECK: MPL Core program.
    #[account(address = MPL_CORE_PROGRAM)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct Listed {
    pub asset: Pubkey,
    pub seller: Pubkey,
    pub price: u64,
    pub currency: Currency,
}

#[event]
pub struct ListingUpdated {
    pub asset: Pubkey,
    pub seller: Pubkey,
    pub price: u64,
    pub currency: Currency,
}

#[event]
pub struct Sold {
    pub asset: Pubkey,
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub price: u64,
    pub currency: Currency,
}

#[event]
pub struct SwapCreated {
    pub swap: Pubkey,
    pub maker: Pubkey,
}

#[event]
pub struct SwapAccepted {
    pub swap: Pubkey,
    pub maker: Pubkey,
    pub taker: Pubkey,
}

#[event]
pub struct OfferCreated {
    pub offer: Pubkey,
    pub bidder: Pubkey,
    pub collection: Pubkey,
    pub asset: Pubkey,
    pub amount: u64,
    pub currency: Currency,
}

#[event]
pub struct OfferAccepted {
    pub offer: Pubkey,
    pub bidder: Pubkey,
    pub seller: Pubkey,
    pub asset: Pubkey,
    pub amount: u64,
    pub currency: Currency,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum MarketError {
    #[msg("Collection is not part of the NEUKO ecosystem")]
    CollectionNotAllowed,
    #[msg("Account is not a valid MPL Core asset")]
    InvalidAssetProgram,
    #[msg("Failed to deserialize the Core asset")]
    InvalidAsset,
    #[msg("Asset does not belong to the provided collection")]
    AssetCollectionMismatch,
    #[msg("Asset is not part of any allow-listed collection")]
    AssetNotInCollection,
    #[msg("Signer is not the current owner of the asset")]
    NotAssetOwner,
    #[msg("Price must be greater than zero")]
    ZeroPrice,
    #[msg("Listing currency does not match this instruction")]
    WrongCurrency,
    #[msg("Only $GBOY is accepted as a token currency")]
    WrongToken,
    #[msg("Signer is not the seller of this listing")]
    NotSeller,
    #[msg("Signer is not the maker of this swap")]
    NotMaker,
    #[msg("Signer is not the bidder of this offer")]
    NotBidder,
    #[msg("Caller is not the designated taker for this swap")]
    NotDesignatedTaker,
    #[msg("Provided asset does not match the expected asset")]
    AssetMismatch,
    #[msg("A swap may offer at most 5 NFTs")]
    TooManyAssets,
    #[msg("A swap must offer at least one asset, SOL or $GBOY")]
    EmptyOffer,
    #[msg("A swap must request at least one asset, SOL or $GBOY")]
    EmptyRequest,
    #[msg("Remaining account count does not match the expected layout")]
    AccountMismatch,
    #[msg("A required $GBOY token account was not provided")]
    MissingTokenAccount,
    #[msg("Escrow account has insufficient lamports for the SOL transfer")]
    InsufficientFunds,
    #[msg("Listing price exceeds the maximum the buyer agreed to pay")]
    PriceExceedsMax,
    #[msg("Creator account does not match the expected creator for this collection")]
    InvalidCreator,
    #[msg("The delivered asset is not a valid member of the requested trait group")]
    InvalidMerkleProof,
    #[msg("The same asset cannot be used to fill more than one requested slot")]
    DuplicateSwapAsset,
    #[msg("A swap may request at most 5 NFTs")]
    TooManyGroups,
    #[msg("A Merkle proof exceeds the maximum allowed depth")]
    ProofTooLong,
}
