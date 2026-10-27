import { api } from '@/lib/api';

/** Papel timbrado: logotipo, denominação, NIF e morada da empresa (documentos, recibos, fecho de contas). */
export async function Letterhead() {
  const b = await api<{ name: string; nif: string; address: string | null; logo: string | null } | null>('/v1/company/branding').catch(() => null);
  if (!b) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingBottom: 12, marginBottom: 18, borderBottom: '1px solid #d9dde3' }}>
      {b.logo && <img src={b.logo} alt="" style={{ maxHeight: 64, maxWidth: 180, objectFit: 'contain' }} />}
      <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>
        <b style={{ fontSize: 14 }}>{b.name}</b>
        <div className="muted">NIF {b.nif}{b.address ? ` · ${b.address}` : ''}</div>
      </div>
    </div>
  );
}
