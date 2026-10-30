interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

/** O documento do Integra é independente do layout React; partilha o manifest e o SW. */
export function setupModelingMobile(showIosInstructions: () => void) {
  if (typeof navigator === 'undefined') return;
  const button = document.querySelector<HTMLButtonElement>('#integra-install');
  const status = document.querySelector<HTMLElement>('#integra-network-status');
  if (!button || !status) return;
  const media = window.matchMedia('(display-mode: standalone)');
  const installed = () => media.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
  let deferred: InstallEvent | null = null;
  const update = () => { button.hidden = installed() || !(deferred || ios); };
  const network = () => {
    status.hidden = navigator.onLine;
    status.textContent = navigator.onLine ? '' : 'Sem ligação. Ligue-se à Internet para carregar projectos e guardar alterações.';
  };
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); deferred = event as InstallEvent; update();
  });
  window.addEventListener('appinstalled', () => { deferred = null; button.hidden = true; });
  window.addEventListener('online', network);
  window.addEventListener('offline', network);
  media.addEventListener('change', update);
  button.addEventListener('click', async () => {
    if (deferred) {
      const event = deferred; deferred = null; button.disabled = true;
      try { await event.prompt(); await event.userChoice; }
      catch { status.hidden = false; status.textContent = 'Não foi possível iniciar a instalação. Use o menu do navegador para adicionar o Kianda ao ecrã inicial.'; }
      finally { button.disabled = false; update(); }
    } else if (ios) showIosInstructions();
  });
  update(); network();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {});
}

/** Cada mapa desloca-se dentro do seu contentor, sem alargar a página no telefone. */
export function prepareFinancialTables(root: HTMLElement) {
  for (const table of root.querySelectorAll('table')) {
    let wrapper = table.closest<HTMLElement>('.tblwrap');
    if (!wrapper) {
      wrapper = document.createElement('div'); wrapper.className = 'tblwrap';
      table.before(wrapper); wrapper.append(table);
    }
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', 'Mapa financeiro — deslize para consultar todas as colunas');
  }
}
