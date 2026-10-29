import type { NavIcon } from '@/lib/navigation';

const paths: Record<NavIcon, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  users: 'M13 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0M2 21c0-4 3-6 7-6s7 2 7 6M16 4a4 4 0 0 1 0 8M22 21c0-3-2-5-4-5.6',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 7v5l3 2',
  cal: 'M3 5h18v16H3zM16 3v4M8 3v4M3 10h18',
  money: 'M2 6h20v12H2zM14.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0M6 12h.01M18 12h.01',
  receipt: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6',
  doc: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h6',
  brief: 'M3 7h18v13H3zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18',
  star: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  gear: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  check: 'm5 12 5 5L20 7',
  modules: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  lock: 'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  search: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0M15 15l6 6',
};
export function RhIcon({ name, size = 17 }: { name: NavIcon; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
