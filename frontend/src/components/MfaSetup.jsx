import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api.js';

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 };
const card = { background: '#fff', color: '#111', borderRadius: 8, padding: 24, width: 420, maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto' };


export default function MfaSetup({ onClose }) {
  const [enabled, setEnabled] = useState(null);
  const [setup, setSetup] = useState(null); 
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.mfaStatus().then((r) => setEnabled(r.enabled)).catch((e) => setError(e.message));
  }, []);

  const run = async (fn) => {
    setError(''); setInfo(''); setBusy(true);
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const start = () => run(async () => {
    const s = await api.mfaSetup();
    setSetup({ ...s, qr: await QRCode.toDataURL(s.otpauth, { width: 200, margin: 1 }) });
  });
  const enable = () => run(async () => {
    await api.mfaEnable(code.trim());
    setEnabled(true); setSetup(null); setCode(''); setInfo('MFA is now on.');
  });
  const disable = () => run(async () => {
    await api.mfaDisable(code.trim());
    setEnabled(false); setCode(''); setInfo('MFA is now off.');
  });

  return (
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Multi-factor authentication</h3>
        {enabled === null && !error && <p>Loading...</p>}

        {enabled === false && !setup && (
          <>
            <p>Protect restricted shares with a 6-digit code from an authenticator app (Google Authenticator, Authy, 1Password...).</p>
            <button onClick={start} disabled={busy}>Set up MFA</button>
          </>
        )}

        {setup && (
          <>
            <p>1. Scan this QR code with your authenticator app:</p>
            <img src={setup.qr} alt="MFA QR code" width={200} height={200} />
            <p style={{ fontSize: 12 }}>Or type this key: <code>{setup.secret}</code></p>
            <p>2. Enter the 6-digit code it shows:</p>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} placeholder="123456" style={{ padding: 8 }} />{' '}
            <button onClick={enable} disabled={busy || code.length !== 6}>Turn on</button>
          </>
        )}

        {enabled === true && (
          <>
            <p style={{ color: 'green' }}>MFA is ON for your account.</p>
            <p style={{ fontSize: 13 }}>To turn it off, enter a current code:</p>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} placeholder="123456" style={{ padding: 8 }} />{' '}
            <button onClick={disable} disabled={busy || code.length !== 6}>Turn off</button>
          </>
        )}

        {error && <p style={{ color: 'crimson' }}>{error}</p>}
        {info && <p style={{ color: 'green' }}>{info}</p>}
        <div style={{ textAlign: 'right', marginTop: 16 }}><button onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}