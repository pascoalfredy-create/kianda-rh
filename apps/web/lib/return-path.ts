/** O destino do login tem de ser uma rota desta plataforma, mesmo com barras invertidas. */
export function returnPath(value: string | null | undefined, fallback = '/'): string {
  if (!value?.startsWith('/') || /[\\\u0000-\u0020\u007f]/.test(value)) return fallback;
  try {
    const base = 'https://kianda.invalid';
    const url = new URL(value, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch { return fallback; }
}
