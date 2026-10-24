import { api } from './api.js';
import { generateFileKey, encryptChunk, encryptName, CHUNK_SIZE } from './crypto/fileCrypto.js';
import { wrapFileKey } from './crypto/keys.js';
import { indexTokens } from './crypto/search.js';

const PARALLEL = 3; // chunks uploaded at the same time
const RETRIES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function uploadWithRetry(fileId, index, bytes) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await api.uploadPart(fileId, index, bytes);
    } catch (e) {
      // 4xx errors (except 429) will not fix themselves, so do not retry them
      const fatal = e.status && e.status >= 400 && e.status < 500 && e.status !== 429;
      if (fatal || attempt >= RETRIES) throw e;
      await sleep(500 * attempt);
    }
  }
}

// session = { user, privateKey }
// onProgress receives a number from 0 to 100
export async function encryptAndUpload(file, session, onProgress = () => {}) {
  if (file.size === 0) throw new Error('Empty files cannot be uploaded');

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  // 1. Fresh random key for this file. It is generated in the browser and never sent as-is.
  const fileKey = await generateFileKey();

  // 2. Encrypt the filename and wrap the file key for ourselves (owner entry).
  const { encryptedName, nameIv } = await encryptName(fileKey, file.name);
  const wrap = await wrapFileKey(
    fileKey,
    session.privateKey,
    session.user.publicKey,
    session.user.publicKey
  );

  // Blind-index tokens so the owner can search by filename without the server seeing it.
  const searchTokens = await indexTokens(session.searchKey, file.name);

  // 3. Register the upload. The server receives only ciphertext and the wrapped key.
  const { fileId } = await api.initUpload({
    encryptedName,
    nameIv,
    size: file.size,
    chunkSize: CHUNK_SIZE,
    totalChunks,
    ...wrap,
    searchTokens,
  });

  // 4. Encrypt and upload chunks, PARALLEL at a time.
  //    Each worker reads one slice, encrypts it, uploads it, then takes the next index.
  //    At most PARALLEL chunks are held in memory at once, never the whole file.
  let next = 0;
  let done = 0;

  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= totalChunks) return;

      const slice = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const plain = await slice.arrayBuffer();
      const cipher = await encryptChunk(fileKey, plain, i, totalChunks);
      await uploadWithRetry(fileId, i, cipher);

      done++;
      onProgress(Math.round((done / totalChunks) * 100));
    }
  };

  await Promise.all(Array.from({ length: Math.min(PARALLEL, totalChunks) }, worker));

  // 5. Server checks that every part exists, then marks the file ready.
  await api.completeUpload(fileId);
  return fileId;
}