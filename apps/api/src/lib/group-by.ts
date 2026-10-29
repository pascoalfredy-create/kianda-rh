/** Índice local à operação: conserva a ordem e não partilha dados entre pedidos. */
export function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row), list = groups.get(k) ?? [];
    list.push(row); groups.set(k, list);
  }
  return groups;
}
