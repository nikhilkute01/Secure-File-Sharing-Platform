import { enc, dec, toB64, fromB64, randomBytes } from './utils.js';

export const CHUNK_SIZE = 8 * 1024 * 1024; 
export const IV_LEN = 12;

export const generateFileKey = () =>
  crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);


function aad(index, total) {
  const v = new DataView(new ArrayBuffer(8));
  v.setUint32(0, index);
  v.setUint32(4, total);
  return v.buffer;
}


export async function encryptChunk(key, plain, index, total) {
  const iv = randomBytes(IV_LEN);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(index, total) }, key, plain)
  );
  const out = new Uint8Array(IV_LEN + ct.length);
  out.set(iv, 0);
  out.set(ct, IV_LEN);
  return out;
}

export async function decryptChunk(key, data, index, total) {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: buf.slice(0, IV_LEN), additionalData: aad(index, total) },
    key,
    buf.slice(IV_LEN)
  );
}

export async function encryptName(key, name) {
  const iv = randomBytes(IV_LEN);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(name));
  return { encryptedName: toB64(ct), nameIv: toB64(iv) };
}

export async function decryptName(key, encryptedName, nameIv) {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(nameIv) },
    key,
    fromB64(encryptedName)
  );
  return dec.decode(pt);
}