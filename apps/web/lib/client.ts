'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const FIELD_LABELS: Record<string, string> = {
  name: 'Nome', jobTitle: 'Função', number: 'Número', biNumber: 'BI', iban: 'IBAN', email: 'Email', birthDate: 'Data de nascimento',
  base: 'Salário base', meal: 'Subsídio de alimentação', transport: 'Subsídio de transporte', effectiveDate: 'Data de efeito', reason: 'Motivo',
  startDate: 'Início', endDate: 'Fim', termJustification: 'Fundamento do termo', type: 'Tipo', expiryDate: 'Validade', issueDate: 'Emissão',
};

export interface SendResult<T = unknown> { ok: boolean; data?: T; message?: string }

/** Pedido à API através do proxy /api do Next (cookie de sessão no mesmo domínio). */
export async function send<T = unknown>(path: string, method: string, body?: unknown): Promise<SendResult<T>> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return { ok: true };
  const json = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, data: json as T };
  if (res.status === 401) window.location.assign('/login');
  const issues = (json.issues as { path: string; message: string }[] | undefined)
    ?.map((i) => `${FIELD_LABELS[i.path.split('.').pop() ?? ''] ?? i.path}: ${i.message}`)
    .join(' · ');
  return { ok: false, message: issues || json.message || `Erro ${res.status}` };
}

/** Estado de um formulário que envia para a API e recarrega os dados do servidor no fim. */
export function useMutation() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run<T>(path: string, method: string, body?: unknown, onOk?: (data: T | undefined) => void) {
    setBusy(true);
    setError('');
    const r = await send<T>(path, method, body);
    setBusy(false);
    if (!r.ok) return setError(r.message ?? 'Erro'), false;
    onOk?.(r.data);
    router.refresh();
    return true;
  }
  return { busy, error, setError, run };
}

/** Converte FormData num objecto: campos vazios ficam null; campos numéricos indicados viram números. */
export function formObject(form: HTMLFormElement, numeric: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of new FormData(form).entries()) {
    const s = String(v).trim();
    out[k] = numeric.includes(k) ? (s === '' ? 0 : Number(s.replace(/\s/g, '').replace(',', '.'))) : s === '' ? null : s;
  }
  return out;
}
