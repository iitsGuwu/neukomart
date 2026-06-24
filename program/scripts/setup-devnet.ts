/**
 * Devnet asset provisioning for neuko_market integration tests.
 *
 * Two phases (run separately so the expensive program deploy can happen in
 * between, while the payer still holds enough SOL):
 *
 *   tsx scripts/setup-devnet.ts base     # 3 MPL Core collections + $GBOY-like mint
 *   tsx scripts/setup-devnet.ts assets   # test wallets + funded ATAs + sample assets
 *
 * Output is written incrementally to ./devnet-assets.json (gitignored — it holds
 * generated test-wallet secret keys).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  createSignerFromKeypair,
  signerIdentity,
  generateSigner,
  publicKey as umiPk,
} from '@metaplex-foundation/umi';
import { createCollection, create, fetchCollection } from '@metaplex-foundation/mpl-core';

const DEVNET = 'https://api.devnet.solana.com';
const OUT = path.join(process.cwd(), 'devnet-assets.json');
const ID = path.join(os.homedir(), '.config', 'solana', 'id.json');
const GBOY_DECIMALS = 10; // match mainnet $GBOY

function loadPayer(): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(ID, 'utf8'))));
}
function loadState(): any {
  return fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
}
function saveState(s: any) {
  fs.writeFileSync(OUT, JSON.stringify(s, null, 2));
}
function mkUmi(payer: Keypair) {
  const umi = createUmi(DEVNET, 'confirmed');
  const kp = umi.eddsa.createKeypairFromSecretKey(payer.secretKey);
  umi.use(signerIdentity(createSignerFromKeypair(umi, kp)));
  return umi;
}

async function phaseBase() {
  const payer = loadPayer();
  const conn = new Connection(DEVNET, 'confirmed');
  const umi = mkUmi(payer);
  const state = loadState();

  const cols: any = state.collections || {};
  for (const key of ['badges', 'harmies', 'foreign']) {
    if (cols[key]) {
      console.log(`• collection ${key} exists: ${cols[key]}`);
      continue;
    }
    const sig = generateSigner(umi);
    await createCollection(umi, {
      collection: sig,
      name: `NEUKO ${key} (devnet)`,
      uri: `https://neuko.test/${key}.json`,
    }).sendAndConfirm(umi);
    cols[key] = sig.publicKey.toString();
    state.collections = cols;
    saveState(state);
    console.log(`✓ created ${key} collection: ${cols[key]}`);
  }

  if (!state.gboyMint) {
    const mint = await createMint(conn, payer, payer.publicKey, null, GBOY_DECIMALS);
    state.gboyMint = mint.toBase58();
    saveState(state);
    console.log(`✓ created $GBOY-like mint (${GBOY_DECIMALS} dp): ${state.gboyMint}`);
  } else {
    console.log(`• $GBOY mint exists: ${state.gboyMint}`);
  }

  console.log('\nBASE DONE. Bake these into lib.rs (devnet feature), then deploy:');
  console.log(`  HARMIES = ${state.collections.harmies}`);
  console.log(`  BADGES  = ${state.collections.badges}`);
  console.log(`  GBOY    = ${state.gboyMint}`);
}

async function phaseAssets() {
  const payer = loadPayer();
  const conn = new Connection(DEVNET, 'confirmed');
  const umi = mkUmi(payer);
  const state = loadState();
  if (!state.collections || !state.gboyMint) throw new Error('run `base` phase first');

  // 1) test wallets
  state.wallets = state.wallets || {};
  for (const w of ['A', 'B']) {
    if (!state.wallets[w]) {
      const kp = Keypair.generate();
      state.wallets[w] = { pubkey: kp.publicKey.toBase58(), secret: Array.from(kp.secretKey) };
      saveState(state);
      console.log(`✓ wallet ${w}: ${state.wallets[w].pubkey}`);
    } else {
      console.log(`• wallet ${w}: ${state.wallets[w].pubkey}`);
    }
  }
  const A = Keypair.fromSecretKey(Uint8Array.from(state.wallets.A.secret));
  const B = Keypair.fromSecretKey(Uint8Array.from(state.wallets.B.secret));

  // 2) fund SOL (kept small — fee payer in tests is the main wallet)
  for (const kp of [A, B]) {
    const bal = await conn.getBalance(kp.publicKey);
    const target = 0.1 * LAMPORTS_PER_SOL;
    if (bal < target * 0.6) {
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: kp.publicKey, lamports: target }),
      );
      await sendAndConfirmTransaction(conn, tx, [payer]);
      console.log(`✓ funded ${kp.publicKey.toBase58()} with 0.1 SOL`);
    } else {
      console.log(`• ${kp.publicKey.toBase58()} already funded (${(bal / LAMPORTS_PER_SOL).toFixed(3)} SOL)`);
    }
  }

  // 3) $GBOY ATAs + mint 1000 each
  const mint = new PublicKey(state.gboyMint);
  state.gboyAtas = state.gboyAtas || {};
  for (const [name, kp] of [['A', A], ['B', B]] as [string, Keypair][]) {
    const ata = await getOrCreateAssociatedTokenAccount(conn, payer, mint, kp.publicKey);
    state.gboyAtas[name] = ata.address.toBase58();
    if (Number(ata.amount) < 1000) {
      await mintTo(conn, payer, mint, ata.address, payer, BigInt(1000) * BigInt(10) ** BigInt(GBOY_DECIMALS));
      console.log(`✓ minted 1000 $GBOY to wallet ${name}`);
    }
    saveState(state);
  }

  // 4) sample Core assets
  state.assets = state.assets || {};
  const harmies = await fetchCollection(umi, umiPk(state.collections.harmies));
  const badges = await fetchCollection(umi, umiPk(state.collections.badges));
  const foreign = await fetchCollection(umi, umiPk(state.collections.foreign));
  async function mintAsset(label: string, col: any, ownerPk: string, name: string) {
    if (state.assets[label]) {
      console.log(`• asset ${label} exists: ${state.assets[label]}`);
      return;
    }
    const sig = generateSigner(umi);
    await create(umi, {
      asset: sig,
      collection: col,
      owner: umiPk(ownerPk),
      name,
      uri: 'https://neuko.test/asset.json',
    }).sendAndConfirm(umi);
    state.assets[label] = sig.publicKey.toString();
    saveState(state);
    console.log(`✓ ${label} (${name}) -> ${ownerPk.slice(0, 6)}…: ${state.assets[label]}`);
  }

  await mintAsset('H_A_sol', harmies, state.wallets.A.pubkey, 'Harmie #1001');
  await mintAsset('H_A_gboy', harmies, state.wallets.A.pubkey, 'Harmie #1002');
  await mintAsset('H_A_cancel', harmies, state.wallets.A.pubkey, 'Harmie #1003');
  await mintAsset('H_A_offer', harmies, state.wallets.A.pubkey, 'Harmie #1004');
  await mintAsset('B_A_swap', badges, state.wallets.A.pubkey, 'Snake Badge #1');
  await mintAsset('B_B_swap', badges, state.wallets.B.pubkey, 'Moth Badge #2');
  await mintAsset('F_A', foreign, state.wallets.A.pubkey, 'Foreign #1');

  console.log('\nASSETS DONE.');
}

// Extra assets for the exhaustive scenario suite (multi-asset swaps, floor bids,
// top-ups). Minted under state.scenarioAssets so they never clash with the
// happy-path / security fixtures.
async function phaseScenarios() {
  const payer = loadPayer();
  const conn = new Connection(DEVNET, 'confirmed');
  const umi = mkUmi(payer);
  const state = loadState();
  if (!state.wallets || !state.collections) throw new Error('run `assets` phase first');

  // top up both wallets so SOL/$GBOY top-ups & escrows have headroom
  const A = Keypair.fromSecretKey(Uint8Array.from(state.wallets.A.secret));
  const B = Keypair.fromSecretKey(Uint8Array.from(state.wallets.B.secret));
  for (const kp of [A, B]) {
    const bal = await conn.getBalance(kp.publicKey);
    const target = 0.5 * LAMPORTS_PER_SOL;
    if (bal < target) {
      await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: kp.publicKey, lamports: target - bal })), [payer]);
      console.log(`✓ topped up ${kp.publicKey.toBase58()} -> 0.5 SOL`);
    }
  }

  state.scenarioAssets = state.scenarioAssets || {};
  const harmies = await fetchCollection(umi, umiPk(state.collections.harmies));
  const badges = await fetchCollection(umi, umiPk(state.collections.badges));
  async function mint(label: string, col: any, ownerPk: string, name: string) {
    if (state.scenarioAssets[label]) { console.log(`• ${label} exists`); return; }
    const sig = generateSigner(umi);
    await create(umi, { asset: sig, collection: col, owner: umiPk(ownerPk), name, uri: 'https://neuko.test/asset.json' }).sendAndConfirm(umi);
    state.scenarioAssets[label] = sig.publicKey.toString();
    saveState(state);
    console.log(`✓ ${label} (${name}) -> ${ownerPk.slice(0, 6)}…`);
  }
  // 3 harmies + 1 badge per wallet → enough for many↔one, 2↔2, top-ups, floor bids
  for (const i of [1, 2, 3]) {
    await mint(`HA${i}`, harmies, state.wallets.A.pubkey, `Harmie #20${i}0`);
    await mint(`HB${i}`, harmies, state.wallets.B.pubkey, `Harmie #30${i}0`);
  }
  await mint('BA1', badges, state.wallets.A.pubkey, 'Rabbit Badge #11');
  await mint('BB1', badges, state.wallets.B.pubkey, 'Snake Badge #12');
  console.log('\nSCENARIOS SETUP DONE.');
}

const phase = process.argv[2] || 'base';
(async () => {
  if (phase === 'base') await phaseBase();
  else if (phase === 'assets') await phaseAssets();
  else if (phase === 'scenarios') await phaseScenarios();
  else throw new Error(`unknown phase "${phase}" (use base|assets|scenarios)`);
})().catch((e) => {
  console.error('SETUP FAILED:', e);
  process.exit(1);
});
