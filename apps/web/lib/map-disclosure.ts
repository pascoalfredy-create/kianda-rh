const openedMaps = new Map<string, boolean>();

/** Adaptador dos dois ecrãs financeiros imperativos. Não altera dados, cálculos ou exportadores. */
export function prepareMapDisclosures(root: HTMLElement, scope: string) {
  for (const [index, table] of [...root.querySelectorAll('table')].entries()) {
    if (table.closest('.map-disclosure') || table.parentElement?.closest('table')) continue;
    const caption = table.closest('.card')?.querySelector('h2,h3,h4')?.textContent?.trim() || table.caption?.textContent?.trim() || `Mapa ${index + 1}`;
    const key = `${scope}:${index}:${caption}`;
    const wrapper = table.closest<HTMLElement>('.tblwrap,.table-wrap,.table-scroll');
    const target = wrapper && root.contains(wrapper) && wrapper.querySelectorAll('table').length === 1 ? wrapper : table;
    const details = document.createElement('details'), summary = document.createElement('summary'), content = document.createElement('div');
    details.className = 'map-disclosure'; content.className = 'map-content';
    for (const [text, className] of [[caption, ''], ['Ver', 'map-show'], ['Recolher', 'map-hide']]) {
      const span = document.createElement('span'); span.textContent = text!; span.className = className!; summary.append(span);
    }
    details.append(summary, content); details.open = openedMaps.get(key) ?? false;
    details.addEventListener('toggle', () => { openedMaps.set(key, details.open); });
    target.before(details); content.append(target);
  }
}
