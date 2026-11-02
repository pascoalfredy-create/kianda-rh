'use client';

import { useState } from 'react';
import { useMutation } from '@/lib/client';
import { currentFix } from '@/lib/punch-location';

export interface Workplace { id: string; name: string; latitude: number; longitude: number; radiusMeters: number; active: boolean; kioskPath: string | null }
export interface WorkplacesData {
  mode: 'off' | 'record' | 'alert' | 'block'; modes: Record<string, string>;
  workplaces: Workplace[]; employees: { id: string; name: string; number: string; workplaceId: string | null }[];
}

const osm = (w: { latitude: number; longitude: number }) => `https://www.openstreetmap.org/?mlat=${w.latitude}&mlon=${w.longitude}#map=17/${w.latitude}/${w.longitude}`;
const num = (s: string) => Number(s.replace(',', '.').trim());

export function ModeForm({ mode, modes, workplaces }: { mode: WorkplacesData['mode']; modes: Record<string, string>; workplaces: number }) {
  const { busy, error, run } = useMutation();
  const [value, setValue] = useState(mode);
  return (
    <div className="card section">
      <h2>Regra do ponto</h2>
      <form className="form" onSubmit={async (e) => { e.preventDefault(); await run('/v1/workplaces/settings', 'PUT', { mode: value }); }}>
        <div className="wide" style={{ display: 'grid', gap: 6 }}>
          {Object.entries(modes).map(([k, label]) => (
            <label key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, fontWeight: value === k ? 700 : 500 }}>
              <input type="radio" name="mode" value={k} checked={value === k} onChange={() => setValue(k as WorkplacesData['mode'])} style={{ width: 'auto' }} /> {label}
            </label>
          ))}
        </div>
        {value !== 'off' && workplaces === 0 && <p className="warn wide" style={{ margin: 0 }}>Ainda não há locais activos: as marcações guardam a posição, mas não é possível assinalar nem bloquear. Acrescente pelo menos um local.</p>}
        {value === 'block' && <p className="muted wide" style={{ margin: 0 }}>Fora do local (ou sem localização) a marcação é recusada. Em interiores onde o GPS falha, ligue o quiosque do local: o código no ecrã à entrada substitui o GPS.</p>}
        <div className="form-actions">{error && <span className="err">{error}</span>}<button className="btn" disabled={busy || value === mode}>Gravar regra</button></div>
      </form>
    </div>
  );
}

function WorkplaceForm({ initial, onDone }: { initial?: Workplace; onDone: () => void }) {
  const { busy, error, setError, run } = useMutation();
  const [name, setName] = useState(initial?.name ?? '');
  const [lat, setLat] = useState(initial ? String(initial.latitude) : '');
  const [lng, setLng] = useState(initial ? String(initial.longitude) : '');
  const [radius, setRadius] = useState(String(initial?.radiusMeters ?? 150));
  const [active, setActive] = useState(initial?.active ?? true);
  const [locating, setLocating] = useState('');
  async function here() {
    setLocating('A obter a localização…');
    const fix = await currentFix(15_000);
    if (!fix) return setLocating('Não foi possível obter a localização deste dispositivo. Escreva as coordenadas (ex.: do Google Maps).');
    setLat(fix.lat.toFixed(6)); setLng(fix.lng.toFixed(6));
    setLocating(`Posição deste dispositivo, precisão ±${Math.round(fix.accuracy)} m${fix.accuracy > 100 ? ' — fraca: confirme no mapa' : ''}.`);
  }
  return (
    <form className="form" onSubmit={async (e) => {
      e.preventDefault();
      const payload = { name, latitude: num(lat), longitude: num(lng), radiusMeters: Math.round(num(radius)), active };
      if (![payload.latitude, payload.longitude, payload.radiusMeters].every(Number.isFinite)) return setError('Coordenadas e raio têm de ser números.');
      if (await run(initial ? `/v1/workplaces/${initial.id}` : '/v1/workplaces', initial ? 'PATCH' : 'POST', payload)) onDone();
    }}>
      <label className="span2">Nome<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Estaleiro de Cafunfo" /></label>
      <label>Latitude<input required inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="-8.8125" /></label>
      <label>Longitude<input required inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="13.2302" /></label>
      <label>Raio (metros)<input required inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value)} /></label>
      <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: 'auto' }} /> Activo</label>
      <div className="wide" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn ghost sm" onClick={here}>Usar a localização deste dispositivo</button>
        {lat && lng && Number.isFinite(num(lat)) && Number.isFinite(num(lng)) && <a className="link" href={osm({ latitude: num(lat), longitude: num(lng) })} target="_blank" rel="noreferrer">Ver no mapa</a>}
        <span className="muted" style={{ fontSize: 12.5 }}>{locating || 'Entre 50 m e 5 000 m. Em estaleiros e minas use um raio que cubra toda a área de trabalho.'}</span>
      </div>
      <div className="form-actions">{error && <span className="err">{error}</span>}<button type="button" className="btn ghost" onClick={onDone}>Cancelar</button><button className="btn" disabled={busy}>{initial ? 'Gravar local' : 'Acrescentar local'}</button></div>
    </form>
  );
}

