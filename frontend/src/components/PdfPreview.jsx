import { useEffect, useState } from 'react';
import { downloadAndDecrypt } from '../download.js';

const MAX_PREVIEW = 100 * 1024 * 1024; 

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};
const box = {
  background: '#fff', borderRadius: 8, width: 'min(900px, 94vw)', height: '90vh',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
};


export default function PdfPreview({ file, session, onClose }) {
  const [url, setUrl] = useState(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;

    (async () => {
      if (file.size > MAX_PREVIEW) {
        setError('This file is too large to preview. Please download it instead.');
        return;
      }
      try {
        const { blob } = await downloadAndDecrypt(file.id, session, (p) => !cancelled && setProgress(p));
        if (cancelled) return;
        const pdf = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
        objectUrl = URL.createObjectURL(pdf);
        setUrl(objectUrl);
      } catch (e) {
        if (!cancelled) setError(`Could not decrypt this file: ${e.message}`);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl); 
    };
  }, [file, session]);

  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid #ddd' }}>
          <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</strong>
          <button onClick={onClose}>Close</button>
        </div>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {error && <p style={{ color: 'crimson', padding: 16 }}>{error}</p>}
          {!error && !url && <p>Decrypting in your browser... {progress}%</p>}
          {url && <iframe src={url} title={file.name} style={{ width: '100%', height: '100%', border: 0 }} />}
        </div>
      </div>
    </div>
  );
}