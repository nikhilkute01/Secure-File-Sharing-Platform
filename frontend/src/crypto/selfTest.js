import { buildRegistration, deriveLoginKeys, unlockPrivateKey, wrapFileKey, unwrapFileKey } from './keys.js';
import { generateFileKey, encryptChunk, decryptChunk, encryptName, decryptName } from './fileCrypto.js';

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

export async function runSelfTest(log) {
  const check = (name, ok) => log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
  const fails = async (fn) => {
    try { await fn(); return false; } catch { return true; }
  };

  const alice = await buildRegistration('alice@test.com', 'alice-pass');
  const bob = await buildRegistration('bob@test.com', 'bob-pass');
  const carol = await buildRegistration('carol@test.com', 'carol-pass');

  const k = await deriveLoginKeys('alice-pass', alice.body.kdfSalt, alice.body.kdfIterations);
  check('login derives the same authKey', k.authKey === alice.body.authKey);
  await unlockPrivateKey(alice.body, k.wrapKey);
  check('correct password unlocks private key', true);

  const bad = await deriveLoginKeys('wrong-pass', alice.body.kdfSalt, alice.body.kdfIterations);
  check('wrong password cannot unlock private key', await fails(() => unlockPrivateKey(alice.body, bad.wrapKey)));

  const fileKey = await generateFileKey();
  const forBob = await wrapFileKey(fileKey, alice.privateKey, alice.body.publicKey, bob.body.publicKey);
  const bobKey = await unwrapFileKey(forBob, bob.privateKey);
  check('carol cannot unwrap the key meant for bob', await fails(() => unwrapFileKey(forBob, carol.privateKey)));

  const forSelf = await wrapFileKey(fileKey, alice.privateKey, alice.body.publicKey, alice.body.publicKey);
  const ownerKey = await unwrapFileKey(forSelf, alice.privateKey);

  const data = new Uint8Array(60000);
  for (let i = 0; i < data.length; i += 65536) {
    crypto.getRandomValues(data.subarray(i, i + 65536));
  }
  const ct = await encryptChunk(fileKey, data, 0, 3);
  check('ciphertext overhead is 28 bytes', ct.length === data.length + 28);

  const byBob = new Uint8Array(await decryptChunk(bobKey, ct, 0, 3));
  const byOwner = new Uint8Array(await decryptChunk(ownerKey, ct, 0, 3));
  check('bob decrypts the chunk', same(byBob, data));
  check('owner decrypts the chunk', same(byOwner, data));

  const tampered = ct.slice();
  tampered[40] ^= 1;
  check('tampered ciphertext is rejected', await fails(() => decryptChunk(bobKey, tampered, 0, 3)));
  check('reordered chunk is rejected', await fails(() => decryptChunk(bobKey, ct, 1, 3)));
  check('truncated file (wrong total) is rejected', await fails(() => decryptChunk(bobKey, ct, 0, 2)));

  const n = await encryptName(fileKey, 'secret-contract.pdf');
  check('filename round-trips', (await decryptName(bobKey, n.encryptedName, n.nameIv)) === 'secret-contract.pdf');

  log('Done.');
}