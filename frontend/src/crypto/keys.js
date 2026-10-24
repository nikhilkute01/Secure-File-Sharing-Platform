import { enc, toB64, fromB64, randomBytes } from './utils.js';

export const KDF_ITERATIONS = 600000;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };

const hkdfParams = (info) => ({
  name: 'HKDF',
  hash: 'SHA-256',
  salt: new Uint8Array(32),
  info: enc.encode(info),
});


export async function deriveLoginKeys(password, saltB64, iterations = KDF_ITERATIONS) {
  const pw = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const master = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations },
    pw,
    256
  );
  const hkdf = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits', 'deriveKey']);

  const authBits = await crypto.subtle.deriveBits(hkdfParams('securevault-auth-v1'), hkdf, 256);
  const wrapKey = await crypto.subtle.deriveKey(
    hkdfParams('securevault-wrap-v1'),
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  const searchKey = await crypto.subtle.deriveKey(
    hkdfParams('securevault-search-v1'),
    hkdf,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign']
  );
  return { authKey: toB64(authBits), wrapKey, searchKey };
}

async function importPrivate(pkcs8) {
  return crypto.subtle.importKey('pkcs8', pkcs8, ECDH, false, ['deriveBits']);
}

export async function buildRegistration(email, password) {
  const kdfSalt = toB64(randomBytes(16));
  const { authKey, wrapKey, searchKey } = await deriveLoginKeys(password, kdfSalt, KDF_ITERATIONS);

  const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
  const publicKey = toB64(await crypto.subtle.exportKey('raw', pair.publicKey));
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);

  const iv = randomBytes(12);
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, pkcs8);

  return {
    body: {
      email,
      authKey,
      publicKey,
      wrappedPrivateKey: toB64(wrapped),
      privateKeyIv: toB64(iv),
      kdfSalt,
      kdfIterations: KDF_ITERATIONS,
    },
    privateKey: await importPrivate(pkcs8),
    searchKey,
  };
}

export async function unlockPrivateKey(user, wrapKey) {
  const pkcs8 = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(user.privateKeyIv) },
    wrapKey,
    fromB64(user.wrappedPrivateKey)
  );
  return importPrivate(pkcs8);
}

async function sharedWrapKey(myPrivateKey, theirPublicB64) {
  const theirPub = await crypto.subtle.importKey('raw', fromB64(theirPublicB64), ECDH, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: theirPub }, myPrivateKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    hkdfParams('securevault-share-v1'),
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function wrapFileKey(fileKey, myPrivateKey, myPublicB64, recipientPublicB64) {
  const raw = await crypto.subtle.exportKey('raw', fileKey);
  const wk = await sharedWrapKey(myPrivateKey, recipientPublicB64);
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wk, raw);
  return { wrappedFileKey: toB64(ct), wrapIv: toB64(iv), senderPublicKey: myPublicB64 };
}

export async function unwrapFileKey(entry, myPrivateKey) {
  const wk = await sharedWrapKey(myPrivateKey, entry.senderPublicKey);
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(entry.wrapIv) },
    wk,
    fromB64(entry.wrappedFileKey)
  );

  return crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);
}