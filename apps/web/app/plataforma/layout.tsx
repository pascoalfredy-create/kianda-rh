import { PlatformShell } from '@/components/platform-shell';
import { requirePlatformAdmin } from './data';

/** A moldura e os separadores ficam montados ao mudar de ecrã: só o conteúdo volta a carregar. */
export default async function PlataformaLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin();
  return <PlatformShell current="platform">{children}</PlatformShell>;
}
