import { REGISTRATION_TERMS_VERSION } from '@kianda/core';
import { AuthNavigation } from '../../components/auth-navigation';

export default function Termos() {
  return (
    <main style={{ maxWidth: 760, margin: '40px auto', padding: 20, lineHeight: 1.7 }}>
      <AuthNavigation login />
      <h1>Termos de utilização e política de privacidade</h1>
      <p className="muted">Versão {REGISTRATION_TERMS_VERSION} · Versão de trabalho — sujeita a revisão jurídica antes da comercialização.</p>
      <h2>1. Serviço</h2>
      <p>A plataforma Kianda disponibiliza Recursos Humanos (Kianda RH), Modelagem Financeira (Kianda Integra) e Análise e Avaliação (Kianda Valora) na mesma conta, com subscrições independentes. A empresa cliente é responsável pelos dados, pressupostos e decisões que introduz. Os cálculos RH seguem o pacote fiscal e laboral do ano; as projecções e avaliações financeiras dependem dos pressupostos revistos pelo cliente.</p>
      <h2>2. Licença e pagamento</h2>
      <p>O RH é licenciado por faixa de colaboradores activos. A Modelagem é licenciada por projectos activos em simultâneo e sectores escolhidos: PME inclui 2 sectores (o principal do registo e 1 adicional), Corporate inclui 4 (o principal e 3 adicionais), e Grandes Empresas inclui os 8 sectores. Todos os planos de Modelagem incluem 5 utilizadores; acessos adicionais custam 35.000 Kz por mês e são contratados explicitamente. Os clientes exportam os relatórios de Modelagem apenas em PDF.</p>
      <p>Os preços e os totais do ciclo são apresentados antes do pedido de pagamento. Os ciclos semestral e anual são pagos à vista, com descontos de 10% no semestral e 15% no anual para o plano base; os utilizadores extra da Modelagem são cobrados por cada mês do ciclo, sem desconto nos extras. O plano de projectos ilimitados também está disponível no ciclo mensal. O pagamento activa apenas o módulo identificado no pedido.</p>
      <p>A avaliação inicial corresponde a um mês grátis (30 dias de calendário), contando o dia da confirmação do email e incluindo a data final indicada na conta, pela hora de Angola. O cadastro exige um NIF de empresa válido e a confirmação do endereço de email. Os limites de utilização da experiência são apresentados dentro da conta; a escolha de planos e do pagamento é feita após o cadastro. O registo não pede cartão nem inicia cobrança automática. Durante a avaliação, pode trabalhar nos módulos e pré-visualizar os documentos, mas a exportação e a impressão dos documentos gerados exigem uma subscrição paga do respectivo módulo. Após o período experimental, o módulo fica em consulta se não houver pagamento: os dados guardados e a pré-visualização continuam disponíveis; criar, alterar, exportar e imprimir exige uma licença activa. Se pagar durante a avaliação, o período contratado começa depois dos dias gratuitos que ainda tem.</p>
      <p>Após um período pago, existem 7 dias de tolerância antes da consulta. Depois da tolerância, os documentos ficam apenas em pré-visualização até regularizar o pagamento. Os dados são conservados e cada módulo pode ser regularizado separadamente.</p>
      <p>O Valora é licenciado por análises activas, cada uma correspondente a uma entidade analisada, e inclui cinco utilizadores. Os limites, utilizadores adicionais e respectivos valores são apresentados em Módulos e licenças antes do pedido de pagamento. Os relatórios do Valora podem ser exportados em PDF, Word e Excel com uma subscrição paga. A importação de custos com pessoal do RH é opcional.</p>
      <h2>3. Dados pessoais</h2>
      <p>A empresa cliente é a responsável pelo tratamento dos dados dos seus colaboradores; a Kianda RH actua como subcontratante, nos termos da Lei n.º 22/11, de 17 de Junho (Lei da Protecção de Dados Pessoais). Os dados são usados apenas para prestar o serviço, ficam isolados por empresa, são protegidos por controlo de acesso por perfil e auditoria, e podem ser exportados ou eliminados a pedido da empresa no fim do contrato.</p>
      <h2>4. Candidatos</h2>
      <p>As candidaturas recebidas pela página de carreiras são tratadas apenas para o processo de recrutamento da empresa a que se destinam, com consentimento do candidato.</p>
      <h2>5. Contacto</h2>
      <p>Para questões sobre a conta, pagamentos ou dados pessoais, contacte o suporte Kianda RH.</p>
    </main>
  );
}
