/**
 * Campos numéricos do Integra e do Valora com a apresentação da plataforma: milhares separados por espaço e
 * vírgula decimal ("1 600 000 000,00"). Os campos type="number" do navegador mostram "1600000000"; aqui passam
 * a texto com teclado decimal, formatados ao abrir e ao sair do campo. Anos, prazos e contagens ficam sem
 * separador de milhares.
 */
const COUNT = /(^|[._-])(ano|anobase|anos|vida|vu|horizonte|inicioop|prazo|carencia|meses|mes|m|dias|dso|dio|dpo|idade|id|pmr|pmp|pms|fecho|divm|iim|mesfer|mesnat)$/i;

export function parseNumberInput(text: string): number {
  let s = String(text ?? '').trim().replace(/[\s  ]/g, '');
  if (!s) return NaN;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
  const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
  if (comma > -1 && dot > -1) s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (comma > -1) s = s.replace(',', '.');
  else if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, '');
  const n = /^\d*\.?\d+$/.test(s) ? Number(s) : NaN;
  return negative ? -n : n;
}

export function formatNumberInput(value: number, name = ''): string {
  if (!Number.isFinite(value)) return '';
  const count = COUNT.test(name) || (Number.isInteger(value) && value >= 1900 && value <= 2199);
  const money = !count && Math.abs(value) >= 1000;
  const decimals = (String(value).split('.')[1] ?? '').length;
  const digits = money ? Math.max(2, Math.min(decimals, 6)) : Math.min(decimals, 6);
  const text = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: money ? 2 : digits, maximumFractionDigits: digits, useGrouping: count ? false : 'always' } as Intl.NumberFormatOptions).format(value);
  return text === '-0' ? '0' : text;
}

function fieldName(el: HTMLInputElement) {
  const d = el.dataset;
  return d.p || d.orc || d.k || d.var || d.w || d.cen || el.name || el.id || '';
}
function prepare(el: HTMLInputElement) {
  if (el.dataset.kiandaNumber) return;
  el.dataset.kiandaNumber = '1';
  const name = fieldName(el), raw = el.value;
  el.type = 'text'; el.inputMode = 'decimal'; el.autocomplete = 'off';
  el.classList.add('kianda-number');
  const value = Number(raw);
  if (raw !== '' && Number.isFinite(value)) el.value = formatNumberInput(value, name);
  el.addEventListener('blur', () => { const n = parseNumberInput(el.value); if (Number.isFinite(n)) el.value = formatNumberInput(n, name); });
}
/** Converte os campos existentes e os que forem desenhados depois (as vistas são redesenhadas a cada alteração). */
export function setupNumberFields(root: ParentNode = document) {
  const scan = (node: ParentNode) => node.querySelectorAll<HTMLInputElement>('input[type="number"]').forEach(prepare);
  scan(root);
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined' || !document.body) return;
  new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach((n) => { if (n.nodeType !== 1) return; const el = n as Element; if (el.matches?.('input[type="number"]')) prepare(el as HTMLInputElement); else scan(el); });
  }).observe(document.body, { childList: true, subtree: true });
}
