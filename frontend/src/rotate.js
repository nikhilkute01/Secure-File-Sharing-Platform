import { api } from './api.js';
import { unwrapFileKey, wrapFileKey } from './crypto/keys.js';
import {
  generateFileKey,
  encryptChunk,
  decryptChunk,
  encryptName,
  decryptName,
} from './crypto/fileCrypto.js';


export async function rotateFileKey(fileId, session, onProgress = () => {}) {
  const meta = await api.fileMeta(fileId);
  const oldKey = await unwrapFileKey(meta, session.privateKey);
  const name = await decryptName(oldKey, meta.encryptedName, meta.nameIv);


  const people = await api.shareList(fileId); 
  const newKey = await generateFileKey();
  const { encryptedName, nameIv } = await encryptName(newKey, name);

  const wraps = [];
  for (const p of people) {
    const publicKey =
      p.role === 'owner' ? session.user.publicKey : (await api.getPublicKey(p.email)).publicKey;
    const wrap = await wrapFileKey(newKey, session.privateKey, session.user.publicKey, publicKey);
    wraps.push({ userId: p.userId, ...wrap });
  }

  await api.rotateInit(fileId, { encryptedName, nameIv, wraps });

  try {
    
    for (let i = 0; i < meta.totalChunks; i++) {
      const encrypted = await api.downloadPart(fileId, i);
      const plain = await decryptChunk(oldKey, new Uint8Array(encrypted), i, meta.totalChunks);
      const fresh = await encryptChunk(newKey, plain, i, meta.totalChunks);
      await api.rotatePart(fileId, i, fresh);
      onProgress(Math.round(((i + 1) / meta.totalChunks) * 100));
    }

    // 4. Server swaps everything in one step.
    await api.rotateComplete(fileId);
  } catch (e) {
    await api.rotateAbort(fileId).catch(() => {}); 
    throw e;
  }
}