const BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';
let token = null;

let mfaToken = null;
let mfaHandler = null; 
let mfaInFlight = null;

export const setToken = (t) => {
  token = t;
  if (!t) mfaToken = null;
};
export const setMfaHandler = (fn) => {
  mfaHandler = fn;
};

async function obtainMfaToken() {
  if (!mfaInFlight) {
    mfaInFlight = (async () => {
      const code = mfaHandler ? await mfaHandler() : null;
      if (!code) throw new Error('MFA code required');
      const r = await fetch(`${BASE}/mfa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: String(code).trim() }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'MFA failed');
      mfaToken = data.mfaToken;
    })().finally(() => {
      mfaInFlight = null;
    });
  }
  return mfaInFlight;
}

async function request(path, opts = {}, retried = false) {
  const { method = 'GET', body, raw = false } = opts;
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (mfaToken) headers['X-MFA-Token'] = mfaToken;
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });

  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    let data = {};
    try {
      data = await res.json();
      if (data.error) msg = data.error;
    } catch {
      /* response had no JSON body */
    }
    if (res.status === 401 && data.mfaRequired && !retried) {
      await obtainMfaToken();
      return request(path, opts, true);
    }
    const err = new Error(msg);
    err.status = res.status;
    err.mfaRequired = !!data.mfaRequired;
    throw err;
  }

  return res;
}

const json = async (path, opts) => (await request(path, opts)).json();

export const api = {
  // auth
  register: (body) => json('/auth/register', { method: 'POST', body }),
  login: (body) => json('/auth/login', { method: 'POST', body }),
  getSalt: (email) => json(`/auth/salt/${encodeURIComponent(email)}`),
  getPublicKey: (email) => json(`/auth/users/${encodeURIComponent(email)}/publickey`),

  // files
  initUpload: (body) => json('/files/init', { method: 'POST', body }),
  uploadStatus: (id) => json(`/files/${id}/status`),
  uploadPart: (id, n, bytes) =>
    request(`/files/${id}/parts/${n}`, { method: 'PUT', body: bytes, raw: true }),
  completeUpload: (id) => json(`/files/${id}/complete`, { method: 'POST', body: {} }),
  listFiles: () => json('/files'),
  fileMeta: (id) => json(`/files/${id}/meta`),
  downloadPart: async (id, n) => (await request(`/files/${id}/parts/${n}`)).arrayBuffer(),
  deleteFile: (id) => json(`/files/${id}`, { method: 'DELETE' }),

  // sharing
  share: (id, body) => json(`/share/${id}`, { method: 'POST', body }),
  shareList: (id) => json(`/share/${id}/list`),
  revoke: (id, userId) => json(`/share/${id}/${userId}`, { method: 'DELETE' }),

  rotateInit: (id, body) => json(`/share/${id}/rotate/init`, { method: 'POST', body }),
  rotatePart: (id, n, bytes) =>
  request(`/share/${id}/rotate/parts/${n}`, { method: 'PUT', body: bytes, raw: true }),
  rotateComplete: (id) => json(`/share/${id}/rotate/complete`, { method: 'POST', body: {} }),
  rotateAbort: (id) => json(`/share/${id}/rotate/abort`, { method: 'POST', body: {} }),

  search: (tokens) => json('/files/search', { method: 'POST', body: { tokens } }),
  mfaStatus: () => json('/mfa/status'),
  mfaSetup: () => json('/mfa/setup', { method: 'POST', body: {} }),
  mfaEnable: (code) => json('/mfa/enable', { method: 'POST', body: { code } }),
  mfaDisable: (code) => json('/mfa/disable', { method: 'POST', body: { code } }),

  // audit
audit: (id, before) =>
  json(`/audit/${id}?limit=20${before ? `&before=${encodeURIComponent(before)}` : ''}`),
};