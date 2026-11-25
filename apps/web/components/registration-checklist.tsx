'use client';

import { useState } from 'react';
import { useMutation } from '@/lib/client';
import { STATUS, statusLabel, type RegistrationCheck, type RegistrationData } from '@/lib/registration';

export type { RegistrationCheck, RegistrationData } from '@/lib/registration';

/** Uma linha da lista: estado, motivo e, para quem pode corrigir, o campo de correcção. */
function CheckRow({
  item,
  data,
  companyName,
}: {
  item: RegistrationCheck;
  data: RegistrationData;
  companyName: string;
}) {
  const { busy, error, run } = useMutation();
  const [done, setDone] = useState('');
  const editable = data.canEdit && item.status !== 'ok';
  const proof =
    item.key === 'nif' && data.supportEmail
      ? `mailto:${data.supportEmail}?subject=${encodeURIComponent(`Comprovativo do NIF — ${companyName}`)}&body=${encodeURIComponent(`Envio em anexo o comprovativo do NIF ${item.value ?? ''} da empresa ${companyName}.`)}`
      : null;
  return (
    <div className="reg-row" data-check={item.key}>
      <div className="reg-head">
        <div>
          <b>{item.label}</b>
          {item.value && <span className="muted"> · {item.value}</span>}
          {item.message && <p className="muted reg-msg">{item.message}</p>}
        </div>
        <span className="reg-pills">
          <span className={`st ${STATUS[item.status][0]}`}>{statusLabel(item)}</span>
          {item.blocking && item.status !== 'ok' && <span className="st rejected">Bloqueia o acesso</span>}
        </span>
      </div>
      {done ? (
        <p className="ok reg-msg">{done}</p>
      ) : (
        editable && (
          <>
            {item.key === 'nif' && data.inReview && (
              <form
                className="reg-act"
                onSubmit={e => {
                  e.preventDefault();
                  const nif = String(new FormData(e.currentTarget).get('nif') ?? '');
                  void run<{ resolved: boolean }>('/v1/registration/nif', 'POST', { nif }, r =>
                    setDone(
                      r?.resolved
                        ? 'NIF corrigido. O cadastro ficou confirmado e os módulos já estão disponíveis.'
                        : 'NIF corrigido.',
                    ),
                  );
                }}
              >
                <input
                  name="nif"
                  aria-label="NIF correcto"
                  defaultValue={item.value ?? ''}
                  inputMode="numeric"
                  maxLength={10}
                  required
                  style={{ width: 150 }}
                />
                <button className="btn sm" disabled={busy}>
                  Corrigir NIF
                </button>
                {proof ? (
                  <a className="btn ghost sm" href={proof}>
                    Enviar comprovativo ao suporte
                  </a>
                ) : (
                  <span className="muted">Se o NIF estiver correcto, envie o comprovativo ao suporte Kianda.</span>
                )}
              </form>
            )}
            {(item.key === 'companyName' || item.key === 'ownerName') && (
              <form
                className="reg-act"
                onSubmit={e => {
                  e.preventDefault();
                  const name = String(new FormData(e.currentTarget).get('name') ?? '');
                  void run<{ resolved: boolean }>(
                    item.key === 'companyName' ? '/v1/registration/company-name' : '/v1/registration/owner-name',
                    'POST',
                    { name },
                    r => setDone(r?.resolved ? 'Nome corrigido. O cadastro ficou confirmado.' : 'Nome corrigido.'),
                  );
                }}
              >
                <input
                  name="name"
                  aria-label={item.key === 'companyName' ? 'Denominação real da empresa' : 'Nome completo'}
                  placeholder={item.key === 'companyName' ? 'Lunda Serviços, Lda' : 'Ana Mateus'}
                  required
                  minLength={2}
                  style={{ width: 240 }}
                />
                <button className="btn sm" disabled={busy}>
                  Corrigir nome
                </button>
              </form>
            )}
            {item.key === 'ownerEmail' && (
              <form
                className="reg-act"
                onSubmit={e => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run<{ email: string }>(
                    '/v1/registration/email',
                    'POST',
                    { email: f.get('email'), password: f.get('password') },
                    r =>
                      setDone(
                        `Enviámos uma ligação de confirmação para ${r?.email ?? 'o novo email'}. Até a confirmar, continua a entrar com o email actual.`,
                      ),
                  );
                }}
              >
                <input
                  name="email"
                  type="email"
                  aria-label="Novo email"
                  placeholder="ana.mateus@lundaservicos.ao"
                  required
                  style={{ width: 240 }}
                />
                <input
                  name="password"
                  type="password"
                  aria-label="Palavra-passe actual"
                  placeholder="Palavra-passe actual"
                  autoComplete="current-password"
                  required
                  style={{ width: 180 }}
                />
                <button className="btn sm" disabled={busy}>
                  {item.status === 'pending' ? 'Usar outro email' : 'Alterar email'}
                </button>
              </form>
            )}
            {item.key === 'review' && (
              <p className="muted reg-msg">
                {data.supportEmail ? (
                  <a href={`mailto:${data.supportEmail}`}>Escrever ao suporte</a>
                ) : (
                  'Contacte o suporte Kianda.'
                )}
                {data.supportPhone ? ` · ${data.supportPhone}` : ''}
              </p>
            )}
          </>
        )
      )}
      {error && <p className="err reg-msg">{error}</p>}
    </div>
  );
}

/** Lista de pontos do cadastro (ecrã de revisão e «A minha conta»). */
export function RegistrationChecklist({ data, companyName }: { data: RegistrationData; companyName: string }) {
  return (
    <div className="reg-list">
      {data.inReview &&
        (data.blocking ? (
          <div className="warn" role="status">
            {data.blocking === 1
              ? '1 ponto bloqueia o acesso aos módulos.'
              : `${data.blocking} pontos bloqueiam o acesso aos módulos.`}{' '}
            {data.canEdit
              ? 'Corrija-o aqui ou envie o comprovativo ao suporte.'
              : 'O proprietário principal da conta pode corrigi-lo.'}
          </div>
        ) : null)}
      {data.items.map(item => (
        <CheckRow key={item.key} item={item} data={data} companyName={companyName} />
      ))}
      {data.items.some(i => i.key === 'ownerEmail' && i.status !== 'ok') && (
        <p className="muted reg-msg">O email não bloqueia o acesso, mas deve ser corrigido.</p>
      )}
    </div>
  );
}
