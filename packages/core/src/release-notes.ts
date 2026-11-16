import type { PlatformModule } from './modules.js';

export type ReleaseNoteRole = 'owner' | 'hr_admin' | 'payroll' | 'finance' | 'manager' | 'employee';

/**
 * Novidades anunciadas aos utilizadores. Cada nota só fica publicada depois de a actualização estar em produção e
 * verificada (último passo da publicação). Escrever em linguagem de utilizador: o que mudou e onde encontrar.
 * `modules` vazio = qualquer empresa; `roles` vazio = qualquer perfil. O `slug` nunca muda depois de publicado.
 */
export interface ReleaseNote {
  slug: string;
  title: string;
  body: string;
  modules: PlatformModule[];
  roles: ReleaseNoteRole[];
  url: string | null;
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    slug: '2026-11-mapa-efectividade',
    title: 'Novo: Mapa de efectividade',
    body: 'Em Relatórios passa a ter o mapa de efectividade do mês: presenças, faltas, férias, doença, licenças e feriados de cada colaborador, dia a dia, com totais e horas extra. Pode exportar para Excel e PDF ou imprimir em A4 com espaço para assinaturas.',
    modules: ['hr'],
    roles: ['owner', 'hr_admin', 'payroll', 'finance', 'manager'],
    url: '/relatorios/efectividade',
  },
];

/** Uma nota é para esta pessoa se a empresa tem o módulo e o perfil está entre os destinatários. */
export function releaseNoteFor(
  note: Pick<ReleaseNote, 'modules' | 'roles'>,
  who: { role: ReleaseNoteRole; modules: readonly PlatformModule[] },
): boolean {
  return (
    (note.modules.length === 0 || note.modules.some(m => who.modules.includes(m))) &&
    (note.roles.length === 0 || note.roles.includes(who.role))
  );
}
