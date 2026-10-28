import { MODELING_ASSET_HASH, MODELING_SHELL, MODELING_SUFFIX, MODELING_SPACE_CSS } from './generated';
import type { ModelingSession } from '../../modeling/store';
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function modelingPage(session: ModelingSession | null, nonce: string, error?: string): string {
  let shell = error ? MODELING_SHELL.replace('<main class="content" id="view"></main>', `<main class="content" id="view"><div class="alert r" role="alert">${escape(error)}</div></main>`) : MODELING_SHELL;
  shell = shell.replace('</head>', `<style id="integra-space">${MODELING_SPACE_CSS}</style></head>`);
  if (!session) shell = shell.replaceAll('<button ', '<button disabled ').replace('id="mSel"', 'id="mSel" disabled');
  const data = JSON.stringify(session).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return shell + (session ? `<script id="integra-session" type="application/json" nonce="${escape(nonce)}">${data}</script><script defer nonce="${escape(nonce)}" src="/modeling-runtime.js?v=${MODELING_ASSET_HASH}"></script>` : '') + MODELING_SUFFIX;
}
export function modelingHeaders(nonce: string) {
  return { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': `default-src 'self'; script-src 'self' 'nonce-${nonce}'; worker-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'` };
}
