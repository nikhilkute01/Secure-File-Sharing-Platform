import { useState } from 'react';
import Login from './components/Login.jsx';
import Upload from './components/Upload.jsx';
import FileList from './components/FileList.jsx';

import MfaSetup from './components/MfaSetup.jsx';
import { setToken, setMfaHandler } from './api.js';

setMfaHandler(async () => window.prompt('This file requires MFA.\nEnter the 6-digit code from your authenticator app:'));

const bar = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '12px 24px',
  borderBottom: '1px solid #ddd',
  fontFamily: 'sans-serif',
};

export default function App() {
  const [session, setSession] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showMfa, setShowMfa] = useState(false);

  const logout = () => {
    setToken(null);
    setSession(null);
  };

  if (!session) return <Login onLogin={setSession} />;

  return (
    <div style={{ fontFamily: 'sans-serif' }}>
      <div style={bar}>
        <strong>SecureVault</strong>
        <span>
          {session.user.email}{' '}
          <button onClick={() => setShowMfa(true)} style={{ marginLeft: 12 }}>
            Security (MFA)
          </button>
          <button onClick={logout} style={{ marginLeft: 12 }}>
            Log out
          </button>
        </span>
      </div>

      {showMfa && <MfaSetup onClose={() => setShowMfa(false)} />}

      <div style={{ padding: 24 }}>
        <Upload session={session} onUploaded={() => setRefreshKey((k) => k + 1)} />
        <FileList session={session} refreshKey={refreshKey} />
      </div>
    </div>
  );
}