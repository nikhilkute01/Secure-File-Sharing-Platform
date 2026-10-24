import { useState } from 'react';
import { api, setToken } from '../api.js';
import { buildRegistration, deriveLoginKeys, unlockPrivateKey } from '../crypto/keys.js';

const box = { maxWidth: 360, margin: '80px auto', fontFamily: 'sans-serif' };
const input = { display: 'block', width: '100%', padding: 10, marginBottom: 12, boxSizing: 'border-box' };
const btn = { width: '100%', padding: 10, cursor: 'pointer' };

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login'); 
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    if (mode === 'register' && password.length < 10) {
      return setError('Use at least 10 characters. This password protects your encryption keys.');
    }

    setBusy(true);
    try {
      if (mode === 'register') {
        
        const { body, privateKey, searchKey } = await buildRegistration(email.trim(), password);
        const res = await api.register(body);
        setToken(res.token);
        onLogin({ user: res.user, privateKey, searchKey });
      } else {
        
        const { kdfSalt, kdfIterations } = await api.getSalt(email.trim());
       
        const { authKey, wrapKey, searchKey } = await deriveLoginKeys(password, kdfSalt, kdfIterations);
      
        const res = await api.login({ email: email.trim(), authKey });
        
        const privateKey = await unlockPrivateKey(res.user, wrapKey);
        setToken(res.token);
        onLogin({ user: res.user, privateKey, searchKey });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={box}>
      <h2>SecureVault</h2>
      <p style={{ color: '#666' }}>
        {mode === 'login' ? 'Log in to your encrypted vault' : 'Create your encrypted vault'}
      </p>

      <input
        style={input}
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <input
        style={input}
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <button style={btn} disabled={busy}>
        {busy ? 'Working (deriving keys)...' : mode === 'login' ? 'Log in' : 'Register'}
      </button>

      <p style={{ textAlign: 'center', marginTop: 16 }}>
        {mode === 'login' ? 'No account? ' : 'Have an account? '}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setError('');
            setMode(mode === 'login' ? 'register' : 'login');
          }}
        >
          {mode === 'login' ? 'Register' : 'Log in'}
        </a>
      </p>

      {mode === 'register' && (
        <p style={{ fontSize: 12, color: '#888' }}>
          If you forget this password, your files cannot be recovered. That is by design: not even
          the server can decrypt them.
        </p>
      )}
    </form>
  );
}