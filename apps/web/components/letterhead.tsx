import { api } from '@/lib/api';

/** Papel timbrado: logotipo, denominação, morada e NIF da empresa (repete-se em cada página A4). */
export async function Letterhead() {
  const b = await api<{ name: string; nif: string; address: string | null; logo: string | null } | null>('/v1/company/branding').catch(() => null);
  if (!b) return null;
  return (
    <div className="letterhead">
      {b.logo && <img src={b.logo} alt="" />}
      <div>
        <div className="lh-name">{b.name}</div>
        <div className="lh-info">{b.address ? `${b.address}, ` : ''}NIF {b.nif}</div>
      </div>
    </div>
  );
}
