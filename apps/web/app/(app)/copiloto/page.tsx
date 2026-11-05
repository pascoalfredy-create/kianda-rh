import Link from 'next/link';
import { ReturnLink } from '@/components/context-link';
import { api, currentUser } from '@/lib/api';
import { COPILOT_MODULE_LABEL, type CopilotModule, type CopilotSetup } from '@/lib/copilot';
import { CopilotWorkspace } from './workspace';

export const dynamic = 'force-dynamic';
export default async function CopilotPage({ searchParams }: { searchParams: Promise<{ modulo?: string; projecto?: string }> }) {
  const query = await searchParams, me = await currentUser();
  const available = (['hr', 'modeling', 'valuation'] as CopilotModule[]).filter(m => me?.modules[m]?.canAccess);
  const module = available.includes(query.modulo as CopilotModule) ? query.modulo as CopilotModule : available[0];
  const setup = module ? await api<CopilotSetup>(`/v1/copilots/${module}/setup`).catch(() => null) : null;
  return <>
    <div className="page-head"><div><h1>{setup?.name ?? 'Copilotos Kianda'}</h1><p className="sub">Orientação especializada no módulo, com fontes e apoio à interpretação dos resultados.</p></div><ReturnLink className="btn ghost" fallback={module === 'modeling' ? '/modelagem' : module === 'valuation' ? '/valora' : '/'} originLabel="← Voltar ao módulo">← Voltar ao módulo</ReturnLink></div>
    <nav className="actions" aria-label="Escolher copiloto" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', marginBottom: 16 }}>{available.map(m => <Link key={m} className={`btn ${module === m ? '' : 'ghost'}`} aria-current={module === m ? 'page' : undefined} href={`/copiloto?modulo=${m}`}>{COPILOT_MODULE_LABEL[m]}</Link>)}</nav>
    {setup ? <CopilotWorkspace key={module} setup={setup} initialEntity={query.projecto?.slice(0, 128) ?? ''} /> : <p className="warn">Este copiloto exige acesso ao módulo e um lugar de utilizador activo. O proprietário pode rever os acessos em <Link href="/modulos">Módulos e licenças</Link>.</p>}
  </>;
}
