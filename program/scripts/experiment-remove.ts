/**
 * Isolated probe: who can REMOVE a delegated owner-managed plugin in MPL Core?
 * Determines the correct fix for cancel_listing's thaw_and_release before we
 * spend SOL on another program upgrade.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Keypair } from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createSignerFromKeypair, signerIdentity, generateSigner, publicKey as umiPk } from '@metaplex-foundation/umi';
import { create, addPlugin, updatePlugin, removePlugin, fetchCollection } from '@metaplex-foundation/mpl-core';

const DEVNET = 'https://api.devnet.solana.com';
const state = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'devnet-assets.json'), 'utf8'));
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'solana', 'id.json'), 'utf8'))),
);

const umi = createUmi(DEVNET, 'confirmed');
umi.use(signerIdentity(createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(payer.secretKey))));

async function tryStep(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
    return true;
  } catch (e: any) {
    console.log(`  ✗ ${label} — ${String(e?.message || e).split('\n')[0].slice(0, 90)}`);
    return false;
  }
}

(async () => {
  const collection = await fetchCollection(umi, umiPk(state.collections.harmies));
  const asset = generateSigner(umi);
  const D = generateSigner(umi); // the "listing PDA" stand-in (delegate)

  console.log(`asset=${asset.publicKey}  delegate=${D.publicKey}  owner=${umi.identity.publicKey}\n`);
  await create(umi, { asset, collection, owner: umi.identity.publicKey, name: 'Probe', uri: 'https://neuko.test/p.json' }).sendAndConfirm(umi);
  console.log('created asset (owner = payer)');

  await tryStep('owner adds TransferDelegate (authority=D)', () =>
    addPlugin(umi, { asset: asset.publicKey, collection: collection.publicKey, plugin: { type: 'TransferDelegate', authority: { type: 'Address', address: D.publicKey } } }).sendAndConfirm(umi),
  );
  await tryStep('owner adds FreezeDelegate frozen=true (authority=D)', () =>
    addPlugin(umi, { asset: asset.publicKey, collection: collection.publicKey, plugin: { type: 'FreezeDelegate', data: { frozen: true }, authority: { type: 'Address', address: D.publicKey } } }).sendAndConfirm(umi),
  );

  console.log('\n-- thaw + remove attempts --');
  await tryStep('D thaws (updatePlugin frozen=false)', () =>
    updatePlugin(umi, { asset: asset.publicKey, collection: collection.publicKey, plugin: { type: 'FreezeDelegate', frozen: false }, authority: D }).sendAndConfirm(umi),
  );
  const dRemoves = await tryStep('D removes FreezeDelegate', () =>
    removePlugin(umi, { asset: asset.publicKey, collection: collection.publicKey, plugin: { type: 'FreezeDelegate' }, authority: D }).sendAndConfirm(umi),
  );
  if (!dRemoves) {
    await tryStep('OWNER removes FreezeDelegate', () =>
      removePlugin(umi, { asset: asset.publicKey, collection: collection.publicKey, plugin: { type: 'FreezeDelegate' } }).sendAndConfirm(umi),
    );
    await tryStep('OWNER removes TransferDelegate', () =>
      removePlugin(umi, { asset: asset.publicKey, collection: collection.publicKey, plugin: { type: 'TransferDelegate' } }).sendAndConfirm(umi),
    );
  }
  console.log('\nDONE');
})().catch((e) => {
  console.error('EXPERIMENT FAILED:', e);
  process.exit(1);
});
