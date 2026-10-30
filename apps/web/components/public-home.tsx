import { SITE_SCHEMA } from '@/lib/site';
import styles from './public-home.module.css';

export function PublicHome() {
  return <div className={styles.site}>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_SCHEMA).replace(/</g, '\\u003c') }} />
    <header className={styles.header}>
      <a className={styles.brand} href="/" aria-label="Kianda — página inicial"><span className={styles.mark}>K</span><span>Kianda<small>Empresas · Angola</small></span></a>
      <nav aria-label="Navegação pública"><a href="#modulos">Os módulos</a><a className={styles.button} href="/login">Iniciar sessão</a></nav>
    </header>
    <main>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Kianda RH · Kianda Integra</p>
        <h1>Recursos Humanos e Modelagem Financeira para empresas em Angola</h1>
        <p>Organize a gestão de pessoas e avalie os seus projectos numa única plataforma. Escolha o módulo adequado à sua empresa ou utilize os dois.</p>
        <div className={styles.actions}><a className={`${styles.button} ${styles.primary}`} href="/registo">Criar conta</a><a className={styles.button} href="/login">Entrar na minha conta</a></div>
      </section>
      <section id="modulos" className={styles.modules} aria-label="Módulos do Kianda">
        <article><p className={styles.eyebrow}>Kianda RH</p><h2>Gestão de pessoas</h2><p>Colaboradores, assiduidade, férias, processamento salarial, recibos e custos com pessoal, com regras adaptadas a Angola.</p><p className={styles.detail}>Planos por faixa de colaboradores activos.</p><a href="/registo">Escolher o módulo RH <span aria-hidden="true">→</span></a></article>
        <article><p className={styles.eyebrow}>Kianda Integra</p><h2>Modelagem e análise financeira</h2><p>Projectos de viabilidade, pressupostos, investimentos, demonstrações projectadas, avaliação, cenários e análise de balancetes externos.</p><p className={styles.detail}>Planos por projectos activos, até 5 utilizadores incluídos e relatórios em PDF. Sectores disponíveis conforme o plano.</p><a href="/registo">Escolher o módulo Integra <span aria-hidden="true">→</span></a></article>
      </section>
      <section className={styles.connection}><h2>Dois módulos, a mesma conta</h2><p>Subscreva RH, Integra ou ambos. Os módulos partilham a mesma conta, com planos e permissões próprios.</p><p>Utilize o Kianda no computador, tablet ou telefone. O menu Módulos e licenças reúne os seus acessos.</p></section>
    </main>
    <footer className={styles.footer}><span>Kianda · Recursos Humanos e Modelagem Financeira</span><a href="/termos">Termos e privacidade</a></footer>
  </div>;
}
