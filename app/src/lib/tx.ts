import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import type { WalletContextState } from '@solana/wallet-adapter-react';
import { getConnection } from './chain';

/**
 * Modern transaction pipeline:
 *   • versioned (v0) transactions
 *   • Address Lookup Tables so large multi-asset swaps fit under the size limit
 *   • dynamic priority fees from recent network conditions
 *   • pre-flight simulation + a structured preview for the UI
 */

/** Persistent Address Lookup Table holding the static ecosystem accounts
 *  (program, MPL Core, token programs, $GBOY mint, collections, creators). It
 *  compresses those ~11 accounts to a 1-byte index each, freeing ~340 bytes so
 *  large transactions — notably swap accepts carrying multiple Merkle proofs for
 *  "any badge type" slots — stay under the 1232-byte limit. Public, not secret;
 *  overridable via VITE_LOOKUP_TABLE. */
const STATIC_LUT: string | undefined =
  import.meta.env.VITE_LOOKUP_TABLE || 'CF4t6SuD6kFXuXCtHnHbMUKEyM8aug8V7ncFi6mehKff';

/** NEUKO Market program error codes (Anchor, 6000+) → plain-English reasons.
 *  Kept in sync with the program's MarketError enum / IDL. */
const NEUKO_ERRORS: Record<number, string> = {
  6000: 'That collection is not part of the NEUKO ecosystem.',
  6001: 'That account is not a valid Metaplex Core asset.',
  6002: 'Could not read the Core asset.',
  6003: 'The asset does not belong to the provided collection.',
  6004: 'The asset is not part of an allow-listed collection.',
  6005: 'You are not the current owner of this asset.',
  6006: 'Price must be greater than zero.',
  6007: 'The listing currency does not match this action.',
  6008: 'Only $GBOY is accepted as a token currency.',
  6009: 'You are not the seller of this listing.',
  6010: 'You are not the maker of this swap.',
  6011: 'You are not the bidder of this offer.',
  6012: 'You are not the designated taker for this swap.',
  6013: 'The provided asset does not match the expected asset.',
  6014: 'Too many assets for a single swap (max 8 per side).',
  6015: 'A swap must offer at least one asset, SOL or $GBOY.',
  6016: 'A swap must request at least one asset, SOL or $GBOY.',
  6017: 'The accounts provided do not match the expected layout.',
  6018: 'A required $GBOY token account is missing.',
  6019: 'The escrow has insufficient lamports for the SOL transfer.',
  6020: 'The price exceeds the maximum you agreed to pay.',
  6021: 'The creator account does not match this collection.',
};

const MPL_CORE = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';

/** Turn a failed simulation into an accurate, actionable message — the specific
 *  cause (insufficient funds, a decoded program error code, the program's own
 *  Anchor message) over a raw dump, so users can actually troubleshoot. */
