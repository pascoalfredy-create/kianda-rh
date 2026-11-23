'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CYCLES,
  SECTORS,
  DEFAULT_TIERS,
  cyclePrice,
  formatKz,
  MODELING_PLANS,
  modelingPlanPrice,
  VALUATION_PLANS,
  valuationPlanPrice,
  VALUATION_EXTRA_USER_MONTHLY_MINOR,
  type BillingCycle,
} from '@kianda/core';
import s from './public-home.module.css';
import { registrationHref } from '../lib/registration-selection';

const money = (minor: number) => formatKz(minor).replace(/\s*Kz$/, '');
const moduleContent = {
  hr: {
    shot: '/site/kianda-rh-processamento.webp',
    name: 'Kianda RH',
    heading: 'Pessoas organizadas. Gestão mais clara.',
    description:
      'Acompanhe o percurso de cada colaborador, do registo ao processamento salarial, com informação reunida na mesma conta.',
    features: [
      ['Equipa e documentos', 'Fichas, contratos e documentos dos colaboradores.'],
      ['Tempo e remunerações', 'Assiduidade, férias, salários, recibos e custos com pessoal.'],
      ['Indicadores para gerir', 'Relatórios e BI para acompanhar a equipa por departamento e local.'],
    ],
    maps: ['Colaboradores e contratos', 'Assiduidade e férias', 'Processamento salarial', 'Mapas de IRT e INSS'],
    label: 'Gestão de pessoas',
    count: 'Uma faixa fixa por dimensão da equipa',
  },
  modeling: {
    shot: '/site/kianda-integra-painel.webp',
    name: 'Kianda Integra',
    heading: 'Do pressuposto à decisão de investimento.',
    description:
      'Estruture um projecto, confronte os cenários e consulte as demonstrações financeiras antes de decidir como investir ou financiar.',
    features: [
      ['Modelo integrado', 'Investimentos, receitas, custos, dívida e fundo de maneio.'],
      ['Decisões com contexto', 'VAL, TIR, financiamento, cenários e análise de sensibilidade.'],
      ['Análise económico-financeira', 'Interprete as projecções do projecto com rácios, diagnóstico e relatórios.'],
    ],
    maps: [
      'Pressupostos e investimentos',
      'DRE, Balanço e caixa',
      'Avaliação e cenários',
      'Relatórios e análise financeira',
    ],
    label: 'Modelagem financeira',
    count: 'Projectos e sectores conforme o plano · 5 utilizadores',
  },
  valuation: {
    shot: '/site/kianda-valora-sintese.webp',
    name: 'Kianda Valora',
    heading: 'Conheça o valor da empresa. Controle o exercício.',
    description:
      'Analise a própria empresa, as participadas ou um alvo de aquisição: demonstrações financeiras, orçamento, tesouraria e avaliação na mesma análise.',
    features: [
      ['Demonstrações e rácios', 'Balanço, resultados e fluxos de caixa por PGC Angola, com rácios e diagnóstico.'],
      [
        'Orçamento e controlo',
        'Orçamento, tesouraria e desvios mensais com os dados reais, introduzidos ou importados de Excel.',
      ],
      ['Avaliação de empresas', 'Fluxos descontados, múltiplos de mercado, activos reais e síntese de valor.'],
    ],
    maps: [
      'Demonstrações financeiras',
      'Orçamento e tesouraria',
      'Controlo orçamental mensal',
      'Avaliação e relatórios PDF, Word e Excel',
    ],
    label: 'Análise e avaliação',
    count: 'Análises activas conforme o plano · 5 utilizadores',
  },
};
type ModuleKey = keyof typeof moduleContent;
const questions = [
  [
    'Como funciona o mês grátis?',
    'São 30 dias de calendário a partir da confirmação do email, incluindo esse dia e a data final indicada na conta, pela hora de Angola. Pode introduzir dados, calcular, simular e pré-visualizar documentos, dentro dos limites indicados nos módulos. Escolhe os planos e o pagamento depois de criar a conta.',
  ],
  [
    'Posso descarregar os documentos durante o teste?',
    'Durante a avaliação, os documentos ficam apenas em pré-visualização. Para descarregar ou imprimir, active uma subscrição paga do módulo. O Integra disponibiliza PDF aos clientes; os modelos Excel são exclusivos da conta do proprietário da plataforma.',
  ],
  [
    'O que acontece quando o teste termina?',
    'Sem pagamento, os dados guardados continuam disponíveis em consulta e os documentos em pré-visualização. Criar, alterar, exportar e imprimir exige uma subscrição activa. Não há cobrança automática nem eliminação dos dados no fim do teste.',
  ],
  [
    'Tenho de subscrever todos os módulos?',
    'Pode escolher RH, Integra, Valora ou vários. Partilham a mesma conta, com subscrições e permissões próprias. Sem RH, pode preencher manualmente os custos com pessoal no Integra e no Valora.',
  ],
  [
    'O que conta como uma análise no Valora?',
    'Cada entidade analisada é uma análise: a própria empresa, uma participada ou um alvo de aquisição. O plano define quantas ficam activas em simultâneo. Arquivar liberta a vaga; uma análise restaurada e arquivada de novo no mesmo mês ocupa a vaga até ao fim do mês.',
  ],
  [
    'O número de projectos limita os sectores?',
    'São limites distintos: PME inclui até 2 projectos activos e 2 sectores; Corporate inclui até 5 projectos e 4 sectores; Grandes Empresas inclui os 8 sectores. O sector principal do registo integra a selecção. Arquivar um projecto liberta uma vaga de projecto activo.',
  ],
  [
    'Posso trabalhar no telefone?',
    'Pode aceder pelo navegador do computador, tablet ou telefone e, nos navegadores compatíveis, adicionar o Kianda ao ecrã inicial. O Integra precisa de Internet para carregar os projectos e guardar as alterações.',
  ],
];

