import { type CompanyModulesOverview } from '@kianda/core';
import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';

/** Dados e regras partilhados pelos ecrãs da consola da plataforma. */
export async function requirePlatformAdmin() {
  const me = await currentUser();
  if (!me) redirect('/login?area=plataforma');
  if (!me.platformAdmin) redirect('/');
  if (me.user.requiresEmailVerification) redirect('/confirmar-email');
  return me;
}

export interface Co {
  registrationReviewReasons: string[];
  registrationDataIssues: string[];
  id: string;
  name: string;
  nif: string;
  sectorLabel: string | null;
  code: string | null;
  createdAt: string | null;
  owner: { email: string; name: string } | null;
  activeEmployees: number;
  status: string;
  statusLabel: string;
  tierKey: string | null;
  tierLabel: string;
  cycle: string | null;
  limit: number | null;
  trialEndsAt: string | null;
  paidUntil: string | null;
  notes: string | null;
  monthlyMinor: number | null;
  pendingPayments: number;
  modules: CompanyModulesOverview;
}
export interface Pay {
  id: string;
  number: string;
  company: string;
  nif: string;
  kind: string;
  tierKey: string | null;
  cycle: string | null;
  seats: number | null;
  projectLimit: number | null;
  extraUsers: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  amountMinor: number;
  payerReference: string | null;
  payerNote: string | null;
  createdAt: string;
  gatewayEntity: string | null;
  gatewayReference: string | null;
  gatewayError: string | null;
}
export interface Integrations {
  status: {
    proxypay: { enabled: boolean; environment: string | null; entity: string | null };
    email: { enabled: boolean; from: string | null };
    vendus: { enabled: boolean; mode: string | null };
    baseUrl: string | null;
    files?: { mode: string; count: number; bytes: number };
  };
  invoicing: {
    autoIssue: boolean;
    taxId: 'NOR' | 'ISE';
    exemptionCode: string | null;
    exemptionLaw: string | null;
    paymentMethodId: number | null;
    registerId: number | null;
  };
  events: {
    id: string;
    externalId: string;
    reference: string | null;
    amountMinor: number | null;
    outcome: string;
    message: string | null;
    createdAt: string;
  }[];
  emails: {
    id: string;
    toAddress: string;
    subject: string;
    kind: string;
    status: string;
    error: string | null;
    createdAt: string;
  }[];
  invoiceIssues: { id: string; number: string; error: string | null; company: string }[];
}
export const OUTCOME: Record<string, string> = {
  applied: 'Aplicado',
  duplicate: 'Repetido',
  unmatched: 'Sem pedido',
  amount_mismatch: 'Montante diferente',
  not_pending: 'Pedido já tratado',
  retired_request: 'Cobrança descontinuada',
};
export const MAIL: Record<string, string> = { sent: 'st approved', skipped: 'tag', failed: 'st rejected' };
export const when = (d: string) =>
  new Date(d).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda', dateStyle: 'short', timeStyle: 'short' });
export const pt = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—');
export const ST: Record<string, string> = {
  trial: 'st pending',
  active: 'st approved',
  past_due: 'st pending',
  suspended: 'st rejected',
  cancelled: 'tag',
};

export interface Summary {
  total: number;
  trial: number;
  active: number;
  pastDue: number;
  suspended: number;
  mrrMinor: number;
  mrrByModule: Record<'hr' | 'modeling' | 'valuation', number>;
  modules: Record<'hr' | 'modeling' | 'valuation', { trial: number; active: number; pastDue: number }>;
}
export interface Settings {
  bank: { holder: string; bankName: string; iban: string } | null;
  supportEmail: string | null;
  supportPhone: string | null;
  admins: string[];
}

export const loadCompanies = () => api<{ companies: Co[]; summary: Summary }>('/v1/platform/companies');
export const loadPayments = () => api<Pay[]>('/v1/platform/payment-requests');
export const loadSettings = () => api<Settings>('/v1/platform/settings');
export const loadIntegrations = () => api<Integrations>('/v1/platform/integrations');

/** O RH guarda o estado na própria empresa; os outros módulos, em `modules`. */
export const hrModule = (c: Co) => ({
  subscribed: c.modules.hr.subscribed,
  status: c.status,
  trialEndsAt: c.trialEndsAt,
  paidUntil: c.paidUntil,
});

/** Estado de um módulo de uma empresa, numa linha: «Pago até 31/12/2026», «Experimental até …» ou «Não subscrito». */
export function moduleState(m: {
  subscribed: boolean;
  status: string;
  trialEndsAt: string | null;
  paidUntil: string | null;
}) {
  if (!m.subscribed) return { cls: 'tag', label: 'Não subscrito', until: '' };
  if (m.status === 'trial') return { cls: ST.trial!, label: 'Experimental', until: `até ${pt(m.trialEndsAt)}` };
  return {
    cls: ST[m.status] ?? 'tag',
    label: STATUS_LABEL[m.status] ?? m.status,
    until: m.paidUntil ? `até ${pt(m.paidUntil)}` : '',
  };
}
const STATUS_LABEL: Record<string, string> = {
  active: 'Paga',
  past_due: 'Em atraso',
  suspended: 'Suspensa',
  cancelled: 'Cancelada',
};

/** Pontos que pedem acção da administração, com a ligação para o ecrã onde se resolvem. */
export function attention(companies: Co[], pays: Pay[], integ: Integrations) {
  const review = companies.filter(c => c.registrationReviewReasons.length > 0).length;
  const ownerData = companies.filter(c => c.registrationDataIssues.length > 0).length;
  const failed = integ.emails.filter(e => e.status === 'failed').length;
  return [
    {
      n: pays.filter(p => p.kind !== 'extra_seats').length,
      label: 'pagamento(s) por confirmar',
      href: '/plataforma/pagamentos',
    },
    { n: review, label: 'cadastro(s) em revisão', href: '/plataforma/empresas?ver=revisao' },
    {
      n: ownerData,
      label: 'empresa(s) com dados do proprietário por confirmar',
      href: '/plataforma/empresas?ver=revisao',
    },
    {
      n: integ.invoiceIssues.length,
      label: 'pagamento(s) sem factura emitida',
      href: '/plataforma/pagamentos#sem-factura',
    },
    { n: failed, label: 'email(s) que falharam', href: '/plataforma/emails' },
  ].filter(a => a.n > 0);
}
