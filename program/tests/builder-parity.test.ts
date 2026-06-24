/**
 * Frontend ↔ on-chain PARITY test (no devnet needed).
 *
 * The frontend (app/src/lib/program.ts) hand-rolls every instruction: hardcoded
 * 8-byte discriminators + a tiny borsh encoder. A single wrong byte would make
 * every real user transaction fail. This test imports the REAL frontend builders
 * (bundled with esbuild so Vite's `import.meta.env` resolves under Node) and
 * asserts, for every instruction:
 *   1. the discriminator matches the IDL, and
 *   2. the full instruction data matches Anchor's canonical encoding.
 *
 *   npx tsx tests/builder-parity.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { program, A, B, BN } from './_shared';

const idl = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'target', 'idl', 'neuko_market.json'), 'utf8'));
const idlDisc: Record<string, number[]> = Object.fromEntries(idl.instructions.map((i: any) => [i.name, i.discriminator]));

let pass = 0, fail = 0;
const eq = (a: Buffer | Uint8Array, b: Buffer | Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
const enc = (name: string, args: any) => Buffer.from(program.coder.instruction.encode(name, args));

(async () => {
  console.log('\nFrontend ↔ on-chain instruction parity\n');

  // Bundle the REAL frontend builder module so its Vite `import.meta.env` access
  // resolves to {} under Node; web3/spl-token stay external (program/node_modules).
  const OUT = path.resolve(process.cwd(), '.fe-program.bundle.mjs');
  await build({
    entryPoints: [path.resolve(process.cwd(), '../app/src/lib/program.ts')],
    bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
    define: { 'import.meta.env': '{}' },
    external: ['@solana/web3.js', '@solana/spl-token', 'bs58'],
  });
  const fe = await import(pathToFileURL(OUT).href);
  fs.rmSync(OUT, { force: true });

  const harmiesPk = fe.collectionAddress('harmies');
  const badgesPk = fe.collectionAddress('badges');
  const someAsset = A.publicKey;
  const someAsset2 = B.publicKey;

  // ---- 1) discriminator parity for ALL instructions (via real builders) ----
  const discCases: Array<[string, Buffer]> = [
    ['list_asset', fe.buildListIx({ seller: A.publicKey, asset: someAsset, collection: 'harmies', price: 100n, currency: 'sol' }).data],
    ['cancel_listing', fe.buildCancelListingIx({ seller: A.publicKey, asset: someAsset, collection: 'harmies' }).data],
    ['purchase_with_sol', fe.buildPurchaseSolIx({ buyer: B.publicKey, seller: A.publicKey, asset: someAsset, collection: 'harmies', maxPrice: 100n }).data],
    ['purchase_with_gboy', fe.buildPurchaseGboyIx({ buyer: B.publicKey, seller: A.publicKey, asset: someAsset, collection: 'harmies', maxPrice: 100n }).data],
    ['create_swap', fe.buildCreateSwapIx({ maker: A.publicKey, nonce: 7n, offered: [{ asset: someAsset, collection: 'badges' }], requested: [{ asset: someAsset2, collection: 'badges' }], solOffered: 0n, gboyOffered: 0n, solRequested: 0n, gboyRequested: 0n, taker: null }).data],
    ['accept_swap', fe.buildAcceptSwapIx({ taker: B.publicKey, maker: A.publicKey, nonce: 7n, requested: [{ asset: someAsset2, collection: 'badges' }], offered: [{ asset: someAsset, collection: 'badges' }], usesGboy: false }).data],
    ['cancel_swap', fe.buildCancelSwapIx({ maker: A.publicKey, nonce: 7n, offered: [{ asset: someAsset, collection: 'badges' }], usesGboy: false }).data],
    ['create_offer', fe.buildCreateOfferIx({ bidder: B.publicKey, nonce: 9n, collection: 'harmies', asset: someAsset, amount: 100n, currency: 'sol' }).data],
    ['cancel_offer', fe.buildCancelOfferIx({ bidder: B.publicKey, nonce: 9n, currency: 'sol' }).data],
    ['accept_offer', fe.buildAcceptOfferIx({ seller: A.publicKey, bidder: B.publicKey, nonce: 9n, asset: someAsset, collection: 'harmies', currency: 'sol' }).data],
  ];
  for (const [name, data] of discCases) {
    check(`discriminator ${name}`, eq(data.subarray(0, 8), Buffer.from(idlDisc[name])), `frontend=${[...data.subarray(0, 8)]} idl=${[...idlDisc[name]]}`);
  }

  // ---- 2) full-data parity vs Anchor's canonical encoder (args-carrying ix) ----
  const fullCases: Array<[string, string, Buffer, any]> = [
    ['list_asset', 'listAsset',
      fe.buildListIx({ seller: A.publicKey, asset: someAsset, collection: 'harmies', price: 1234567n, currency: 'gboy' }).data,
      { price: new BN(1234567), currency: { gboy: {} } }],
    ['purchase_with_sol', 'purchaseWithSol',
      fe.buildPurchaseSolIx({ buyer: B.publicKey, seller: A.publicKey, asset: someAsset, collection: 'harmies', maxPrice: 98765n }).data,
      { maxPrice: new BN(98765) }],
    ['purchase_with_gboy', 'purchaseWithGboy',
      fe.buildPurchaseGboyIx({ buyer: B.publicKey, seller: A.publicKey, asset: someAsset, collection: 'harmies', maxPrice: 55n }).data,
      { maxPrice: new BN(55) }],
    ['create_offer', 'createOffer',
      fe.buildCreateOfferIx({ bidder: B.publicKey, nonce: 42n, collection: 'harmies', asset: someAsset, amount: 7000n, currency: 'gboy' }).data,
      { nonce: new BN(42), args: { collection: harmiesPk, asset: someAsset, amount: new BN(7000), currency: { gboy: {} } } }],
    ['create_offer (floor)', 'createOffer',
      fe.buildCreateOfferIx({ bidder: B.publicKey, nonce: 43n, collection: 'badges', asset: null, amount: 10n, currency: 'sol' }).data,
      { nonce: new BN(43), args: { collection: badgesPk, asset: null, amount: new BN(10), currency: { sol: {} } } }],
    ['create_swap', 'createSwap',
      fe.buildCreateSwapIx({ maker: A.publicKey, nonce: 5n, offered: [{ asset: someAsset, collection: 'badges' }], requested: [{ asset: someAsset2, collection: 'harmies' }], solOffered: 1n, gboyOffered: 2n, solRequested: 3n, gboyRequested: 4n, taker: B.publicKey }).data,
      { nonce: new BN(5), args: { offeredCount: 1, requestedAssets: [someAsset2], solOffered: new BN(1), gboyOffered: new BN(2), solRequested: new BN(3), gboyRequested: new BN(4), taker: B.publicKey } }],
  ];
  for (const [label, ixName, feData, args] of fullCases) {
    let anchorData: Buffer | null = null;
    try { anchorData = enc(ixName, args); } catch (e: any) { check(`data ${label}`, false, `anchor encode failed: ${e?.message || e}`); continue; }
    check(`data ${label}`, eq(feData, anchorData), `\n     frontend=${feData.toString('hex')}\n     anchor  =${anchorData.toString('hex')}`);
  }

  console.log(`\n──────────────────────────────\n  ${pass} passed, ${fail} failed\n──────────────────────────────`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('PARITY TEST CRASHED:', e); process.exit(1); });
