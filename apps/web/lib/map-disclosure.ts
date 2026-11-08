const openedMaps = new Map<string, boolean>();
const HEADING = 'h1,h2,h3,h4,.pp-tt,.pp-h1';

/** Título mais próximo antes do mapa (documentos sem cartões: memorandos e relatórios). */
function headingBefore(table: Element, root: Element): string {
  for (let node: Element | null = table; node && node !== root; node = node.parentElement) {
    for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (sib.matches('table,.map-disclosure')) return '';
      const h = sib.matches(HEADING) ? sib : [...sib.querySelectorAll(HEADING)].pop();
      const text = h?.textContent?.replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
  }
  return '';
}
/** Sem título: as primeiras colunas do cabeçalho descrevem o mapa (ex.: «Rácio · Covenant · Projectado»). */
function headerLabel(table: HTMLTableElement): string {
  const cells = [...(table.tHead?.rows[0] ?? table.rows[0])?.cells ?? []].map(c => c.textContent?.trim() ?? '').filter(Boolean).slice(0, 3);
  return cells.length >= 2 ? cells.join(' · ') : '';
}

/** Adaptador dos dois ecrãs financeiros imperativos. Não altera dados, cálculos ou exportadores. */
export function prepareMapDisclosures(root: HTMLElement, scope: string, memory?: WorkspaceMemory) {
  for (const [index, table] of [...root.querySelectorAll('table')].entries()) {
    if (table.closest('.map-disclosure') || table.parentElement?.closest('table')) continue;
    const caption = table.caption?.textContent?.trim() || table.closest('.card')?.querySelector('h2,h3,h4')?.textContent?.trim() || headingBefore(table, root) || headerLabel(table) || `Mapa ${index + 1}`;
    const key = `${scope}:${index}:${caption}`;
    const wrapper = table.closest<HTMLElement>('.tblwrap,.table-wrap,.table-scroll');
    const target = wrapper && root.contains(wrapper) && wrapper.querySelectorAll('table').length === 1 ? wrapper : table;
    const details = document.createElement('details'), summary = document.createElement('summary'), content = document.createElement('div');
    details.className = 'map-disclosure'; content.className = 'map-content';
    for (const [text, className] of [[caption, ''], ['Ver', 'map-show'], ['Recolher', 'map-hide']]) {
      const span = document.createElement('span'); span.textContent = text!; span.className = className!; summary.append(span);
    }
    const stored = memory?.get(`map:${key}`);
    details.append(summary, content); details.open = typeof stored === 'boolean' ? stored : openedMaps.get(key) ?? false;
    details.addEventListener('toggle', () => { openedMaps.set(key, details.open); memory?.set(`map:${key}`, details.open); });
    target.before(details); content.append(target);
  }
}
import type { WorkspaceMemory } from './workspace-memory';

