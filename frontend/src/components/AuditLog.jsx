import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const PAGE = 20;

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
  width: 780,
  maxWidth: '95vw',
  maxHeight: '85vh',
  overflowY: 'auto',
};
const th = { textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #ddd', fontSize: 13 };
const td = { padding: '6px 8px', borderBottom: '1px solid #eee', fontSize: 13, verticalAlign: 'top' };

const LABEL = {
  upload_init: 'Upload started',
  upload_complete: 'Upload finished',
  download: 'Downloaded',
  share: 'Shared',
  revoke: 'Revoked',
  denied: 'ACCESS DENIED',
  audit_view: 'Audit viewed',
  delete: 'Deleted',
  rotate: 'Key rotated',
  mfa_required: 'MFA required (blocked)',
  mfa_verified: 'MFA verified',
  mfa_failed: 'MFA FAILED',
  mfa_enabled: 'MFA enabled',
  mfa_disabled: 'MFA disabled',
  search: 'Search',
};

// Short, readable version of the event's extra data
function describe(e) {
  const m = e.meta || {};
  if (e.action === 'share') return `to ${m.to}${m.requireMfa ? ' (MFA required)' : ''}`;
  if (e.action === 'rotate') return `key v${m.keyVersion}`;
  if (e.action === 'revoke') return `user ${m.userId}`;
  if (e.action === 'denied') return `${m.method} ${m.path}`;
  if (e.action === 'upload_init') return `${m.totalChunks} chunk(s)`;
  return '';
}

// file = { id, name }
export default function AuditLog({ file, onClose }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (before) => {
      setLoading(true);
      setError('');
      try {
        const batch = await api.audit(file.id, before);
        setEvents((prev) => (before ? [...prev, ...batch] : batch));
        setHasMore(batch.length === PAGE);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [file.id]
  );

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = () => {
    if (events.length) load(events[events.length - 1].at);
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Activity for "{file.name}"</h3>

        {error && <p style={{ color: 'crimson' }}>{error}</p>}
        {!loading && !error && events.length === 0 && <p>No events yet.</p>}

        {events.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={th}>When</th>
                  <th style={th}>Event</th>
                  <th style={th}>User</th>
                  <th style={th}>IP</th>
                  <th style={th}>Details</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} title={e.userAgent || ''}>
                    <td style={td}>{new Date(e.at).toLocaleString()}</td>
                    <td
                      style={{
                        ...td,
                        fontWeight: e.action === 'denied' ? 700 : 400,
                        color: e.action === 'denied' ? 'crimson' : 'inherit',
                      }}
                    >
                      {LABEL[e.action] || e.action}
                    </td>
                    <td style={td}>{e.user || '-'}</td>
                    <td style={td}>{e.ip || '-'}</td>
                    
                    <td style={td}>{describe(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {loading && <p>Loading...</p>}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
          <button onClick={loadMore} disabled={loading || !hasMore}>
            Load older
          </button>
          <button onClick={onClose}>Close</button>
        </div>

        <p style={{ fontSize: 12, color: '#777' }}>
          Hover a row to see the browser (user agent). Opening this log is itself recorded as an
          "Audit viewed" event.
        </p>
      </div>
    </div>
  );
}