function simErrorMessage(err: unknown, logs: string[]): string {
  const errStr = typeof err === 'string' ? err : JSON.stringify(err ?? '');
  const logText = logs.join('\n');
  const haystack = (errStr + '\n' + logText).toLowerCase();

  // Insufficient SOL — for fees or for the rent the program must pay on init.
  if (/insufficient (lamports|funds)|insufficientfunds(forrent)?|debit an account but found no record/.test(haystack)) {
    return 'Not enough funds, add more SOL to your wallet to cover the network fee and account rent.';
  }
  // The fee payer or a referenced account does not exist on-chain.
  if (/accountnotfound/.test(haystack)) {
    return 'Not enough funds, or a required account is missing, make sure your wallet has SOL, and that this is a NEUKO-native listing (Magic Eden / Tensor items are managed on those marketplaces).';
  }

  // Decode a custom program error code: structured ({"Custom":N}) or log text
  // ("custom program error: 0xN"). NEUKO codes map to friendly reasons.
  const dec = errStr.match(/"Custom":\s*(\d+)/);
  const hex = logText.match(/custom program error:\s*(0x[0-9a-fA-F]+)/);
  const code = dec ? parseInt(dec[1], 10) : hex ? parseInt(hex[1], 16) : null;
  if (code != null && NEUKO_ERRORS[code]) return NEUKO_ERRORS[code];

  // The program's own Anchor message (covers any error not in the map above).
  // Include the offending account name when Anchor reports one — invaluable for
  // diagnosing constraint / not-initialized failures.
  const acct = logText.match(/AnchorError caused by account:\s*([A-Za-z0-9_]+)/)?.[1];
  const anchorMsg = [...logs]
    .reverse()
    .map((l) => l.match(/Error Message:\s*(.+?)\s*$/)?.[1])
    .find(Boolean);
  if (anchorMsg) return acct ? `${anchorMsg} (account: ${acct})` : anchorMsg;

  // A custom error from a CPI (e.g. Metaplex Core) with no Anchor message.
  if (code != null) {
    return new RegExp(`${MPL_CORE}[\\s\\S]*?custom program error`, 'i').test(logText)
      ? `This NFT is already listed (it carries marketplace delegates), likely on Magic Eden or Tensor. Delist it there first, then list on NEUKO.`
      : `On-chain program error (code 0x${code.toString(16)}).`;
  }

  // Fallback: the most relevant raw log line, else the raw error.
  const raw = [...logs].reverse().find((l) => /custom program error|failed|panicked/i.test(l));
  if (raw) return raw.replace(/^Program log:\s*/, '').slice(0, 200);
  return errStr.slice(0, 200);
}

/** Priority fee (micro-lamports/CU) from recent blocks, clamped. Uses the 75th
 *  percentile + a meaningful floor so the transaction lands promptly — a near-
 *  zero fee leaves it unconfirmed until the blockhash expires ("block height
 *  exceeded"). At ~200k CU even the 50k floor is only ~0.00001 SOL. */
export async function getPriorityFee(
  connection: Connection,
  keys: PublicKey[],
): Promise<number> {
  try {
    const recent = await connection.getRecentPrioritizationFees({
      lockedWritableAccounts: keys.slice(0, 16),
    });
    const fees = recent.map((r) => r.prioritizationFee).filter((f) => f > 0).sort((a, b) => a - b);
    const p75 = fees.length ? fees[Math.floor(fees.length * 0.75)] : 0;
    return Math.min(Math.max(p75, 50_000), 1_000_000);
  } catch {
    return 50_000;
  }
}

async function loadLookupTables(connection: Connection): Promise<AddressLookupTableAccount[]> {
  if (!STATIC_LUT) return [];
  try {
    const res = await connection.getAddressLookupTable(new PublicKey(STATIC_LUT));
    return res.value ? [res.value] : [];
  } catch {
    return [];
  }
}

function uniqueKeys(ixs: TransactionInstruction[]): PublicKey[] {
  const set = new Map<string, PublicKey>();
  for (const ix of ixs) {
    set.set(ix.programId.toBase58(), ix.programId);
    for (const k of ix.keys) set.set(k.pubkey.toBase58(), k.pubkey);
  }
  return [...set.values()];
}

const MAX_CU = 1_400_000;

function buildV0Message(
  payer: PublicKey,
  blockhash: string,
  ixs: TransactionInstruction[],
  priority: number,
  unitLimit: number,
  luts: AddressLookupTableAccount[],
): VersionedTransaction {
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: unitLimit }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priority }),
      ...ixs,
    ],
  }).compileToV0Message(luts);
  return new VersionedTransaction(msg);
}

/** Simulate with a high CU ceiling to learn the real consumption. */
async function estimateUnits(
  connection: Connection,
  payer: PublicKey,
  ixs: TransactionInstruction[],
  priority: number,
  luts: AddressLookupTableAccount[],
): Promise<{ units: number; logs: string[]; err: unknown }> {
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const tx = buildV0Message(payer, blockhash, ixs, priority, MAX_CU, luts);
  const sim = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  return { units: sim.value.unitsConsumed ?? 0, logs: sim.value.logs ?? [], err: sim.value.err };
}

