import { loadSettings, requirePlatformAdmin } from '../data';
import { SettingsForm } from '../forms';

export const dynamic = 'force-dynamic';

/** Definições da plataforma: dados bancários e contactos que aparecem aos clientes, e quem administra. */
export default async function Definicoes() {
  const [, settings] = await Promise.all([requirePlatformAdmin(), loadSettings()]);
  return (
    <>
      <h1>Definições</h1>
      <p className="sub">Parâmetros comerciais mostrados aos clientes nas cobranças e no suporte.</p>
      <div className="card section">
        <h2>Parâmetros comerciais</h2>
        <SettingsForm s={settings} />
      </div>
      <div className="card section">
        <h2>Administradores da plataforma</h2>
        <ul style={{ padding: '8px 32px 16px', margin: 0 }}>
          {settings.admins.map(a => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </div>
    </>
  );
}
