'use client';

import { useEffect, useState } from 'react';
import { currentSubscription, disablePush, enablePush, pushSupport, type PushSupport } from '@/lib/push-client';

const TEXT: Record<Exclude<PushSupport, 'ok'>, string> = {
  unsupported: 'Este navegador não recebe notificações. No telemóvel, use o Chrome (Android) ou adicione o Kianda ao ecrã principal (iPhone).',
  'ios-install': 'No iPhone, as notificações funcionam com o Kianda no ecrã principal: toque em Partilhar → «Adicionar ao ecrã principal», abra o Kianda a partir do ícone e volte aqui.',
  denied: 'As notificações estão bloqueadas para o Kianda neste navegador. Autorize-as nas definições do site e volte aqui.',
};

/** Activar/desactivar avisos neste dispositivo, com envio de teste. compact: faixa de convite no painel. */
export function PushSettings({ compact = false }: { compact?: boolean }) {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const s = pushSupport(); setSupport(s);
    void currentSubscription().then((sub) => {
      setOn(!!sub);
      let dismissed = false;
      try { dismissed = localStorage.getItem('kianda_push_dismissed') === '1'; } catch { /* sem armazenamento */ }
      setHidden(compact && (!!sub || dismissed || s === 'unsupported' || s === 'denied'));
    }).catch(() => setHidden(compact));
  }, [compact]);

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true); setMsg('');
    try { await fn(); setMsg(done); } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
    setOn(!!(await currentSubscription().catch(() => null)));
  };
  const test = async () => { setBusy(true); const r = await fetch('/api/v1/push/test', { method: 'POST' }); setBusy(false); setMsg(r.ok ? 'Aviso de teste enviado: deve chegar dentro de segundos.' : 'Não foi possível enviar o teste.'); };

  if (support === null) return null;
  if (compact) {
    if (hidden) return null;
    return (
      <div className="warn" role="status" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ flex: 1, minWidth: 200 }}>{support === 'ok' ? 'Receba no telemóvel os avisos de férias, recibos, despesas e documentos.' : TEXT[support]}</span>
        {support === 'ok' && !on && <button className="btn sm" disabled={busy} onClick={() => run(enablePush, 'Notificações activas neste dispositivo.')}>Activar notificações</button>}
        <button className="btn ghost sm" onClick={() => { setHidden(true); try { localStorage.setItem('kianda_push_dismissed', '1'); } catch { /* sem armazenamento */ } }}>{on ? 'Fechar' : 'Agora não'}</button>
        {msg && <span className="muted" style={{ width: '100%' }}>{msg}</span>}
      </div>
    );
  }
  return (
    <div className="card section" style={{ maxWidth: 620 }}>
      <h2>Notificações no telemóvel</h2>
      <div style={{ padding: '4px 16px 16px', display: 'grid', gap: 10 }}>
        <p className="muted" style={{ margin: 0 }}>Avisos neste dispositivo quando um pedido de férias ou de despesas é decidido, quando há um pedido da sua equipa para decidir, quando o recibo fica disponível e quando há documentos para aceitar. O aviso não mostra valores nem motivos: o conteúdo abre-se no Kianda, com sessão.</p>
        {support !== 'ok' ? <p style={{ margin: 0 }}>{TEXT[support]}</p> : <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <b>{on ? 'Activas neste dispositivo' : 'Desactivadas neste dispositivo'}</b>
          {on ? <>
            <button className="btn sm" disabled={busy} onClick={test}>Enviar aviso de teste</button>
            <button className="btn ghost sm" disabled={busy} onClick={() => run(disablePush, 'Notificações desactivadas neste dispositivo.')}>Desactivar</button>
          </> : <button className="btn sm" disabled={busy} onClick={() => run(enablePush, 'Notificações activas neste dispositivo.')}>Activar notificações</button>}
        </div>}
        {msg && <p className="muted" role="status" style={{ margin: 0 }}>{msg}</p>}
      </div>
    </div>
  );
}