/** CU limit = consumed + 20% headroom, clamped. Falls back if sim gave nothing. */
function unitLimitFor(units: number): number {
  if (!units) return 400_000;
  return Math.min(MAX_CU, Math.max(50_000, Math.ceil(units * 1.2)));
}

/**
 * Build, **pre-flight simulate**, sign and send a v0 transaction with a dynamic
 * priority fee.
 *
 *   • Simulation catches doomed transactions before the user pays a failed-tx
 *     fee — it throws a readable reason instead of letting the wallet submit.
 *   • The compute-unit limit is sized from the simulation, so the priority fee
 *     (charged per *requested* CU) is never overpaid.
 *   • If the simulation infrastructure itself is unreachable, we proceed with a
 *     conservative limit rather than block the user.
 */
export async function sendSmart(
  wallet: WalletContextState,
  ixs: TransactionInstruction[],
): Promise<string> {
  const connection = getConnection();
  const payer = wallet.publicKey!;

  // A wallet with 0 SOL has no on-chain account, so it can't pay fees/rent and
  // simulation fails with a cryptic "AccountNotFound" (before any signing).
  // Catch it up front with a clear, actionable message.
  const balance = await connection.getBalance(payer, 'confirmed').catch(() => null);
  if (balance === 0) {
    throw new Error('Not enough funds, your wallet has no SOL. Add SOL to cover the network fee and account rent (~0.01 SOL), then try again.');
  }

  const keys = uniqueKeys(ixs);
  const priority = await getPriorityFee(connection, keys);
  const luts = await loadLookupTables(connection);

  let sim: { units: number; logs: string[]; err: unknown } | null = null;
  try {
    sim = await estimateUnits(connection, payer, ixs, priority, luts);
  } catch {
    sim = null; // simulation unavailable, proceed without pre-flight
  }

  let unitLimit = 400_000;
  if (sim) {
    if (sim.err) throw new Error(simErrorMessage(sim.err, sim.logs));
    unitLimit = unitLimitFor(sim.units);
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = buildV0Message(payer, blockhash, ixs, priority, unitLimit, luts);
  const sig = await wallet.sendTransaction(tx, connection);

  // A slow wallet approval (the blockhash ages while you review the prompt) or a
  // lagging RPC can trip "block height exceeded" even when the transaction
  // actually lands. So if the blockhash-bound confirm fails, poll the signature
  // status before declaring failure — only give up if it truly never landed.
  try {
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  } catch {
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const st = (await connection.getSignatureStatus(sig, { searchTransactionHistory: true })).value;
      if (st?.err) throw new Error('The transaction failed on-chain. Please try again.');
      if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return sig;
    }
    throw new Error("The network didn't confirm the transaction in time, it likely expired before landing (try approving in the wallet more quickly). Please try again.");
  }
  return sig;
}

/**
 * One-time admin helper: create a persistent lookup table containing the static
 * program accounts (programs, collections, $GBOY mint). Returns the table
 * address to put in VITE_LOOKUP_TABLE so swaps stay under the tx size limit.
 */
export async function createStaticLookupTable(
  wallet: WalletContextState,
  addresses: PublicKey[],
): Promise<string> {
  const connection = getConnection();
  const payer = wallet.publicKey!;
  const slot = await connection.getSlot('finalized');
  const [createIx, lutAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer,
    payer,
    recentSlot: slot,
  });
  const extendIx = AddressLookupTableProgram.extendLookupTable({
    payer,
    authority: payer,
    lookupTable: lutAddress,
    addresses,
  });
  await sendSmart(wallet, [createIx, extendIx]);
  return lutAddress.toBase58();
}
