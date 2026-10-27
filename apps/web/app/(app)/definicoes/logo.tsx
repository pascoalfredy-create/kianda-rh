'use client';

import { useState } from 'react';
import { useMutation } from '@/lib/client';

export function LogoForm({ current }: { current: string | null }) {
  const { busy, error, setError, run } = useMutation();
  const [preview, setPreview] = useState<string | null>(current);
  return (
    <div className="card section">
      <h2>Logotipo (papel timbrado)</h2>
      <div style={{ padding: '0 16px 16px', display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ width: 200, height: 90, border: '1px dashed var(--line)', borderRadius: 10, display: 'grid', placeItems: 'center', background: '#fafbfc' }}>
          {preview ? <img src={preview} alt="Logotipo" style={{ maxWidth: 180, maxHeight: 76, objectFit: 'contain' }} /> : <span className="muted">Sem logotipo</span>}
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <input type="file" accept="image/png,image/jpeg" onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 300_000) return setError('Imagem acima de 300 KB: reduza-a antes de carregar');
            const r = new FileReader();
            r.onload = async () => { const url = String(r.result); if (await run('/v1/company/logo', 'PUT', { dataUrl: url })) setPreview(url); };
            r.readAsDataURL(f);
          }} />
          <span className="muted">PNG ou JPEG até 300 KB. Aparece nos recibos, declarações, contratos, fecho de contas e certificados.</span>
          {preview && <button className="btn ghost sm" disabled={busy} style={{ justifySelf: 'start' }} onClick={async () => { if (await run('/v1/company/logo', 'DELETE')) setPreview(null); }}>Remover logotipo</button>}
          {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
        </div>
      </div>
    </div>
  );
}
