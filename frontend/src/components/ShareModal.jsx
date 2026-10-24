import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { unwrapFileKey, wrapFileKey } from '../crypto/keys.js';
import { fromB64 } from '../crypto/utils.js';
import { rotateFileKey } from '../rotate.js';

async function fingerprint(publicKeyB64) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', fromB64(publicKeyB64)));
  const hex = Array.from(hash.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.match(/.{4}/g).join(' ');
}

const overlay = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10,
};
const card = {
  background: '#fff',
  color: '#111',
  borderRadius: 8,
  padding: 24,
  width: 460,
  maxWidth: '90vw',
  maxHeight: '85vh',
  overflowY: 'auto',
};

export default function ShareModal({ file, session, onClose }) {
  const [people, setPeople] = useState([]);
  const [email, setEmail] = useState('');
  const [found, setFound] = useState(null); 
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [rotateProgress, setRotateProgress] = useState(null);
  const [needsRotate, setNeedsRotate] = useState(false);
  const [requireMfa, setRequireMfa] = useState(false);

  const loadPeople = useCallback(async () => {
    try {
      setPeople(await api.shareList(file.id));
    } catch (e) {
      setError(e.message);
    }
  }, [file.id]);

  useEffect(() => {
    loadPeople();
  }, [loadPeople]);

  const lookup = async () => {
    setError('');
    setInfo('');
    setFound(null);
    if (!email.trim()) return;
    setBusy(true);
    try {
      const u = await api.getPublicKey(email.trim());
      setFound({ ...u, fp: await fingerprint(u.publicKey) });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Step 2: re-wrap the file key for the recipient and send only the wrapped copy.
  const share = async () => {
    setError('');
    setInfo('');
    setBusy(true);
    try {
      const meta = await api.fileMeta(file.id);
      const fileKey = await unwrapFileKey(meta, session.privateKey);
      const wrap = await wrapFileKey(
        fileKey,
        session.privateKey,
        session.user.publicKey,
        found.publicKey
      );
      await api.share(file.id, { recipientEmail: found.email, requireMfa, ...wrap });
      setInfo(`Shared with ${found.email}.`);
      setFound(null);
      setEmail('');
      await loadPeople();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (p) => {
    if (!window.confirm(`Revoke access for ${p.email}?`)) return;
    setError('');
    setInfo('');
    setBusy(true);
    try {
      const res = await api.revoke(file.id, p.userId);
      setInfo(res.note || 'Access revoked.');
      setNeedsRotate(true);
      await loadPeople();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };


  const rotate = async () => {
    if (!window.confirm('Re-encrypt this file with a new key? Keep this window open until it finishes.')) return;
    setError('');
    setInfo('');
    setBusy(true);
    setRotateProgress(0);
    try {
      await rotateFileKey(file.id, session, setRotateProgress);
      setNeedsRotate(false);
      setInfo('Done. The file now uses a new key. Keys saved earlier no longer open it.');
    } catch (e) {
      setError(`Rotation failed: ${e.message}`);
    } finally {
      setBusy(false);
      setRotateProgress(null);
    }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Share "{file.name}"</h3>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="email"
            placeholder="Recipient email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setFound(null);
            }}
            style={{ flex: 1, padding: 8 }}
          />
          <button onClick={lookup} disabled={busy || !email.trim()}>
            Look up
          </button>
        </div>

        {found && (
          <div style={{ background: '#f4f4f5', padding: 12, borderRadius: 6, marginTop: 12 }}>
            <div>
              <strong>{found.email}</strong>
            </div>
            <div style={{ fontSize: 12, color: '#555', margin: '6px 0' }}>
              Key fingerprint: <code>{found.fp}</code>
              <br />
              Ask them to confirm this matches what they see, to be sure the key is really theirs.
            </div>
            <label style={{ display: 'block', fontSize: 13, margin: '6px 0' }}>
              <input type="checkbox" checked={requireMfa} onChange={(e) => setRequireMfa(e.target.checked)} />{' '}
              Restricted share: require MFA code to open (recipient must have MFA on)
            </label>
            <button onClick={share} disabled={busy}>
              Share as viewer
            </button>
          </div>
        )}

        {error && <p style={{ color: 'crimson' }}>{error}</p>}
        {info && <p style={{ color: 'green' }}>{info}</p>}

        <h4>People with access</h4>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {people.map((p) => (
            <li
              key={p.userId}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 0',
                borderBottom: '1px solid #eee',
              }}
            >
              <span>
                {p.email} <small style={{ color: '#777' }}>({p.role}{p.requireMfa ? ', MFA required' : ''})</small>
              </span>
              {p.role !== 'owner' && (
                <button onClick={() => revoke(p)} disabled={busy}>
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>

        <div
  style={{
    marginTop: 16,
    padding: 12,
    borderRadius: 6,
    background: needsRotate ? '#fef3c7' : '#f4f4f5',
  }}
>
  <div style={{ fontSize: 13 }}>
    {needsRotate
      ? 'Access was revoked, but that person may still hold the old key. Rotate the key to lock it out.'
      : 'Rotating re-encrypts the file with a new key for everyone who still has access.'}
  </div>
  <button onClick={rotate} disabled={busy} style={{ marginTop: 8 }}>
    {rotateProgress !== null ? `Re-encrypting... ${rotateProgress}%` : 'Rotate key (re-encrypt file)'}
  </button>
</div>

        <div style={{ textAlign: 'right', marginTop: 16 }}>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}