import { MODELING_ASSET_HASH, MODELING_SHELL, MODELING_SUFFIX, MODELING_SPACE_CSS } from './generated';
import type { ModelingSession } from '../../modeling/store';
import { luandaDate, trialDaysRemaining } from '@kianda/core';
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function modelingPage(session: ModelingSession | null, nonce: string, error?: string): string {
  let shell = error ? MODELING_SHELL.replace('<main class="content" id="view"></main>', `<main class="content" id="view"><div class="alert r" role="alert">${escape(error)}</div></main>`) : MODELING_SHELL;
  shell = shell.replace('</head>', `<meta name="robots" content="noindex, nofollow"><meta name="theme-color" content="#1d3557"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Kianda"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icons/favicon-32.png"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><style id="integra-space">${MODELING_SPACE_CSS}</style></head>`);
  shell = shell.replace('width=device-width, initial-scale=1', 'width=device-width, initial-scale=1, viewport-fit=cover');
  shell = shell.replace('<link href="https://fonts.googleapis.com', '<link media="print" id="integra-fonts" href="https://fonts.googleapis.com');
  shell = shell.replace('<aside class="side">', '<aside class="side" id="integra-side" aria-label="Navegação principal">');
  shell = shell.replace('<div class="logo">', '<button class="menu-close btn" data-act="closeMenu" aria-label="Fechar menu">×</button><div class="logo">');
  shell = shell.replace('</aside>', '</aside><button class="menu-shade" data-act="closeMenu" aria-label="Fechar menu" tabindex="-1"></button>');
  shell = shell.replace('<header class="top">', '<header class="top"><button class="menu-toggle btn" id="integra-menu-toggle" data-act="toggleMenu" aria-label="Abrir menu" aria-expanded="false" aria-controls="integra-side">☰</button><a class="btn modules-link" href="/modulos">Módulos e licenças</a><button type="button" class="btn" id="integra-install" hidden>Instalar Kianda</button>');
  if (session && !session.formats?.pdf) shell = shell.replace('</head>', '<style>@media print{body>*{display:none!important}body::after{display:block!important;content:"Pré-visualização Kianda Integra. Active uma subscrição paga para imprimir ou exportar documentos.";padding:40px;font:18px sans-serif}}</style></head>');
  shell = shell.replace('</header>', '<button type="button" class="btn" id="integra-logout" data-act="logout">Terminar sessão</button></header><div id="integra-session-status" class="network-status" role="alert" hidden></div>');
  if (session?.licence?.status === 'trial' && session.licence.trialEndsAt) {
    const until = session.licence.trialEndsAt, days = trialDaysRemaining(until, luandaDate(new Date()));
    const remaining = days === 1 ? 'Último dia de avaliação' : `Avaliação gratuita · ${days} dias de calendário, incluindo hoje`;
    shell = shell.replace('</header>', `</header><div class="network-status" role="status">${remaining} · até ${escape(until.split('-').reverse().join('/'))} inclusive, pela hora de Angola. Documentos apenas em pré-visualização; active uma subscrição paga para exportar ou imprimir. <a class="modules-link" href="/modulos">Ver licença</a></div>`);
  } else if (session?.licence && ['suspended', 'cancelled'].includes(session.licence.status)) {
    shell = shell.replace('</header>', '</header><div class="network-status" role="status">Módulo em consulta. Os dados guardados e a pré-visualização continuam disponíveis; para criar, alterar, exportar ou imprimir, regularize a licença com o proprietário da conta. <a class="modules-link" href="/modulos">Ver licença</a></div>');
  }
  shell = shell.replace('<span class="muted" style="font-size:12.5px">Modelo</span>', '<label for="mSel" class="muted" style="font-size:12.5px">Modelo</label>');
  shell = shell.replace('<main class="content"', '<div id="integra-network-status" class="network-status" role="status" aria-live="polite" hidden></div><main class="content"');
  if (session) shell = shell.replace('<main class="content" id="view"></main>', '<main class="content" id="view"><div class="screen-loading" role="status" aria-live="polite">A abrir a Modelagem…</div></main>');
  if (!session) shell = shell.replaceAll('<button ', '<button disabled ').replace('id="mSel"', 'id="mSel" disabled');
  const data = JSON.stringify(session).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return shell + (session ? `<script id="integra-session" type="application/json" nonce="${escape(nonce)}">${data}</script><script defer nonce="${escape(nonce)}" src="/modeling-runtime.js?v=${MODELING_ASSET_HASH}"></script>` : '') + MODELING_SUFFIX;
}
export function modelingHeaders(nonce: string) {
  return { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow', 'content-security-policy': `default-src 'self'; script-src 'self' 'nonce-${nonce}'; worker-src 'self'; manifest-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'` };
}
