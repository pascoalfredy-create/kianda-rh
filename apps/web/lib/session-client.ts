/** Limpa as páginas pessoais e os metadados locais partilhados pelo RH e Integra. */
export async function clearOfflineData() {
  try { if ('caches' in window) await caches.delete('kianda-pages-v1'); } catch { /* armazenamento indisponível */ }
  try { navigator.serviceWorker?.controller?.postMessage('clear-pages'); } catch { /* sem service worker */ }
  try { localStorage.removeItem('kianda_me_cache'); } catch { /* sem armazenamento */ }
}

/** Só abandona a conta depois de o servidor confirmar o fim da sessão. */
export async function endSession(afterLogout: () => void = () => {}) {
  let response: Response;
  try {
    response = await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error('Não foi possível terminar a sessão. Verifique a ligação e tente novamente.');
  }
  const data = await response.json().catch(() => null);
  if (response.status !== 401 && (!response.ok || data?.ok !== true)) throw new Error(data?.message || 'O servidor não confirmou o fim da sessão. Tente novamente.');
  try { afterLogout(); } catch { /* o cookie já foi eliminado; a saída tem de continuar */ }
  await clearOfflineData();
  window.location.replace('/');
}

/** O botão Voltar não deve restaurar um ecrã privado antigo depois do logout. */
export function reloadPrivatePageOnRestore(isPrivate: () => boolean = () => true) {
  const restore = (event: PageTransitionEvent) => { if (event.persisted && isPrivate()) window.location.reload(); };
  window.addEventListener('pageshow', restore);
  return () => window.removeEventListener('pageshow', restore);
}
