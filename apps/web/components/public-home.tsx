import { SITE_SCHEMA } from '@/lib/site';
import { CYCLES, DEFAULT_TIERS, FINANCIAL_SECTORS, MODELING_EXTRA_USER_MONTHLY_MINOR, MODELING_INCLUDED_USERS, MODELING_PLANS, MODELING_SECTOR_LABELS, TRIAL_DAYS, cyclePrice, formatKz, modelingPlanPrice, type BillingCycle } from '@kianda/core';
import styles from './public-home.module.css';

const cycles: BillingCycle[] = ['monthly', 'semiannual', 'annual'];
const steps = [
  ['Crie a conta da empresa', 'Indique o NIF, o sector e o responsável pela conta. Escolha RH, Integra ou os dois módulos.'],
  ['Escolha o plano adequado', 'No RH, conte os colaboradores activos. No Integra, escolha os projectos em simultâneo e os sectores de que precisa.'],
  ['Experimente com um caso realista', 'Prepare um processamento em rascunho no RH ou um projecto piloto no Integra. Confira os dados e os pressupostos antes de usar os resultados.'],
  ['Decida com os resultados à vista', 'Consulte os mapas, explore os indicadores e reveja os relatórios. Se decidir continuar, active a subscrição do módulo que pretende utilizar.'],
];
const questions = [
  ['Preciso de contratar os dois módulos?', 'Pode subscrever apenas RH, apenas Integra ou ambos. Cada módulo tem o seu plano e pagamento. Os módulos disponíveis e o estado da licença aparecem juntos na mesma conta.'],
  ['Quando começam e acabam os 7 dias grátis?', 'A avaliação começa no registo da empresa, nos módulos que escolher. São 7 dias de calendário, incluindo o dia do registo, pela hora de Angola. A data final apresentada na licença está incluída no teste. Entrar novamente na conta não reinicia a contagem.'],
  ['O que acontece quando o período experimental termina?', 'Sem pagamento, o módulo passa a consulta: pode ver os dados já guardados e pré-visualizar os documentos. Criar, alterar, exportar e imprimir exige uma subscrição activa. Os dados não são apagados quando o teste termina.'],
  ['Posso exportar documentos durante os 7 dias grátis?', 'Durante o teste, pode trabalhar nos módulos escolhidos e pré-visualizar os documentos, mas não descarregar nem imprimir os documentos gerados. Active uma subscrição paga do respectivo módulo para libertar a exportação.'],
  ['Existe cobrança automática no fim do teste?', 'O registo não pede cartão nem cria uma cobrança automática. Para continuar, escolha o plano em Módulos e licenças e efectue o pagamento pelas opções apresentadas na conta. Se pagar durante o teste, o período contratado começa depois dos dias gratuitos que ainda tem.'],
  ['Projectos e sectores significam a mesma coisa?', 'São limites diferentes. Projectos activos são os estudos em que pode trabalhar ao mesmo tempo; arquivar um projecto liberta uma vaga, mantendo o histórico para consulta. Os sectores determinam os modelos-tipo disponíveis. O PME escolhe 2 sectores, o Corporate 4 e os planos Grandes Empresas incluem os 8.'],
  ['Posso analisar um balancete que vem de outro ERP?', 'No Integra, pode carregar um balancete externo em PDF com texto seleccionável, Word (.docx), CSV ou TXT. Confira as contas, os períodos e a moeda extraídos antes de analisar e guardar. Um PDF digitalizado como imagem precisa de ser convertido para texto antes da leitura.'],
  ['Em que formato recebo os relatórios do Integra?', 'Com a subscrição paga, os clientes descarregam relatórios em PDF. Os pressupostos, as simulações e a actualização dos cenários são trabalhados na plataforma. A licença dá acesso ao software; a recolha de dados de mercado, a revisão por um consultor e a aceitação de um estudo pelo banco são serviços e decisões distintos.'],
  ['Posso usar o Kianda no telefone?', 'Pode abrir a mesma conta no navegador do computador, tablet ou telefone. Nos navegadores compatíveis, também pode adicionar o Kianda ao ecrã inicial. Para carregar projectos e guardar alterações no Integra é necessária ligação à Internet.'],
];