/** Ícones de traço simples (24×24) para os sectores do registo. */
const SECTOR_ICON: Record<string, string> = {
  commerce: 'M3 6h18l-2 9H6L4 3H1m6 18a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm10 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  services: 'M9 7V5a3 3 0 0 1 6 0v2M3 7h18v12H3zM3 12h18',
  construction: 'M3 20h18M5 20V10l7-5 7 5v10M9 20v-6h6v6',
  security: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Zm-3 9 2 2 4-4',
  mining: 'M14 4l6 6M4 20l9-9M11 6c3-2 6-2 9 1-3-1-6 0-8 2',
  oil_gas: 'M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11Z',
  manufacturing: 'M3 21V10l6 4V10l6 4V6h6v15H3Zm4-4h2m4 0h2',
  agriculture: 'M12 21V11m0 0c0-4 3-7 7-7 0 4-3 7-7 7Zm0 3C12 10 9 7 5 7c0 4 3 7 7 7Z',
  hospitality: 'M4 17h16M6 17a6 6 0 0 1 12 0M12 8V6m-2 0h4M3 20h18',
  health: 'M12 20s-8-4.5-8-10a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.5-8 10-8 10ZM9 11h2V9h2v2h2v2h-2v2h-2v-2H9z',
  education: 'M2 9l10-5 10 5-10 5L2 9Zm4 2v5c2 2 10 2 12 0v-5',
  transport: 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  finance: 'M3 10l9-6 9 6M5 10v8m4-8v8m6-8v8m4-8v8M3 21h18',
  telecom: 'M5 12a10 10 0 0 1 14 0M8 15a5.5 5.5 0 0 1 8 0M12 19h.01M2 8.5a15 15 0 0 1 20 0',
  ngo: 'M12 21s-7-4-7-9a3.5 3.5 0 0 1 7-1 3.5 3.5 0 0 1 7 1c0 5-7 9-7 9ZM4 21h16',
  public: 'M3 21h18M4 10h16L12 4 4 10Zm2 0v8m4-8v8m4-8v8m4-8v8',
};
const VIDEOS = [
  ['kianda-criar-conta', 'Criar a conta da empresa', 'Do registo à primeira entrada, passo a passo.'],
  [
    'kianda-processamento-completo',
    'Processamento salarial completo',
    'Do ponto ao recibo, com IRT, INSS e contabilidade.',
  ],
  ['kianda-planos', 'Planos e preços', 'RH, Integra e Valora, e o que cada plano inclui.'],
] as const;
const ABOUT = [
  [
    'Missão',
    'Dar às empresas angolanas ferramentas simples e rigorosas para gerir pessoas, preparar investimentos e conhecer o valor do negócio.',
    'M12 2v4m0 12v4M2 12h4m12 0h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  ],
  [
    'Visão',
    'Ser a referência em Angola na gestão de pessoas e na decisão financeira, e crescer depois para outros mercados.',
    'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  ],
  [
    'Valores',
    'Rigor, transparência, proximidade, segurança dos dados e melhoria contínua.',
    'M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9L12 3Z',
  ],
] as const;
const SAFETY = [
  [
    'Empresas isoladas',
    'Os dados de cada empresa ficam separados na base de dados, e os testes automáticos confirmam-no a cada publicação.',
  ],
  ['Trilho de auditoria', 'Ficam registadas as acções importantes: quem criou, alterou, aprovou ou fechou, e quando.'],
  [
    'Acessos por perfil',
    'Proprietário, RH, salários, finanças, chefias e colaboradores vêem apenas o que lhes compete.',
  ],
] as const;
const Icon = ({ d, size = 26 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}
function Check() {
  return (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="m4 10 4 4 8-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PublicHomeContent({ preview = false }: { preview?: boolean }) {
  // Contacto de suporte da consola da plataforma, pedido depois de a página abrir (o conteúdo público não depende da API).
  const [support, setSupport] = useState<{ email: string | null; phone: string | null } | null>(null);
  useEffect(() => {
    if (preview) return;
    fetch('/api/v1/public/support')
      .then(r => (r.ok ? r.json() : null))
      .then(setSupport)
      .catch(() => {});
  }, [preview]);
  const [view, setView] = useState('modulos');
  const [module, setModule] = useState<ModuleKey>('hr');
  const [priceModule, setPriceModule] = useState<ModuleKey>('hr');
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [plans, setPlans] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    if (plans && !el?.open) el?.showModal();
    else if (!plans && el?.open) el.close();
  }, [plans]);
  const current = moduleContent[module];
  const openPlans = (which: ModuleKey = module) => {
    setPriceModule(which);
    setPlans(true);
  };
  return (
    <div className={s.page}>
      {preview && (
        <div className={s.review}>
          <span>
            PROTÓTIPO PARA REVISÃO <b>·</b> Proposta em verde
          </span>
          <a href="/">
            Ver página principal <Arrow />
          </a>
        </div>
      )}
      <header className={s.header}>
        <a
          href={preview ? '/prototipo-inicio' : '/'}
          className={s.logo}
          aria-label={preview ? 'Kianda — protótipo' : 'Kianda — página inicial'}
        >
          <span className={s.mark}>K</span>
          <span>
            Kianda<small>Empresas · Angola</small>
          </span>
        </a>
        <nav aria-label="Conhecer o Kianda">
          {[
            ['modulos', 'Módulos', 'explorar'],
            ['segmentos', 'Segmentos', 'segmentos'],
            ['videos', 'Vídeos', 'videos'],
            ['sobre', 'Sobre nós', 'sobre'],
            ['duvidas', 'Dúvidas', 'explorar'],
          ].map(([key, label, target]) => (
            <button
              key={key}
              type="button"
              aria-current={view === key ? 'page' : undefined}
              onClick={() => {
                if (key === 'modulos' || key === 'duvidas') setView(key);
                document.getElementById(target!)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className={s.headerActions}>
          <button type="button" className={s.textButton} onClick={() => openPlans()}>
            Ver planos
          </button>
          <a className={s.outlineButton} href="/login">
            Entrar <Arrow />
          </a>
          <a className={s.lightButton} href="/registo">
            Experimentar um mês grátis
          </a>
        </div>
      </header>
      <main>
        <section className={s.hero}>
          <div className={s.heroCopy}>
            <p className={s.eyebrow}>
              <span /> GESTÃO E DECISÃO, NO MESMO LUGAR
            </p>
            <h1>
              Cuide da sua equipa.
              <br />
              <em>Prepare o próximo investimento.</em>
            </h1>
            <p className={s.lead}>
              Recursos Humanos, Modelagem Financeira e Análise e Avaliação para empresas em Angola. Escolha o módulo de
              que precisa e cresça com uma conta que os reúne.
            </p>
            <div className={s.actions}>
              <a className={s.primaryButton} href="/registo">
                Experimentar um mês grátis <Arrow />
              </a>
              <button type="button" className={s.textButton} onClick={() => openPlans()}>
                Conhecer os planos <span aria-hidden="true">→</span>
              </button>
            </div>
            <p className={s.smallPrint}>Sem cartão · Sem cobrança automática · Documentos em pré-visualização</p>
          </div>
          <div className={s.heroStage}>
            <figure className={s.browser} aria-hidden="true">
              <div className={s.browserBar}>
                <i />
                <i />
                <i />
                <span>kianda.yelaperformance.com</span>
              </div>
              <img src="/site/kianda-rh-hoje.webp" alt="" width={1366} height={700} />
            </figure>
            <div className={s.heroVisual} aria-label="Três módulos na mesma conta">
              <div className={s.visualHeading}>
                <span className={s.visualMark}>K</span>
                <div>
                  <b>A sua empresa, no Kianda</b>
                  <small>Uma conta. Três caminhos para gerir.</small>
                </div>
                <span className={s.liveDot} aria-hidden="true" />
              </div>
              <div className={s.visualModule}>
                <span className={s.moduleIcon} aria-hidden="true">
                  <svg width="23" height="23" viewBox="0 0 24 24" fill="none">
                    <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.7" />
                    <path
                      d="M3 20v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6m1 3c2 .8 3 2.2 3 4v3"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <div>
                  <small>KIANDA RH</small>
                  <h2>As pessoas no centro</h2>
                  <p>Equipa · Tempo · Remunerações</p>
                </div>
                <Check />
              </div>
              <div className={s.visualConnector}>
                <span />
                <small>MESMA CONTA · ACESSOS PRÓPRIOS</small>
                <span />
              </div>
              <div className={s.visualModule}>
                <span className={`${s.moduleIcon} ${s.lime}`} aria-hidden="true">
                  <svg width="23" height="23" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M4 20V11m7 9V6m7 14V3M2 21h20"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <div>
                  <small>KIANDA INTEGRA</small>
                  <h2>Os números com contexto</h2>
                  <p>Projectos · Cenários · Avaliação</p>
                </div>
                <Check />
              </div>
              <div className={s.visualConnector}>
                <span />
                <small>MESMA CONTA · LICENÇA PRÓPRIA</small>
                <span />
              </div>
              <div className={s.visualModule}>
                <span className={`${s.moduleIcon} ${s.sky}`} aria-hidden="true">
                  <svg width="23" height="23" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 3v9h9A9 9 0 1 1 12 3Z"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M15 3.5A9 9 0 0 1 20.5 9H15V3.5Z"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <div>
                  <small>KIANDA VALORA</small>
                  <h2>O valor da empresa, mês a mês</h2>
                  <p>Demonstrações · Orçamento · Avaliação</p>
                </div>
                <Check />
              </div>
              <div className={s.visualFoot}>
                <span aria-hidden="true">◈</span> No computador, tablet e telefone
              </div>
            </div>
          </div>
        </section>
        <div className={s.assurances}>
          <span>
            <Check /> Escolha um ou vários módulos
          </span>
          <span>
            <Check /> Planos para a utilização da empresa
          </span>
          <span>
            <Check /> Dados e permissões por empresa
          </span>
        </div>
        <section id="explorar" className={s.explore} aria-label="Informações sobre o Kianda">
          <div className={s.sectionTop}>
            <div>
              <p className={s.eyebrow}>CONHEÇA AO SEU RITMO</p>
              <h2>
                {view === 'modulos'
                  ? 'Uma plataforma, três especialidades.'
                  : view === 'comecar'
                    ? 'Do registo ao primeiro resultado.'
                    : 'Respostas antes de começar.'}
              </h2>
            </div>
            <div className={s.viewTabs} role="tablist" aria-label="Informação">
              {[
                ['modulos', 'Módulos'],
                ['comecar', 'Começar'],
                ['duvidas', 'Dúvidas'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  id={`tab-${key}`}
                  role="tab"
                  aria-selected={view === key}
                  aria-controls={`panel-${key}`}
                  tabIndex={view === key ? 0 : -1}
                  onClick={() => setView(key!)}
                  onKeyDown={e => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
                    e.preventDefault();
                    const keys = ['modulos', 'comecar', 'duvidas'],
                      i = keys.indexOf(view),
                      next = e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (i + (e.key === 'ArrowRight' ? 1 : 2)) % 3;
                    setView(keys[next]!);
                    document.getElementById(`tab-${keys[next]}`)?.focus();
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div id="panel-modulos" role="tabpanel" aria-labelledby="tab-modulos" hidden={view !== 'modulos'}>
            <div className={s.moduleSwitch} aria-label="Escolher módulo">
              <button type="button" aria-pressed={module === 'hr'} onClick={() => setModule('hr')}>
                Kianda RH <small>Recursos Humanos</small>
              </button>
              <button type="button" aria-pressed={module === 'modeling'} onClick={() => setModule('modeling')}>
                Kianda Integra <small>Modelagem Financeira</small>
              </button>
              <button type="button" aria-pressed={module === 'valuation'} onClick={() => setModule('valuation')}>
                Kianda Valora <small>Análise e Avaliação</small>
              </button>
            </div>
            <div className={s.moduleBody}>
              <div className={s.moduleDetails}>
                <h3>{current.heading}</h3>
                <p>{current.description}</p>
                <div className={s.featureList}>
                  {current.features.map(([title, body], i) => (
                    <div key={title}>
                      <span className={s.featureNumber}>0{i + 1}</span>
                      <div>
                        <h4>{title}</h4>
                        <p>{body}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" className={s.textButton} onClick={() => openPlans(module)}>
                  Ver condições do {current.name} <span aria-hidden="true">→</span>
                </button>
              </div>
              <aside className={s.moduleSide}>
                <figure className={s.browser}>
                  <div className={s.browserBar} aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <span>{current.name}</span>
                  </div>
                  <img src={current.shot} alt={`Ecrã do ${current.name}`} width={1366} height={760} loading="lazy" />
                </figure>
                <div className={s.moduleMap}>
                  <p className={s.eyebrow}>{current.label}</p>
                  <h3>O que vai encontrar</h3>
                  {current.maps.map((item, i) => (
                    <div key={item}>
                      <span>0{i + 1}</span>
                      <b>{item}</b>
                      <Check />
                    </div>
                  ))}
                  <p className={s.mapNote}>{current.count}</p>
                </div>
              </aside>
            </div>
          </div>
          <div id="panel-comecar" role="tabpanel" aria-labelledby="tab-comecar" hidden={view !== 'comecar'}>
            <div className={s.steps}>
              {[
                [
                  'Crie a conta',
                  'Registe o NIF, o sector e o responsável, e confirme o email. Não precisa de escolher um plano ou pagar no cadastro.',
                ],
                [
                  'Experimente um caso',
                  'Introduza os dados, reveja os pressupostos e pré-visualize os mapas durante 30 dias.',
                ],
                [
                  'Active quando decidir',
                  'Escolha o ciclo e pague a subscrição para continuar e descarregar os documentos.',
                ],
              ].map(([title, body], i) => (
                <article key={title}>
                  <span>0{i + 1}</span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
            <div className={s.testGuide}>
              <h3>Um teste com um objectivo concreto</h3>
              <p>
                No RH, prepare um processamento piloto e confira os custos da equipa. No Integra, estruture um projecto
                e compare os cenários. No Valora, carregue o histórico da empresa e veja o orçamento, a tesouraria e o
                valor. O pagamento durante a avaliação liberta as exportações e preserva os dias gratuitos que ainda
                restam.
              </p>
            </div>
          </div>
          <div
            id="panel-duvidas"
            role="tabpanel"
            aria-labelledby="tab-duvidas"
            hidden={view !== 'duvidas'}
            className={s.faq}
          >
            {questions.map(([q, a]) => (
              <details key={q}>
                <summary>
                  {q}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
        <section id="segmentos" className={s.segments} aria-labelledby="segmentos-titulo">
          <p className={s.eyebrow}>PARA QUEM É</p>
          <h2 id="segmentos-titulo">Segmentos atendidos</h2>
          <p className={s.sectionLead}>O sector é escolhido no registo e acompanha a empresa em todos os módulos.</p>
          <ul>
            {Object.entries(SECTORS)
              .filter(([key]) => key !== 'other')
              .map(([key, label]) => (
                <li key={key}>
                  <Icon d={SECTOR_ICON[key] ?? SECTOR_ICON.services!} />
                  <span>{label}</span>
                </li>
              ))}
          </ul>
        </section>
        <section id="videos" className={s.videos} aria-labelledby="videos-titulo">
          <p className={s.eyebrow}>VEJA COMO FUNCIONA</p>
          <h2 id="videos-titulo">O Kianda em funcionamento</h2>
          <p className={s.sectionLead}>Gravações do produto real, com uma empresa de demonstração e dados fictícios.</p>
          <div className={s.videoGrid}>
            {VIDEOS.map(([file, title, body]) => (
              <figure key={file}>
                <video
                  controls
                  preload="none"
                  playsInline
                  poster={`/site/videos/${file}.jpg`}
                  width={1280}
                  height={720}
                >
                  <source src={`/site/videos/${file}.mp4`} type="video/mp4" />
                </video>
                <figcaption>
                  <b>{title}</b>
                  <span>{body}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
        <section id="sobre" className={s.about} aria-labelledby="sobre-titulo">
          <div className={s.aboutBand}>
            <div>
              <p className={s.eyebrow}>QUEM SOMOS</p>
              <h2 id="sobre-titulo">Gestão e decisão, feitas em Angola para empresas de Angola.</h2>
              <p>
                O Kianda nasceu dentro da função financeira de empresas angolanas, onde salários, impostos,
                investimentos e relatórios têm de bater certo todos os meses. Juntámos tudo numa só conta, com as regras
                locais aplicadas desde o primeiro dia.
              </p>
            </div>
            <dl>
              <div>
                <dt>3</dt>
                <dd>módulos na mesma conta</dd>
              </div>
              <div>
                <dt>16</dt>
                <dd>sectores de actividade</dd>
              </div>
              <div>
                <dt>30</dt>
                <dd>dias grátis em cada módulo</dd>
              </div>
            </dl>
          </div>
          <div className={s.aboutGrid}>
            {ABOUT.map(([title, body, d]) => (
              <article key={title}>
                <span className={s.aboutIcon}>
                  <Icon d={d} size={22} />
                </span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>
        <section className={s.safety} aria-labelledby="seguranca-titulo">
          <p className={s.eyebrow}>CONFIANÇA</p>
          <h2 id="seguranca-titulo">Segurança e controlo</h2>
          <div className={s.safetyGrid}>
            {SAFETY.map(([title, body], i) => (
              <article key={title}>
                <span>0{i + 1}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>
        <section className={s.trialBar}>
          <div>
            <p className={s.eyebrow}>EXPERIMENTE COM A SUA EMPRESA</p>
            <h2>Um mês para conhecer. Uma decisão sua.</h2>
            <p>
              Trabalhe nos módulos escolhidos e pré-visualize os resultados.
              <br />A exportação e a impressão ficam disponíveis com uma subscrição paga.
            </p>
          </div>
          <a className={s.lightButton} href="/registo">
            Começar gratuitamente <Arrow />
          </a>
        </section>
      </main>
      <footer className={s.footer}>
        <div className={s.footerGrid}>
          <div className={s.footerBrand}>
            <span className={s.logo}>
              <span className={s.mark}>K</span>
              <span>
                Kianda<small>Empresas · Angola</small>
              </span>
            </span>
            <p>Recursos Humanos, Modelagem Financeira & Análise e Avaliação · Angola</p>
          </div>
          <nav aria-label="Módulos">
            <h2>Módulos</h2>
            {(['hr', 'modeling', 'valuation'] as const).map(key => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setView('modulos');
                  setModule(key);
                  document.getElementById('explorar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              >
                {moduleContent[key].name}
              </button>
            ))}
          </nav>
          <nav aria-label="Conta">
            <h2>Conta</h2>
            <a href="/registo">Experimentar um mês grátis</a>
            <a href="/login">Entrar</a>
            <button type="button" onClick={() => openPlans()}>
              Planos e condições
            </button>
          </nav>
          <nav aria-label="Suporte">
            <h2>Suporte</h2>
            {support?.email && <a href={`mailto:${support.email}`}>{support.email}</a>}
            {support?.phone && <a href={`tel:${support.phone.replace(/[^+\d]/g, '')}`}>{support.phone}</a>}
            <a href="/termos">Termos e privacidade</a>
          </nav>
        </div>
        <div className={s.footerLine}>
          <span>© {new Date().getFullYear()} Kianda</span>
          <a href="/termos">Termos e privacidade</a>
        </div>
      </footer>
      {(support?.email || support?.phone) && (
        <a
          className={s.floatContact}
          href={support.email ? `mailto:${support.email}` : `tel:${(support.phone ?? '').replace(/[^+\d]/g, '')}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 5h16v11H8l-4 4V5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
          Fale connosco
        </a>
      )}
      <dialog
        className={s.planDialog}
        ref={dialog}
        onCancel={() => setPlans(false)}
        onClose={() => setPlans(false)}
        onClick={e => {
          if (e.target === e.currentTarget) setPlans(false);
        }}
        aria-labelledby="plans-title"
      >
        <div className={s.dialogInner}>
          <div className={s.dialogHeading}>
            <div>
              <p className={s.eyebrow}>UMA SUBSCRIÇÃO PARA CADA MÓDULO</p>
              <h2 id="plans-title">Escolha conforme a sua utilização.</h2>
            </div>
            <button type="button" className={s.close} onClick={() => setPlans(false)} aria-label="Fechar planos">
              ×
            </button>
          </div>
          <div className={s.planControls}>
            <div className={s.viewTabs} aria-label="Módulo dos planos">
              <button type="button" aria-pressed={priceModule === 'hr'} onClick={() => setPriceModule('hr')}>
                Kianda RH
              </button>
              <button
                type="button"
                aria-pressed={priceModule === 'modeling'}
                onClick={() => setPriceModule('modeling')}
              >
                Kianda Integra
              </button>
              <button
                type="button"
                aria-pressed={priceModule === 'valuation'}
                onClick={() => setPriceModule('valuation')}
              >
                Kianda Valora
              </button>
            </div>
            <label className={s.cycle}>
              Pagamento
              <select value={cycle} onChange={e => setCycle(e.target.value as BillingCycle)}>
                {Object.entries(CYCLES).map(([key, c]) => (
                  <option key={key} value={key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className={s.planIntro}>
            {priceModule === 'hr'
              ? 'Valor fixo pela faixa de colaboradores activos. Sem pagamento adicional por colaborador.'
              : priceModule === 'modeling'
                ? 'Projectos activos em simultâneo. Até 5 utilizadores incluídos em todos os planos. Clientes exportam apenas PDF.'
                : 'Análises activas em simultâneo (uma análise = uma entidade analisada). 5 utilizadores incluídos em todos os planos. Relatórios em PDF, Word e Excel.'}
          </p>
          <div className={s.priceGrid}>
            {priceModule === 'hr'
              ? DEFAULT_TIERS.map((t, i) => (
                  <article key={t.key}>
                    <p className={s.eyebrow}>FAIXA {i + 1}</p>
                    <h3>{t.label}</h3>
                    <p className={s.price}>
                      {money(cyclePrice(t, cycle)!.totalMinor)} <small>Kz</small>
                    </p>
                    <p className={s.pricePeriod}>
                      {cycle === 'monthly' ? 'por mês' : `por ${CYCLES[cycle].months} meses · à vista`}
                    </p>
                    <a href={registrationHref('hr', t.key, cycle)} className={s.outlineButton}>
                      Escolher RH <Arrow />
                    </a>
                  </article>
                ))
              : priceModule === 'valuation'
                ? VALUATION_PLANS.map(p => (
                    <article key={p.key}>
                      <p className={s.eyebrow}>
                        {p.analysisLimit === null
                          ? 'SEM LIMITE DE ANÁLISES'
                          : `ATÉ ${p.analysisLimit} ANÁLISES ACTIVAS`}
                      </p>
                      <h3>{p.label}</h3>
                      <p className={s.price}>
                        {money(valuationPlanPrice(p.key, cycle)!.totalMinor)} <small>Kz</small>
                      </p>
                      <p className={s.pricePeriod}>
                        {cycle === 'monthly' ? 'por mês' : `por ${CYCLES[cycle].months} meses · à vista`}
                      </p>
                      <p className={s.sectors}>{p.audience}</p>
                      <a href={registrationHref('valuation', p.key, cycle)} className={s.outlineButton}>
                        Escolher Valora <Arrow />
                      </a>
                    </article>
                  ))
                : MODELING_PLANS.map(p => (
                    <article key={p.key}>
                      <p className={s.eyebrow}>
                        {p.projectLimit === null
                          ? 'SEM LIMITE DE PROJECTOS'
                          : `ATÉ ${p.projectLimit} PROJECTOS ACTIVOS`}
                      </p>
                      <h3>{p.label}</h3>
                      <p className={s.price}>
                        {money(modelingPlanPrice(p.key, cycle)!.totalMinor)} <small>Kz</small>
                      </p>
                      <p className={s.pricePeriod}>
                        {cycle === 'monthly' ? 'por mês' : `por ${CYCLES[cycle].months} meses · à vista`}
                      </p>
                      <p className={s.sectors}>
                        {p.sectorLimit === 8
                          ? 'Todos os 8 sectores'
                          : `${p.sectorLimit} sectores: principal + ${p.sectorLimit - 1} à escolha`}
                      </p>
                      <a href={registrationHref('modeling', p.key, cycle)} className={s.outlineButton}>
                        Escolher Integra <Arrow />
                      </a>
                    </article>
                  ))}
          </div>
          <p className={s.planFoot}>
            Semestral: 10% de desconto. Anual: 15% de desconto. Valores do ciclo completo, pagos à vista.
            {priceModule === 'modeling' &&
              ' Utilizadores adicionais: 35.000 Kz/mês por acesso além dos 5 incluídos, contratados explicitamente e sem desconto nos extras.'}
            {priceModule === 'valuation' &&
              ` Utilizadores adicionais: ${String(VALUATION_EXTRA_USER_MONTHLY_MINOR / 100).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} Kz/mês por acesso além dos 5 incluídos, sem desconto nos extras.`}
          </p>
          <div className={s.previewNote}>
            <Check />
            <span>
              Durante os 30 dias grátis, os documentos ficam em pré-visualização. Active a subscrição paga do módulo
              para exportar ou imprimir.
            </span>
          </div>
        </div>
      </dialog>
    </div>
  );
}
