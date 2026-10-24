# SecureVault: zero-knowledge encrypted file sharing

SecureVault is a Dropbox-style file sharing app where files are encrypted **in the browser** before upload.
The server and its admins only ever store ciphertext, wrapped keys and metadata. They cannot read your files.

**Stack:** React (Vite) + Web Crypto API, Node.js/Express, MongoDB, local-disk storage.

---

## 1. How to run

**Requirements:** Node 20+, MongoDB running locally, Chrome or Edge.

```bash
# Backend
cd backend
cp .env.example .env
npm install
npm run dev

# Frontend
cd frontend
npm install
npm run dev
```

`backend/.env`:

| Variable | Meaning |
|---|---|
| `PORT` | API port (5000) |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Long random string; signs login and MFA tokens |
| `STORAGE` | `local` (default) |
| `CLIENT_ORIGIN` | Frontend URL allowed by CORS (`http://localhost:5173`) |

---

## 2. Evidence (screenshots)

### 2.1 Encrypted on the network
The upload request for each file chunk. `Content-Length` is **8,388,636 bytes**, which is one 8 MB chunk
(8,388,608) plus 28 bytes: a 12-byte random IV and a 16-byte AES-GCM tag. Unencrypted data would be exactly 8,388,608.
The payload is binary ciphertext.

![Chunk Content-Length](images/contentlength.png)

The `init` request and the network view of an upload. Only an encrypted filename, a wrapped file key and hashed
search tokens are sent. No real filename and no raw key.

![Network tab](images/Networktab.png)

### 2.2 What the server stores
The MongoDB `files` record. The name is ciphertext (`encryptedName`), search words are opaque tokens, and no file key
or plaintext appears. The server only sees size, chunk count and timestamps.

![Database record](images/DBstoredata.png)

### 2.3 Sharing
Sharing wraps the file key for the recipient with ECDH. The server stores only the wrapped copy. A key fingerprint is
shown so the two people can confirm the public key was not swapped.

![Sharing](images/share.png)

### 2.4 Audit log
Every access is logged with time, user, IP and details, including denied attempts.

![Audit log](images/Logs.png)

### 2.5 Performance: 1 GB upload
Target: a 1 GB upload completes in under 5 minutes.

**Result: a 1 GB file uploaded in 59.1 seconds (about 17.3 MB/s), roughly 5x faster than the 5-minute target.**

![1 GB upload](images/1GBfile.png)

| Machine / browser | File | Time | Speed | Result |
|---|---|---|---|---|
| FILL IN (CPU, RAM, Chrome version) | 1 GB (1,073,741,824 bytes) | 59.1 s | ≈ 17.3 MB/s | PASS (under 300 s) |

Integrity check: the SHA-256 of the original file and of the downloaded copy matched (`certutil -hashfile <file> SHA256`).

Memory use stays low because only about three 8 MB chunks are in memory at once. The whole file is never loaded.
Downloads over 200 MB stream straight to disk in Chrome and Edge.

---

## 3. Security notes (short version)

### 3.1 Who can read your files?
| Who | Can they read files? |
|---|---|
| Server owner or admin | No. They only see ciphertext and metadata. |
| Someone who steals the database or disk | No. They would need each user's password. |
| Someone on the network | No. Files are encrypted before leaving the browser. |
| Another logged-in user | No. The access check blocks them. |
| A user whose access was revoked | No new access. Key rotation also blocks any key they saved. |

### 3.2 How the keys work
```
password --PBKDF2 (600k iterations)--> master key
master key --HKDF--> authKey    (sent to server, used only to log in)
           --HKDF--> wrapKey    (stays in browser, protects the private key)
           --HKDF--> searchKey  (stays in browser, used for search)
each file: random AES-256 key, shared with others using ECDH P-256
```
- The server gets `authKey` only, so it can never unlock your private key.
- Every file has its own random key, so one leaked key exposes one file only.
- Sharing uses ECDH, so no password or key is ever sent through the server.
- AES-256-GCM encrypts the data and also detects any change to it.

### 3.3 Main security features
| Feature | How it works |
|---|---|
| **Chunk integrity** | Each 8 MB chunk has its own random IV, and its position is part of the authentication. Reordering, swapping or removing chunks makes decryption fail. |
| **Access control** | Every file route needs a valid JWT (401 if missing) and an ACL entry (403 if not allowed). Roles: `owner` (full control) and `viewer` (download only). A missing file and a forbidden file both return 403, so ids cannot be guessed. |
| **Revoke and rotate** | Revoking removes access at once. Rotating re-encrypts the file in the owner's browser with a new key, so an old saved key no longer works. |
| **Login protection** | Rate limits, same response time and fake salt for unknown emails, `helmet` headers, strict CORS, no stack traces in errors. |
| **Browser storage** | Tokens and keys live only in memory, never in localStorage or cookies. Refreshing the page logs you out. |
| **MFA (bonus)** | TOTP code for shares marked "Require MFA". The server checks it, not only the UI. Limited to 10 attempts per 5 minutes. |
| **Encrypted search (bonus)** | Filename words become `HMAC-SHA256` tokens in the browser, so the server never sees filenames or search words. This is a blind index, not fully homomorphic encryption. |
| **Audit log** | Records uploads, shares, denied attempts, rotations and MFA events. |

### 3.4 Storage: local disk
S3 support is implemented (`S3Driver.js`), but files are stored on local disk (`STORAGE=local`) because of server
and hosting cost. Switching to S3 needs only the `STORAGE` setting and AWS credentials. It has not been tested
against a live bucket.

### 3.5 MongoDB sharding by user
The script `backend/src/scripts/shard.mongosh.js` shards data by user. Status: script provided; not run on a cluster.

| Collection | Shard key |
|---|---|
| `files` | `{ ownerId, _id }` |
| `acls` | `{ userId, fileId }` |
| `auditevents` | `{ fileId: hashed }` |
| `users` | not sharded |

### 3.6 Known limitations
- A malicious server could swap a public key. The fingerprint shown when sharing lets users check it.
- Revoking cannot take back a file someone already downloaded.
- A lost password means lost data. There is no recovery.
- The server can see metadata: file size, chunk count, timestamps and who shared with whom.
- The audit log is not tamper-proof.
- An upload cannot resume after a page refresh. Failed chunks are retried up to 3 times.
- A script injection (XSS) attack could misuse keys held in memory.

---

## 4. How to test

1. Register three users: `test1` (owner), `test2` (recipient), `test3` (stranger).
2. **Encryption:** upload a text file. In DevTools, the chunk size is file size + 28 bytes and the data is binary.
3. **Access control:** call a file URL with test3's token to get 403, or without a token to get 401.
4. **Sharing:** share with test2. test2 can download but cannot delete, share or view the audit log.
5. **Revoke and rotate:** revoke test2, rotate the key, and check that the chunk SHA-256 changes.
6. **Integrity:** change one byte in a stored `.bin` chunk. The download fails with a decryption error.
7. **Audit:** open Activity on a file to see all events.
8. **MFA:** share with "Require MFA". Without a code the API returns 401 `mfaRequired`.
9. **Search:** upload `Secret-Contract_2026.pdf` and search `contr`. Only opaque tokens are sent.
10. **Speed:** upload a 1 GB file. Our result: 59.1 s (see section 2.5).

Crypto self-test: `cd frontend && node selfTestRun.mjs` prints PASS for key derivation, wrapping, tamper detection and chunk reordering.