export function PublicHome() {
  return <div className={styles.site}>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_SCHEMA).replace(/</g, '\\u003c') }} />
    <header className={styles.header}>
      <a className={styles.brand} href="/" aria-label="Kianda — página inicial"><span className={styles.mark}>K</span><span>Kianda<small>Empresas · Angola</small></span></a>
      <nav aria-label="Navegação pública"><a className={styles.sectionNav} href="#modulos">Os módulos</a><a className={styles.sectionNav} href="#como-comecar">Como começar</a><a className={styles.sectionNav} href="#planos">Planos</a><a className={styles.sectionNav} href="#duvidas">Dúvidas</a><a className={styles.button} href="/login">Iniciar sessão</a></nav>
    </header>
    <main>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Kianda RH · Kianda Integra</p>
        <h1>Recursos Humanos e Modelagem Financeira para empresas em Angola</h1>
        <p>Organize a gestão de pessoas, acompanhe os custos da equipa e transforme os pressupostos dos seus projectos em mapas que ajudam a decidir.</p>
        <div className={styles.actions}><a className={`${styles.button} ${styles.primary}`} href="/registo">Experimentar {TRIAL_DAYS} dias grátis</a><a className={styles.button} href="#planos">Ver módulos e preços</a></div>
        <p className={styles.trialNote}>Sem cartão e sem cobrança automática. No teste, documentos apenas em pré-visualização. Escolha um módulo ou os dois. Já tem conta? <a href="/login">Iniciar sessão</a>.</p>
      </section>
      <section id="modulos" className={styles.modules} aria-label="Módulos do Kianda">
        <article><p className={styles.eyebrow}>Kianda RH</p><h2>Mais clareza na gestão da sua equipa</h2><p>Para quem precisa de organizar o trabalho do RH e acompanhar o custo com pessoal.</p><ul className={styles.benefits}><li>Fichas, contratos e documentos dos colaboradores.</li><li>Processamento salarial, recibos e mapas de IRT e INSS.</li><li>Assiduidade, férias, ausências e portal do colaborador.</li><li>Indicadores e custos por departamento e local de trabalho.</li></ul><p className={styles.detail}>Planos por faixa de colaboradores activos, com um valor fixo para cada faixa.</p><a href="#precos-rh">Ver planos de RH <span aria-hidden="true">→</span></a></article>
        <article><p className={styles.eyebrow}>Kianda Integra</p><h2>Mais elementos para decidir sobre um projecto</h2><p>Para gestores, equipas financeiras e consultores que elaboram estudos e analisam empresas.</p><ul className={styles.benefits}><li>Investimentos, receitas, custos e financiamento nos mesmos pressupostos.</li><li>DRE, Balanço e fluxos de caixa projectados.</li><li>VAL, TIR, avaliação, cenários e sensibilidade.</li><li>Análise de balancetes externos e relatórios em PDF.</li></ul><p className={styles.detail}>Planos por projectos activos. Incluem {MODELING_INCLUDED_USERS} utilizadores; os sectores disponíveis dependem do plano.</p><a href="#precos-integra">Ver planos do Integra <span aria-hidden="true">→</span></a></article>
      </section>
      <section id="como-comecar" className={styles.section}>
        <div className={styles.sectionHead}><p className={styles.eyebrow}>Do registo ao primeiro resultado</p><h2>Comece com um objectivo concreto</h2><p>Escolha uma tarefa para testar. Assim consegue avaliar o Kianda com os dados e as dúvidas da sua empresa.</p></div>
        <ol className={styles.steps}>{steps.map(([title, detail], i) => <li key={title}><span className={styles.stepNumber} aria-hidden="true">{i + 1}</span><h3>{title}</h3><p>{detail}</p></li>)}</ol>
      </section>
      <section id="experimente" className={styles.trial} aria-labelledby="trial-title">
        <div><p className={styles.eyebrow}>Conheça antes de subscrever</p><h2 id="trial-title">{TRIAL_DAYS} dias para experimentar os módulos escolhidos</h2><p>A contagem começa no registo e inclui esse dia, pela hora de Angola. Os limites de colaboradores, projectos, sectores e acessos são os do plano seleccionado.</p><p>A data final fica visível na conta. Durante o teste, os documentos ficam apenas em pré-visualização; exportar e imprimir exige uma subscrição paga. Se não activar a subscrição, o módulo passa a consulta e os dados guardados continuam disponíveis.</p></div>
        <aside><h3>Um roteiro para o seu teste</h3><ul><li><b>Dia 1:</b> configure a empresa e escolha o caso que quer avaliar.</li><li><b>Dias 2 a 4:</b> introduza os dados, confira os mapas e ajuste os pressupostos.</li><li><b>Dias 5 e 6:</b> compare resultados e reveja os relatórios.</li><li><b>Dia 7:</b> decida se pretende activar o módulo e o ciclo de pagamento.</li></ul><a className={`${styles.button} ${styles.primary}`} href="/registo">Criar conta e experimentar</a></aside>
      </section>
      <section id="planos" className={styles.section}>
        <div className={styles.sectionHead}><p className={styles.eyebrow}>Subscrições independentes</p><h2>Escolha o plano pela utilização da sua empresa</h2><p>Valores em kwanzas. O semestral e o anual são pagos à vista pelo ciclo completo. Pode contratar um módulo ou os dois.</p></div>
        <div id="precos-rh" className={styles.priceBlock}><h3>Recursos Humanos · Kianda RH</h3><p>Uma faixa fixa pelo número de colaboradores activos. O preço da faixa já cobre o seu limite de colaboradores.</p><div className={styles.priceScroll} role="region" aria-label="Tabela de preços do Kianda RH" tabIndex={0}><table><caption>Subscrição RH por faixa de colaboradores</caption><thead><tr><th scope="col">Colaboradores activos</th>{cycles.map(c => <th key={c} scope="col">{CYCLES[c].label}</th>)}</tr></thead><tbody>{DEFAULT_TIERS.map(t => <tr key={t.key}><th scope="row">{t.label}</th>{cycles.map(c => <td key={c}>{formatKz(cyclePrice(t, c)!.totalMinor)}</td>)}</tr>)}</tbody></table></div></div>
        <div id="precos-integra" className={styles.priceBlock}><h3>Modelagem Financeira · Kianda Integra</h3><p>O limite conta os projectos activos em simultâneo. Todos os planos incluem {MODELING_INCLUDED_USERS} utilizadores e relatórios em PDF.</p><div className={styles.priceScroll} role="region" aria-label="Tabela de preços do Kianda Integra" tabIndex={0}><table><caption>Subscrição Integra por projectos activos e sectores</caption><thead><tr><th scope="col">Plano</th><th scope="col">Projectos activos</th><th scope="col">Sectores</th>{cycles.map(c => <th key={c} scope="col">{CYCLES[c].label}</th>)}</tr></thead><tbody>{MODELING_PLANS.map(p => <tr key={p.key}><th scope="row">{p.label}</th><td>{p.projectLimit === null ? 'Ilimitados' : `Até ${p.projectLimit}`}</td><td>{p.sectorLimit === FINANCIAL_SECTORS.length ? `Todos os ${p.sectorLimit}` : p.sectorLimit}</td>{cycles.map(c => { const price = modelingPlanPrice(p.key, c); return <td key={c}>{price ? formatKz(price.totalMinor) : 'Não disponível'}</td>; })}</tr>)}</tbody></table></div>
          <p className={styles.priceNote}>PME: sector principal do registo + 1 à escolha. Corporate: sector principal + 3 à escolha. Grandes Empresas: os {FINANCIAL_SECTORS.length} sectores. Utilizadores adicionais: {formatKz(MODELING_EXTRA_USER_MONTHLY_MINOR)}/mês por acesso além dos {MODELING_INCLUDED_USERS} incluídos, contratados explicitamente e cobrados pelos meses do ciclo.</p>
          <details className={styles.sectorList}><summary>Conheça os {FINANCIAL_SECTORS.length} sectores de modelagem</summary><ul>{FINANCIAL_SECTORS.map(s => <li key={s}>{MODELING_SECTOR_LABELS[s]}</li>)}</ul></details>
        </div>
        <div className={styles.actions}><a className={`${styles.button} ${styles.primary}`} href="/registo">Escolher módulos e começar</a><a className={styles.button} href="/login">Já tenho conta</a></div>
      </section>
      <section className={styles.connection}><h2>Dois módulos, a mesma conta</h2><p>RH e Integra partilham a conta, com planos e permissões próprios. O menu Módulos e licenças reúne os seus acessos, o estado das subscrições e as opções de pagamento.</p><p>Se utilizar apenas o Integra, pode preencher manualmente o custo com pessoal nos pressupostos do projecto. O RH tem a sua própria licença e não é obrigatório para modelar um investimento.</p></section>
      <section id="duvidas" className={styles.faq}><div className={styles.sectionHead}><p className={styles.eyebrow}>Antes de começar</p><h2>Perguntas frequentes</h2></div>{questions.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</section>
      <section className={styles.lastCall}><h2>O próximo passo é testar um caso da sua empresa</h2><p>Escolha os módulos no registo. A data da avaliação e os valores do plano ficam disponíveis na conta para decidir como continuar.</p><a className={`${styles.button} ${styles.primary}`} href="/registo">Experimentar {TRIAL_DAYS} dias grátis</a></section>
    </main>
    <footer className={styles.footer}><span>Kianda · Recursos Humanos e Modelagem Financeira</span><a href="/termos">Termos e privacidade</a></footer>
  </div>;
}