function KioskCell({ w }: { w: Workplace }) {
  const { busy, error, run } = useMutation();
  const [copied, setCopied] = useState(false);
  if (!w.kioskPath) return <div><button className="btn ghost sm" disabled={busy} onClick={() => run(`/v1/workplaces/${w.id}/kiosk`, 'POST', { enabled: true })}>Ligar quiosque</button>{error && <div className="err">{error}</div>}</div>;
  const url = typeof window !== 'undefined' ? `${window.location.origin}${w.kioskPath}` : w.kioskPath;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <a className="btn ghost sm" href={w.kioskPath} target="_blank" rel="noreferrer">Abrir quiosque</a>
      <button className="btn ghost sm" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* sem área de transferência */ } }}>{copied ? 'Copiado' : 'Copiar endereço'}</button>
      <button className="btn ghost sm" disabled={busy} onClick={() => { if (window.confirm('Gerar um endereço novo? O ecrã actual deixa de funcionar.')) void run(`/v1/workplaces/${w.id}/kiosk`, 'POST', { enabled: true }); }}>Gerar novo</button>
      <button className="btn ghost sm" disabled={busy} onClick={() => run(`/v1/workplaces/${w.id}/kiosk`, 'POST', { enabled: false })}>Desligar</button>
      {error && <span className="err">{error}</span>}
    </div>
  );
}

export function WorkplaceList({ workplaces }: { workplaces: Workplace[] }) {
  const { busy, error, run } = useMutation();
  const [editing, setEditing] = useState<string | null>(workplaces.length ? null : 'new');
  return (
    <div className="card section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px 0', gap: 10, flexWrap: 'wrap' }}><h2 className="h2-inline">Locais</h2>{editing !== 'new' && <button className="btn sm" onClick={() => setEditing('new')}>+ Novo local</button>}</div>
      {editing === 'new' && <WorkplaceForm onDone={() => setEditing(null)} />}
      {workplaces.length > 0 && (
        <table className="dense">
          <thead><tr><th>Local</th><th>Coordenadas</th><th className="num">Raio</th><th>Quiosque (código rotativo)</th><th /></tr></thead>
          <tbody>
            {workplaces.map((w) => editing === w.id
              ? <tr key={w.id}><td colSpan={5}><WorkplaceForm initial={w} onDone={() => setEditing(null)} /></td></tr>
              : (
                <tr key={w.id}>
                  <td><b>{w.name}</b>{!w.active && <span className="flag">inactivo</span>}</td>
                  <td><a className="link" href={osm(w)} target="_blank" rel="noreferrer">{w.latitude.toFixed(5)}, {w.longitude.toFixed(5)}</a></td>
                  <td className="num">{w.radiusMeters} m</td>
                  <td><KioskCell w={w} /></td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn ghost sm" onClick={() => setEditing(w.id)}>Editar</button>{' '}
                    <button className="btn ghost sm" disabled={busy} onClick={() => { if (window.confirm(`Eliminar «${w.name}»? Os colaboradores atribuídos ficam sem local; as marcações antigas conservam o nome.`)) void run(`/v1/workplaces/${w.id}`, 'DELETE'); }}>Eliminar</button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
      {error && <p className="err" style={{ padding: '0 16px' }}>{error}</p>}
      <p className="muted" style={{ padding: '0 16px 12px', fontSize: 12.5 }}>O quiosque é um ecrã à entrada (tablet ou telemóvel da portaria) que mostra um QR e um código de 6 dígitos que mudam a cada 30 segundos. Abra o endereço nesse aparelho e deixe-o ligado; quem não tiver GPS fiável marca com o código.</p>
    </div>
  );
}

export function AssignmentsForm({ employees, workplaces }: { employees: WorkplacesData['employees']; workplaces: Workplace[] }) {
  const { busy, error, run } = useMutation();
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(employees.map((e) => [e.id, e.workplaceId ?? ''])));
  const changed = employees.filter((e) => (e.workplaceId ?? '') !== values[e.id]);
  const [all, setAll] = useState('');
  return (
    <div className="card section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px 0', gap: 10, flexWrap: 'wrap' }}><h2 className="h2-inline">Local de cada colaborador</h2>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select aria-label="Atribuir a todos" value={all} onChange={(e) => setAll(e.target.value)} style={{ width: 'auto' }}><option value="">Qualquer local activo</option>{workplaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
          <button className="btn ghost sm" type="button" onClick={() => setValues(Object.fromEntries(employees.map((e) => [e.id, all])))}>Aplicar a todos</button>
        </span>
      </div>
      <table className="dense">
        <thead><tr><th>Colaborador</th><th>Local de trabalho para o ponto</th></tr></thead>
        <tbody>
          {employees.map((e) => (
            <tr key={e.id}>
              <td>{e.name} <span className="muted">n.º {e.number}</span></td>
              <td><select aria-label={`Local de ${e.name}`} value={values[e.id]} onChange={(x) => setValues({ ...values, [e.id]: x.target.value })}><option value="">Qualquer local activo</option>{workplaces.map((w) => <option key={w.id} value={w.id}>{w.name}{w.active ? '' : ' (inactivo)'}</option>)}</select></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form-actions" style={{ padding: 16 }}>
        {error && <span className="err">{error}</span>}
        <span className="muted" style={{ marginRight: 'auto', fontSize: 12.5 }}>Com um local atribuído, só esse conta. Sem local, vale qualquer local activo da empresa.</span>
        <button className="btn" disabled={busy || !changed.length} onClick={() => run('/v1/workplaces/assignments', 'PUT', { assignments: changed.map((e) => ({ employeeId: e.id, workplaceId: values[e.id] || null })) })}>Gravar {changed.length ? `(${changed.length})` : ''}</button>
      </div>
    </div>
  );
}
