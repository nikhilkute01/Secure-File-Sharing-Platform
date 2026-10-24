import { useEffect, useState } from 'react';
import { api } from '../api.js';
import {
  readName, downloadAndDecrypt, saveBlob, downloadToDisk, canStreamToDisk,
} from '../download.js';
import ShareModal from './ShareModal.jsx';
import AuditLog from './AuditLog.jsx';
import PdfPreview from './PdfPreview.jsx';
import { queryTokens } from '../crypto/search.js';

const fmt = (bytes) => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
};

const isPdf = (name) => name.toLowerCase().endsWith('.pdf');
const LARGE = 200 * 1024 * 1024; 


export default function FileList({ session, refreshKey }) {

  const [auditing, setAuditing] = useState(null);
  const [sharing, setSharing] = useState(null);   
  const [previewing, setPreviewing] = useState(null); 

  const [files, setFiles] = useState([]); 
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(null); 
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState(null); 

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const entries = await api.listFiles();
        const items = await Promise.all(
          entries.map(async (entry) => {
            let name;
            try {
              name = await readName(entry, session);
            } catch {
              name = '(cannot decrypt name)';
            }
            return { id: entry.fileId, name, size: entry.size, role: entry.role };
          })
        );
        if (!cancelled) setFiles(items);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [session, refreshKey, reload]);

  const download = async (file) => {
    if (downloading) return;
    setError('');
    setDownloading({ id: file.id, progress: 0 });
    const onProgress = (p) => setDownloading({ id: file.id, progress: p });
    try {
      if (file.size > LARGE && canStreamToDisk()) {
        await downloadToDisk(file.id, session, onProgress); 
      } else {
        const { name, blob } = await downloadAndDecrypt(file.id, session, onProgress);
        saveBlob(blob, name);
      }
    } catch (e) {
      if (e.name !== 'AbortError') setError(`Download failed: ${e.message}`); 
    } finally {
      setDownloading(null);
    }
  };

  const remove = async (file) => {
    if (!window.confirm(`Delete "${file.name}" for everyone? This cannot be undone.`)) return;
    setError('');
    try {
      await api.deleteFile(file.id);
      setReload((n) => n + 1);
    } catch (e) {
      setError(`Delete failed: ${e.message}`);
    }
  };

  const runSearch = async (e) => {
    e.preventDefault();
    setError('');
    if (!query.trim()) return setHits(null);
    try {
      const tokens = await queryTokens(session.searchKey, query);
      if (!tokens.length) return setError('Type at least 2 letters.');
      const { ids } = await api.search(tokens);
      setHits(new Set(ids));
    } catch (err) {
      setError(`Search failed: ${err.message}`);
    }
  };
  const shown = hits ? files.filter((f) => hits.has(f.id)) : files;

  const gap = { marginLeft: 8 };

  return (
    <div style={{ maxWidth: 640, margin: '32px auto 0', width: '100%' }}>
      <h3>Your files</h3>

      <form onSubmit={runSearch} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (!e.target.value) setHits(null); }}
          placeholder="Search my uploaded files (encrypted search)"
          style={{ flex: 1, padding: 8 }}
        />
        <button>Search</button>
      </form>
      {hits && <small style={{ color: '#777' }}>{shown.length} match(es). Search covers files you uploaded.</small>}

      {loading && <p>Loading...</p>}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {!loading && shown.length === 0 && <p style={{ color: '#777' }}>No files yet.</p>}

      <ul style={{ listStyle: 'none', padding: 0 }}>
        {shown.map((f) => (
          <li
            key={f.id}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid #eee', gap: 12,
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {f.name}{' '}
              <small style={{ color: '#777' }}>({fmt(f.size)}, {f.role})</small>
            </span>
            <span style={{ whiteSpace: 'nowrap' }}>
              {isPdf(f.name) && (
                <button onClick={() => setPreviewing(f)} disabled={!!downloading}>Preview</button>
              )}
              <button onClick={() => download(f)} disabled={!!downloading} style={gap}>
                {downloading?.id === f.id ? `${downloading.progress}%` : 'Download'}
              </button>
              {f.role === 'owner' && (
                <>
                  <button onClick={() => setSharing(f)} disabled={!!downloading} style={gap}>Share</button>
                  <button onClick={() => setAuditing(f)} disabled={!!downloading} style={gap}>Activity</button>
                  <button onClick={() => remove(f)} disabled={!!downloading} style={gap}>Delete</button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>

      {sharing && <ShareModal file={sharing} session={session} onClose={() => setSharing(null)} />}
      {auditing && <AuditLog file={auditing} onClose={() => setAuditing(null)} />}
      {previewing && <PdfPreview file={previewing} session={session} onClose={() => setPreviewing(null)} />}
    </div>
  );
}