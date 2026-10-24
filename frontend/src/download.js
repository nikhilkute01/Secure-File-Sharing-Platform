import { api } from './api.js';
import { unwrapFileKey } from './crypto/keys.js';
import { decryptChunk, decryptName } from './crypto/fileCrypto.js';

export async function readName(entry, session) {
  const key = await unwrapFileKey(entry, session.privateKey);
  return decryptName(key, entry.encryptedName, entry.nameIv);
}

function guessType(name) {
  const ext = name.split('.').pop().toLowerCase();
  const types = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    txt: 'text/plain',
  };
  return types[ext] || 'application/octet-stream';
}

export async function downloadAndDecrypt(fileId, session, onProgress = () => {}) {
  const meta = await api.fileMeta(fileId);
  const key = await unwrapFileKey(meta, session.privateKey);
  const name = await decryptName(key, meta.encryptedName, meta.nameIv);

  const parts = [];
  for (let i = 0; i < meta.totalChunks; i++) {
    const encrypted = await api.downloadPart(fileId, i);
    parts.push(await decryptChunk(key, new Uint8Array(encrypted), i, meta.totalChunks));
    onProgress(Math.round(((i + 1) / meta.totalChunks) * 100));
  }
  return { name, blob: new Blob(parts, { type: guessType(name) }) };
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const canStreamToDisk = () => typeof window.showSaveFilePicker === 'function';


export async function downloadToDisk(fileId, session, onProgress = () => {}) {
  const meta = await api.fileMeta(fileId);
  const key = await unwrapFileKey(meta, session.privateKey);
  const name = await decryptName(key, meta.encryptedName, meta.nameIv);

  const handle = await window.showSaveFilePicker({ suggestedName: name });
  const writable = await handle.createWritable();
  try {
    for (let i = 0; i < meta.totalChunks; i++) {
      const encrypted = await api.downloadPart(fileId, i);
      const plain = await decryptChunk(key, new Uint8Array(encrypted), i, meta.totalChunks);
      await writable.write(plain);
      onProgress(Math.round(((i + 1) / meta.totalChunks) * 100));
    }
    await writable.close();
  } catch (e) {
    await writable.abort().catch(() => {});
    throw e;
  }
  return name;
}