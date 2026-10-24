import { useRef, useState } from 'react';
import { encryptAndUpload } from '../uploads.js';

const MAX_SIZE = 2 * 1024 * 1024 * 1024; 

const fmt = (bytes) => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
};


export default function Upload({ session, onUploaded }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [current, setCurrent] = useState(null); // { name, size }
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async (file) => {
    if (!file || busy) return;
    setError('');
    setStatus('');

    if (file.size === 0) return setError('That file is empty.');
    if (file.size > MAX_SIZE) return setError('File is larger than 2 GB.');

    setBusy(true);
    setCurrent({ name: file.name, size: file.size });
    setProgress(0);

    const t0 = performance.now();
    try {
      await encryptAndUpload(file, session, setProgress);
      const secs = (performance.now() - t0) / 1000;
      const mbps = file.size / 1024 / 1024 / secs;
      // Handy numbers for the README profiling table
      setStatus(`Done in ${secs.toFixed(1)} s (${mbps.toFixed(1)} MB/s)`);
      console.log(`Upload profile: ${fmt(file.size)} in ${secs.toFixed(1)} s = ${mbps.toFixed(1)} MB/s`);
      onUploaded && onUploaded();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    start(e.dataTransfer.files[0]);
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', width: '100%' }}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !busy && inputRef.current.click()}
        style={{
          border: `2px dashed ${dragging ? '#2563eb' : '#aaa'}`,
          background: dragging ? '#eff6ff' : '#fafafa',
          borderRadius: 8,
          padding: 32,
          minHeight: 120,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          cursor: busy ? 'not-allowed' : 'pointer',
          boxSizing: 'border-box',
        }}
      >
        <p style={{ margin: 0 }}>
          {busy ? 'Encrypting and uploading...' : 'Drag a file here, or click to choose'}
        </p>
        <p style={{ margin: '8px 0 0', fontSize: 12, color: '#777' }}>
          Encrypted in your browser before it leaves your device
        </p>
        <input
          ref={inputRef}
          type="file"
          hidden
          onChange={(e) => {
            start(e.target.files[0]);
            e.target.value = ''; // allow choosing the same file again
          }}
        />
      </div>

      {current && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
            <span>
              {current.name} ({fmt(current.size)})
            </span>
            <span>{progress}%</span>
          </div>
          <div style={{ height: 8, background: '#e5e5e5', borderRadius: 4, marginTop: 6 }}>
            <div
              style={{
                width: `${progress}%`,
                height: '100%',
                background: '#2563eb',
                borderRadius: 4,
                transition: 'width 0.2s',
              }}
            />
          </div>
        </div>
      )}

      {status && <p style={{ color: 'green', textAlign: 'center' }}>{status}</p>}
      {error && <p style={{ color: 'crimson', textAlign: 'center' }}>{error}</p>}
    </div>
  );
}