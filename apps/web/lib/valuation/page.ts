import { VALUATION_ASSET_HASH, VALUATION_SHELL, VALUATION_SPACE_CSS, VALUATION_SUFFIX } from './generated';
import { luandaDate, trialDaysRemaining } from '@kianda/core';

/** Sessão entregue à interface do Valora (GET /v1/valuation/bootstrap). */
export interface ValuationSession {
  user: { id: string; name: string; role: string }; company: { id: string; name: string; nif: string };
  permission: 'editor' | 'viewer'; canWrite: boolean; formats: { pdf: boolean; docx: boolean; xlsx: boolean };
  licence: { status: string; trialEndsAt: string | null; paidUntil: string | null };
  usage: { analysisLimit: number | null; activeAnalyses: number; enabledUsers: number; userLimit: number; canCreateAnalysis: boolean; canAddUser: boolean };
  hr: { available: boolean };
  analyses: { id: string; name: string; ownCompany: boolean; revision: number; archivedAt: string | null; updatedAt: string; createdAt: string }[];
  current: { id: string; name: string; ownCompany: boolean; revision: number; archivedAt: string | null; updatedAt: string; data: Record<string, unknown> } | null;
}

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Documento independente: interface aprovada do Valora, sessão embebida e motor servido pela própria origem. */
export function valuationPage(session: ValuationSession | null, nonce: string, error?: string): string {
  let shell = VALUATION_SHELL;
  shell = shell.replace('<title>Valora — Análise Financeira e Avaliação de Activos</title>', '<title>Kianda Valora — Análise financeira e avaliação</title>');
  shell = shell.replace('</head>', `<meta name="robots" content="noindex, nofollow"><meta name="theme-color" content="#13212f"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Kianda"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icons/favicon-32.png"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><style>${VALUATION_SPACE_CSS}</style></head>`);
  shell = shell.replace('width=device-width, initial-scale=1', 'width=device-width, initial-scale=1, viewport-fit=cover');
  if (error) shell = shell.replace('<div class="wrap">', `<div class="wrap"><div class="card valora-empty" role="alert"><h3>Valora indisponível</h3><p class="intro">${escape(error)}</p><p><a class="btn" href="/modulos">Módulos e licenças</a></p></div>`);
  if (session?.licence.status === 'trial' && session.licence.trialEndsAt) {
    const until = session.licence.trialEndsAt, days = trialDaysRemaining(until, luandaDate(new Date()));
    const remaining = days === 1 ? 'Último dia de avaliação' : `Avaliação gratuita · ${days} dias de calendário, incluindo hoje`;
    shell = shell.replace('<div id="valoraBanner"', `<div class="valora-banner" role="status">${remaining} · até ${escape(until.split('-').reverse().join('/'))} inclusive, pela hora de Angola. Documentos em pré-visualização; para exportar, active uma subscrição paga. <a href="/modulos">Ver licença</a></div><div id="valoraBanner"`);
  }
  if (session && !session.formats.pdf) shell = shell.replace('</head>', '<style>@media print{body>*{display:none!important}body::after{display:block!important;content:"Pré-visualização Kianda Valora. Active uma subscrição paga para imprimir ou exportar documentos.";padding:40px;font:18px sans-serif}}</style></head>');
  if (!session) shell = shell.replace('<button class="btn pri" id="btnAnalyses">', '<button class="btn pri" id="btnAnalyses" disabled>');
  const data = JSON.stringify(session).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return shell + (session ? `<script id="valora-session" type="application/json" nonce="${escape(nonce)}">${data}</script><script defer nonce="${escape(nonce)}" src="/valuation-runtime.js?v=${VALUATION_ASSET_HASH}"></script>` : '') + VALUATION_SUFFIX;
}

export function valuationHeaders(nonce: string) {
  return { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'same-origin',
    'content-security-policy': `default-src 'self'; script-src 'self' 'nonce-${nonce}'; manifest-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'` };
}
