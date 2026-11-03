/**
 * Símbolo do Kianda: nove pontos ligados por uma linha contínua, à maneira dos desenhos «sona» (lusona) dos Cokwe da
 * Lunda — pontos marcados na areia e contornados por um só traço.
 */
export function KiandaMark({ size = 32, title = 'Kianda' }: { size?: number; title?: string | null }) {
  const dots = [11, 18, 25].flatMap(y => [11, 18, 25].map(x => [x, y] as const));
  return (
    <svg className="kianda-mark" width={size} height={size} viewBox="0 0 36 36" role={title ? 'img' : undefined} aria-label={title ?? undefined} aria-hidden={title ? undefined : true}>
      <rect width="36" height="36" rx="10" fill="#0e4a3c" />
      <g fill="#f4f1ea">{dots.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.8" />)}</g>
      <path d="M7.5 14.5 L14.5 7.5 L21.5 14.5 L28.5 7.5 M7.5 21.5 L14.5 28.5 L21.5 21.5 L28.5 28.5 M14.5 14.5 L21.5 21.5 M21.5 14.5 L14.5 21.5" fill="none" stroke="#e9a27c" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
