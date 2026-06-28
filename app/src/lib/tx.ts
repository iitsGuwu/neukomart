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

/** Optional persistent lookup table holding the static program accounts.
 *  Create once with `createStaticLookupTable` and set VITE_LOOKUP_TABLE. */
const STATIC_LUT: string | undefined = import.meta.env.VITE_LOOKUP_TABLE;

/** Turn a failed simulation into an accurate, actionable message. Prefers the
 *  specific cause (insufficient funds, missing account, the program's own error
 *  message) over a raw dump, so users can actually troubleshoot. */
function simErrorMessage(err: unknown, logs: string[]): string {
  const errStr = typeof err === 'string' ? err : JSON.stringify(err ?? '');
  const haystack = (errStr + '\n' + logs.join('\n')).toLowerCase();

  // Insufficient SOL — for fees or for the rent the program must pay on init.
  if (/insufficient (lamports|funds)|insufficientfunds(forrent)?|debit an account but found no record/.test(haystack)) {
    return 'Not enough funds — add more SOL to your wallet to cover the network fee and account rent.';
  }
  // The fee payer or a referenced account does not exist on-chain.
  if (/accountnotfound/.test(haystack)) {
    return 'Not enough funds, or a required account is missing — make sure your wallet has SOL, and that this is a NEUKO-native listing (Magic Eden / Tensor items are managed on those marketplaces).';
  }
  // The program's own error message (Anchor logs "Error Message: <text>").
  const anchorMsg = [...logs]
    .reverse()
    .map((l) => l.match(/Error Message:\s*(.+?)\s*$/)?.[1])
    .find(Boolean);
  if (anchorMsg) return anchorMsg;

  // Fallback: the most relevant raw log line, else the raw error.
  const raw = [...logs].reverse().find((l) => /custom program error|failed|panicked/i.test(l));
  if (raw) return raw.replace(/^Program log:\s*/, '').slice(0, 200);
  return errStr.slice(0, 200);
}

/** Median priority fee (micro-lamports/CU) from recent blocks, clamped. */
export async function getPriorityFee(
  connection: Connection,
  keys: PublicKey[],
): Promise<number> {
  try {
    const recent = await connection.getRecentPrioritizationFees({
      lockedWritableAccounts: keys.slice(0, 16),
    });
    const fees = recent.map((r) => r.prioritizationFee).filter((f) => f > 0).sort((a, b) => a - b);
    const median = fees.length ? fees[Math.floor(fees.length / 2)] : 0;
    // Clamp to a sane range so users never overpay wildly.
    return Math.min(Math.max(median, 1_000), 1_000_000);
  } catch {
    return 10_000;
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
    throw new Error('Not enough funds — your wallet has no SOL. Add SOL to cover the network fee and account rent (~0.01 SOL), then try again.');
  }

  const keys = uniqueKeys(ixs);
  const priority = await getPriorityFee(connection, keys);
  const luts = await loadLookupTables(connection);

  let sim: { units: number; logs: string[]; err: unknown } | null = null;
  try {
    sim = await estimateUnits(connection, payer, ixs, priority, luts);
  } catch {
    sim = null; // simulation unavailable — proceed without pre-flight
  }

  let unitLimit = 400_000;
  if (sim) {
    if (sim.err) throw new Error(simErrorMessage(sim.err, sim.logs));
    unitLimit = unitLimitFor(sim.units);
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = buildV0Message(payer, blockhash, ixs, priority, unitLimit, luts);
  const sig = await wallet.sendTransaction(tx, connection);
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
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
