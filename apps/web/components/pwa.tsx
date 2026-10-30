'use client';

import { useEffect, useState } from 'react';
import { reloadPrivatePageOnRestore } from '@/lib/session-client';
export { clearOfflineData } from '@/lib/session-client';

interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

/**
 * App instalável: regista o service worker, mostra quando não há rede e convida a instalar no telemóvel
 * (Android: botão; iPhone: instruções "Partilhar → Adicionar ao ecrã principal").
 */
export function PwaSetup({ invite = true }: { invite?: boolean }) {
  const [offline, setOffline] = useState(false);
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const stopRestoreGuard = reloadPrivatePageOnRestore(() => !!document.querySelector('.rh-app'));
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {});
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try { dismissed = localStorage.getItem('kianda_install_dismissed') === '1'; } catch { /* sem armazenamento */ }
    const mobile = window.matchMedia('(max-width: 820px)').matches;
    if (!standalone && !dismissed && mobile && invite) {
      setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent));
      setHidden(false);
    }
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as InstallEvent); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => { stopRestoreGuard(); window.removeEventListener('online', update); window.removeEventListener('offline', update); window.removeEventListener('beforeinstallprompt', onPrompt); };
  }, [invite]);

  const dismiss = () => { setHidden(true); try { localStorage.setItem('kianda_install_dismissed', '1'); } catch { /* sem armazenamento */ } };

  return (
    <>
      {offline && <div className="offline-bar" role="status">📵 Sem rede — está a ver a última versão guardada. O ponto fica guardado no telemóvel e é enviado depois.</div>}
      {!hidden && (deferred || ios) && (
        <div className="install-bar" role="dialog" aria-label="Instalar a app">
          <img src="/icons/icon-192.png" alt="" width={36} height={36} />
          <div style={{ flex: 1 }}>
            <b>Instale a app Kianda</b>
            <div className="muted" style={{ fontSize: 12.5 }}>{ios ? <>No Safari, toque em <b>Partilhar</b> e depois em <b>Adicionar ao ecrã principal</b>.</> : 'RH e Integra no ecrã inicial, conforme os módulos da sua conta.'}</div>
          </div>
          {deferred && <button className="btn sm" onClick={async () => { await deferred.prompt(); await deferred.userChoice; setDeferred(null); dismiss(); }}>Instalar</button>}
          <button className="btn ghost sm" aria-label="Fechar" onClick={dismiss}>×</button>
        </div>
      )}
    </>
  );
}
