import type { Minor } from './money.js';

/**
 * Documentos de RH a partir de modelos: contratos, declarações, certificados e comunicações.
 *
 * Um modelo é texto simples com campos {{grupo.campo}}, blocos condicionais {{#se campo}}…{{/se}}, títulos
 * ("# Título"), negrito (**texto**) e uma linha de assinaturas ("--- assinaturas: A | B"). Os modelos do Kianda são
 * versionados com o pacote do ano (as referências legais e os prazos vêm do pacote); a empresa pode adaptá-los, e cada
 * alteração cria uma nova versão. Cada documento emitido guarda o texto final — alterações posteriores ao modelo não o mudam.
 */

export type DocumentCategory = 'contract' | 'declaration' | 'certificate' | 'communication';
export const DOCUMENT_CATEGORY: Record<DocumentCategory, string> = {
  contract: 'Contratos', declaration: 'Declarações', certificate: 'Certificados', communication: 'Comunicações',
};

export interface TemplateInput { key: string; label: string; placeholder?: string; required: boolean }
export interface DocumentTemplate { key: string; title: string; category: DocumentCategory; body: string; inputs: TemplateInput[]; description: string }

/** Campos disponíveis nos modelos (o editor mostra esta lista). */
export const DOCUMENT_FIELDS: { key: string; label: string }[] = [
  { key: 'empresa.nome', label: 'Nome da empresa' }, { key: 'empresa.nif', label: 'NIF da empresa' }, { key: 'empresa.morada', label: 'Morada da empresa' },
  { key: 'empresa.cidade', label: 'Localidade (para a data)' }, { key: 'empresa.jornada_horas', label: 'Jornada diária (horas)' },
  { key: 'colaborador.nome', label: 'Nome' }, { key: 'colaborador.numero', label: 'N.º mecanográfico' }, { key: 'colaborador.bi', label: 'N.º do BI' },
  { key: 'colaborador.nif', label: 'NIF' }, { key: 'colaborador.inss', label: 'N.º de Segurança Social' }, { key: 'colaborador.funcao', label: 'Função' },
  { key: 'colaborador.departamento', label: 'Departamento' }, { key: 'colaborador.morada', label: 'Morada' }, { key: 'colaborador.nacionalidade', label: 'Nacionalidade' },
  { key: 'colaborador.data_nascimento', label: 'Data de nascimento' },
  { key: 'contrato.tipo', label: 'Tipo de contrato' }, { key: 'contrato.admissao', label: 'Data de admissão (antiguidade)' },
  { key: 'contrato.inicio', label: 'Início do contrato em vigor' }, { key: 'contrato.fim', label: 'Termo do contrato' },
  { key: 'contrato.fundamento', label: 'Fundamento do termo' }, { key: 'contrato.cessacao', label: 'Data da cessação' },
  { key: 'remuneracao.base', label: 'Salário base' }, { key: 'remuneracao.base_extenso', label: 'Salário base por extenso' },
  { key: 'remuneracao.alimentacao', label: 'Subsídio de alimentação' }, { key: 'remuneracao.transporte', label: 'Subsídio de transporte' },
  { key: 'remuneracao.total', label: 'Remuneração mensal ilíquida' }, { key: 'remuneracao.total_extenso', label: 'Remuneração ilíquida por extenso' },
  { key: 'remuneracao.desde', label: 'Data de efeito da remuneração' },
  { key: 'rendimentos.liquido_medio_3m', label: 'Líquido médio dos últimos 3 recibos' }, { key: 'rendimentos.meses', label: 'Meses considerados' },
  { key: 'pacote.periodo_experimental', label: 'Período experimental (indeterminado)' }, { key: 'pacote.periodo_experimental_termo', label: 'Período experimental (a termo)' },
  { key: 'pacote.dias_ferias', label: 'Dias úteis de férias' }, { key: 'pacote.horas_semanais', label: 'Horas semanais' }, { key: 'pacote.versao', label: 'Versão do pacote de regras' },
  { key: 'horario.nome', label: 'Regime de horário' }, { key: 'horario.descricao', label: 'Descrição do regime (dias e horas)' },
  { key: 'horario.media_semanal', label: 'Média semanal do regime (horas)' }, { key: 'horario.inicio_ciclo', label: 'Início do ciclo (turnos/rotação)' },
  { key: 'subsidios.lista', label: 'Subsídios recorrentes atribuídos' },
  { key: 'data.hoje', label: 'Data de hoje (por extenso)' },
];

const ASSINATURAS = (a: string, b: string) => `--- assinaturas: ${a} | ${b}`;

export const BUILTIN_TEMPLATES: DocumentTemplate[] = [
  {
    key: 'contrato_indeterminado', title: 'Contrato de trabalho por tempo indeterminado', category: 'contract',
    description: 'Contrato por tempo indeterminado, com período experimental, remuneração e férias.',
    inputs: [{ key: 'pedido.local_trabalho', label: 'Local de trabalho', placeholder: 'Ex.: Luanda, instalações da empresa', required: true }, { key: 'pedido.representante', label: 'Representante da empresa', placeholder: 'Ex.: o gerente, Sr. João Silva', required: false }],
    body: `# CONTRATO DE TRABALHO

Pelo presente instrumento, **{{empresa.nome}}**, com sede em {{empresa.morada}}, titular do número de identificação fiscal {{empresa.nif}}{{#se pedido.representante}}, representada neste acto por {{pedido.representante}}{{/se}}, adiante designada EMPRESA (empregador), e **{{colaborador.nome}}**{{#se colaborador.nacionalidade}}, de nacionalidade {{colaborador.nacionalidade}}{{/se}}, portador(a) do Bilhete de Identidade n.º {{colaborador.bi}}{{#se colaborador.nif}}, contribuinte n.º {{colaborador.nif}}{{/se}}{{#se colaborador.morada}}, residente em {{colaborador.morada}}{{/se}}, adiante designado(a) TRABALHADOR, celebram o presente contrato de trabalho, nos termos da Lei Geral do Trabalho (Lei n.º 12/23, de 27 de Dezembro), que se rege pelas cláusulas e condições seguintes:

## 1. OBJECTO

1.1. O presente contrato tem por objecto a prestação, pelo TRABALHADOR à EMPRESA, de trabalho subordinado na função de **{{colaborador.funcao}}**{{#se colaborador.departamento}}, no departamento de {{colaborador.departamento}}{{/se}}.

1.2. A EMPRESA pode atribuir ao TRABALHADOR funções diferentes das referidas no número anterior, desde que compatíveis com a sua qualificação e formação profissional e sem prejuízo dos seus direitos contratuais, nos limites da Lei Geral do Trabalho.

1.3. O trabalho é prestado em {{pedido.local_trabalho}}, sem prejuízo das deslocações exigidas pelo serviço.

## 2. OBRIGAÇÕES

2.1. São obrigações do TRABALHADOR, além das que decorrem do objecto do contrato e da lei:

a. prestar o trabalho com zelo, diligência e disciplina;

b. comparecer ao trabalho com assiduidade e pontualidade;

c. cumprir as ordens e instruções dos responsáveis da EMPRESA em tudo o que respeite à execução e disciplina do trabalho;

d. guardar sigilo profissional sobre a actividade da EMPRESA, durante a vigência do contrato e após o seu termo;

e. respeitar os colegas de trabalho, os superiores hierárquicos e as pessoas que se relacionem com a EMPRESA;

f. cumprir o regulamento interno e as normas de higiene e segurança no trabalho.

2.2. São obrigações da EMPRESA, além das que decorrem do objecto do contrato e da lei:

a. tratar e respeitar o TRABALHADOR e proporcionar-lhe boas condições de trabalho;

b. pagar pontualmente a remuneração acordada;

c. proporcionar formação e aperfeiçoamento profissional;

d. adoptar as medidas adequadas de higiene e segurança no trabalho;

e. inscrever o TRABALHADOR na Segurança Social e efectuar as retenções e entregas legais.

## 3. VIGÊNCIA

3.1. O presente contrato entra em vigor em {{contrato.inicio}} e é celebrado por tempo indeterminado.

3.2. O contrato tem um período experimental de {{pacote.periodo_experimental}} dias, durante o qual qualquer das partes o pode fazer cessar sem aviso prévio, indemnização ou justificação.

## 4. REMUNERAÇÃO

4.1. Pela prestação do trabalho, a EMPRESA paga ao TRABALHADOR o salário base mensal de **{{remuneracao.base}}** ({{remuneracao.base_extenso}}){{#se remuneracao.alimentacao}}, acrescido de subsídio de alimentação de {{remuneracao.alimentacao}}{{/se}}{{#se remuneracao.transporte}} e de subsídio de transporte de {{remuneracao.transporte}}{{/se}}.

4.2. A remuneração é paga até ao último dia do mês a que respeita, por transferência para a conta bancária do TRABALHADOR.

4.3. À remuneração são deduzidos os descontos legais (IRT e Segurança Social) e, nos termos da lei:

a. as faltas injustificadas;

b. os adiantamentos e outros valores devidos pelo TRABALHADOR à EMPRESA, nos limites legais.

## 5. HORÁRIO, FÉRIAS E SUBSÍDIOS

5.1. O período normal de trabalho é de {{empresa.jornada_horas}} horas diárias e {{pacote.horas_semanais}} horas semanais, segundo o horário em vigor na EMPRESA.

5.2. O TRABALHADOR tem direito a {{pacote.dias_ferias}} dias úteis de férias remuneradas por ano, marcadas por acordo entre as partes ou, na falta de acordo, pela EMPRESA no mapa de férias.

5.3. O TRABALHADOR tem direito aos subsídios de férias e de Natal, nos termos da Lei Geral do Trabalho.

## 6. CESSAÇÃO DO CONTRATO

6.1. O contrato pode cessar por acordo das partes, por caducidade, por despedimento ou por demissão do TRABALHADOR, nos termos e com os avisos prévios previstos na Lei Geral do Trabalho.

6.2. A falta de aviso prévio obriga a parte faltosa a indemnizar a outra nos termos da lei.

## 7. DISPOSIÇÕES GERAIS

7.1. No momento da celebração do presente contrato, o TRABALHADOR tomou conhecimento do horário de trabalho e do regulamento interno em vigor na EMPRESA.

7.2. Em tudo o que não estiver expressamente previsto aplica-se a Lei Geral do Trabalho e demais legislação aplicável.

## 8. LEI APLICÁVEL E FORO

8.1. O presente contrato rege-se pela lei angolana, sendo competente para dirimir os litígios dele emergentes o tribunal da comarca de {{empresa.cidade}}.

E, por assim estarem justos e acordados, as partes assinam o presente contrato em 2 (dois) exemplares de igual teor e forma.

{{empresa.cidade}}, {{data.hoje}}

${ASSINATURAS('TRABALHADOR // {{colaborador.nome}}', 'PELA EMPRESA // {{empresa.nome}}')}

**TESTEMUNHAS:**

${ASSINATURAS('1.ª testemunha', '2.ª testemunha')}`,
  },
  {
    key: 'contrato_termo', title: 'Contrato de trabalho por tempo determinado', category: 'contract',
    description: 'Só nas situações excepcionais da lei: o fundamento do termo é obrigatório e tem de constar do contrato.',
    inputs: [{ key: 'pedido.local_trabalho', label: 'Local de trabalho', placeholder: 'Ex.: Luanda, instalações da empresa', required: true }, { key: 'pedido.representante', label: 'Representante da empresa', placeholder: 'Ex.: o gerente, Sr. João Silva', required: false }],
    body: `# CONTRATO DE TRABALHO POR TEMPO DETERMINADO

Pelo presente instrumento, **{{empresa.nome}}**, com sede em {{empresa.morada}}, titular do número de identificação fiscal {{empresa.nif}}{{#se pedido.representante}}, representada neste acto por {{pedido.representante}}{{/se}}, adiante designada EMPRESA (empregador), e **{{colaborador.nome}}**{{#se colaborador.nacionalidade}}, de nacionalidade {{colaborador.nacionalidade}}{{/se}}, portador(a) do Bilhete de Identidade n.º {{colaborador.bi}}{{#se colaborador.nif}}, contribuinte n.º {{colaborador.nif}}{{/se}}{{#se colaborador.morada}}, residente em {{colaborador.morada}}{{/se}}, adiante designado(a) TRABALHADOR, celebram o presente contrato de trabalho, nos termos da Lei Geral do Trabalho (Lei n.º 12/23, de 27 de Dezembro), que se rege pelas cláusulas e condições seguintes:

## 1. OBJECTO

1.1. O presente contrato tem por objecto a prestação, pelo TRABALHADOR à EMPRESA, de trabalho subordinado na função de **{{colaborador.funcao}}**{{#se colaborador.departamento}}, no departamento de {{colaborador.departamento}}{{/se}}.

1.2. A EMPRESA pode atribuir ao TRABALHADOR funções diferentes das referidas no número anterior, desde que compatíveis com a sua qualificação e formação profissional e sem prejuízo dos seus direitos contratuais, nos limites da Lei Geral do Trabalho.

1.3. O trabalho é prestado em {{pedido.local_trabalho}}, sem prejuízo das deslocações exigidas pelo serviço.

## 2. OBRIGAÇÕES

2.1. São obrigações do TRABALHADOR, além das que decorrem do objecto do contrato e da lei:

a. prestar o trabalho com zelo, diligência e disciplina;

b. comparecer ao trabalho com assiduidade e pontualidade;

c. cumprir as ordens e instruções dos responsáveis da EMPRESA em tudo o que respeite à execução e disciplina do trabalho;

d. guardar sigilo profissional sobre a actividade da EMPRESA, durante a vigência do contrato e após o seu termo;

e. respeitar os colegas de trabalho, os superiores hierárquicos e as pessoas que se relacionem com a EMPRESA;

f. cumprir o regulamento interno e as normas de higiene e segurança no trabalho.

2.2. São obrigações da EMPRESA, além das que decorrem do objecto do contrato e da lei:

a. tratar e respeitar o TRABALHADOR e proporcionar-lhe boas condições de trabalho;

b. pagar pontualmente a remuneração acordada;

c. proporcionar formação e aperfeiçoamento profissional;

d. adoptar as medidas adequadas de higiene e segurança no trabalho;

e. inscrever o TRABALHADOR na Segurança Social e efectuar as retenções e entregas legais.

## 3. VIGÊNCIA

3.1. O presente contrato entra em vigor em {{contrato.inicio}} e é celebrado por tempo determinado, com termo em {{contrato.fim}}.

3.2. O contrato é celebrado com o seguinte fundamento, nos termos da Lei Geral do Trabalho: {{contrato.fundamento}}.

3.3. O contrato tem um período experimental de {{pacote.periodo_experimental_termo}} dias, durante o qual qualquer das partes o pode fazer cessar sem aviso prévio nem indemnização.

3.4. A parte que não pretenda a renovação deve comunicá-lo à outra, por escrito, com a antecedência mínima de 30 (trinta) dias.

## 4. REMUNERAÇÃO

4.1. Pela prestação do trabalho, a EMPRESA paga ao TRABALHADOR o salário base mensal de **{{remuneracao.base}}** ({{remuneracao.base_extenso}}){{#se remuneracao.alimentacao}}, acrescido de subsídio de alimentação de {{remuneracao.alimentacao}}{{/se}}{{#se remuneracao.transporte}} e de subsídio de transporte de {{remuneracao.transporte}}{{/se}}.

4.2. A remuneração é paga até ao último dia do mês a que respeita, por transferência para a conta bancária do TRABALHADOR.

4.3. À remuneração são deduzidos os descontos legais (IRT e Segurança Social) e, nos termos da lei:

a. as faltas injustificadas;

b. os adiantamentos e outros valores devidos pelo TRABALHADOR à EMPRESA, nos limites legais.

## 5. HORÁRIO, FÉRIAS E SUBSÍDIOS

5.1. O período normal de trabalho é de {{empresa.jornada_horas}} horas diárias e {{pacote.horas_semanais}} horas semanais, segundo o horário em vigor na EMPRESA.

5.2. O TRABALHADOR tem direito a {{pacote.dias_ferias}} dias úteis de férias remuneradas por ano, marcadas por acordo entre as partes ou, na falta de acordo, pela EMPRESA no mapa de férias.

5.3. O TRABALHADOR tem direito aos subsídios de férias e de Natal, nos termos da Lei Geral do Trabalho.

## 6. CESSAÇÃO DO CONTRATO

6.1. O contrato pode cessar por acordo das partes, por caducidade, por despedimento ou por demissão do TRABALHADOR, nos termos e com os avisos prévios previstos na Lei Geral do Trabalho.

6.2. A falta de aviso prévio obriga a parte faltosa a indemnizar a outra nos termos da lei.

## 7. DISPOSIÇÕES GERAIS

7.1. No momento da celebração do presente contrato, o TRABALHADOR tomou conhecimento do horário de trabalho e do regulamento interno em vigor na EMPRESA.

7.2. Em tudo o que não estiver expressamente previsto aplica-se a Lei Geral do Trabalho e demais legislação aplicável.

## 8. LEI APLICÁVEL E FORO

8.1. O presente contrato rege-se pela lei angolana, sendo competente para dirimir os litígios dele emergentes o tribunal da comarca de {{empresa.cidade}}.

E, por assim estarem justos e acordados, as partes assinam o presente contrato em 2 (dois) exemplares de igual teor e forma.

{{empresa.cidade}}, {{data.hoje}}

${ASSINATURAS('TRABALHADOR // {{colaborador.nome}}', 'PELA EMPRESA // {{empresa.nome}}')}

**TESTEMUNHAS:**

${ASSINATURAS('1.ª testemunha', '2.ª testemunha')}`,
  },
  {
    key: 'declaracao_servico', title: 'Declaração de serviço', category: 'declaration',
    description: 'Confirma o vínculo, a antiguidade e a função (bancos, embaixadas, escolas).',
    inputs: [{ key: 'pedido.finalidade', label: 'Finalidade', placeholder: 'Ex.: abertura de conta bancária', required: true }],
    body: `# Declaração

Para os devidos efeitos, **{{empresa.nome}}**, contribuinte n.º {{empresa.nif}}, declara que **{{colaborador.nome}}**, portador(a) do Bilhete de Identidade n.º {{colaborador.bi}}, é trabalhador(a) desta empresa desde {{contrato.admissao}}, com {{contrato.tipo}}, exercendo actualmente as funções de {{colaborador.funcao}}.

A presente declaração destina-se a {{pedido.finalidade}} e é emitida a pedido do(a) interessado(a).

{{empresa.cidade}}, {{data.hoje}}

${ASSINATURAS('A Direcção / Recursos Humanos', '')}`,
  },
  {
    key: 'declaracao_rendimentos', title: 'Declaração de rendimentos', category: 'declaration',
    description: 'Vínculo e remuneração actual, com o líquido médio dos últimos três recibos fechados (crédito, arrendamento).',
    inputs: [{ key: 'pedido.finalidade', label: 'Finalidade', placeholder: 'Ex.: pedido de crédito habitação', required: true }],
    body: `# Declaração de rendimentos

Para os devidos efeitos, **{{empresa.nome}}**, contribuinte n.º {{empresa.nif}}, declara que **{{colaborador.nome}}**, portador(a) do Bilhete de Identidade n.º {{colaborador.bi}}, é trabalhador(a) desta empresa desde {{contrato.admissao}}, com {{contrato.tipo}}, exercendo as funções de {{colaborador.funcao}}.

Aufere o salário base mensal ilíquido de {{remuneracao.base}} ({{remuneracao.base_extenso}}), sendo a remuneração mensal ilíquida, com os subsídios de alimentação e transporte, de {{remuneracao.total}} ({{remuneracao.total_extenso}}).

{{#se rendimentos.liquido_medio_3m}}O salário líquido médio dos últimos recibos processados ({{rendimentos.meses}}) foi de {{rendimentos.liquido_medio_3m}}.

{{/se}}A presente declaração destina-se a {{pedido.finalidade}} e é emitida a pedido do(a) interessado(a).

{{empresa.cidade}}, {{data.hoje}}

${ASSINATURAS('A Direcção / Recursos Humanos', '')}`,
  },
  {
    key: 'certificado_trabalho', title: 'Certificado de trabalho', category: 'certificate',
    description: 'Entregue na cessação do contrato: período de trabalho e últimas funções.',
    inputs: [],
    body: `# Certificado de trabalho

Para os devidos efeitos, certifica-se que **{{colaborador.nome}}**, portador(a) do Bilhete de Identidade n.º {{colaborador.bi}}, prestou trabalho em **{{empresa.nome}}**, contribuinte n.º {{empresa.nif}}, de {{contrato.admissao}} a {{contrato.cessacao}}, tendo exercido por último as funções de {{colaborador.funcao}}.

Por ser verdade e a pedido do(a) interessado(a), passa-se o presente certificado.

{{empresa.cidade}}, {{data.hoje}}

${ASSINATURAS('A Direcção / Recursos Humanos', '')}`,
  },
  {
    key: 'aviso_nao_renovacao', title: 'Comunicação de não renovação do contrato a termo', category: 'communication',
    description: 'Aviso escrito com 30 dias de antecedência; sem aviso, a empresa paga 30 dias.',
    inputs: [],
    body: `# Comunicação de não renovação do contrato

Exmo(a). Senhor(a) **{{colaborador.nome}}**,

Nos termos da Lei Geral do Trabalho (Lei n.º 12/23, de 27 de Dezembro), comunicamos que o contrato de trabalho por tempo determinado celebrado consigo com início em {{contrato.inicio}} não será renovado, cessando os seus efeitos no seu termo, em {{contrato.fim}}.

Os créditos emergentes do contrato e da sua cessação serão pagos no fecho de contas, sendo-lhe entregue o respectivo certificado de trabalho.

Com os melhores cumprimentos,

{{empresa.cidade}}, {{data.hoje}}

${ASSINATURAS('A Direcção / Recursos Humanos', 'Recebi o original (data e assinatura)')}`,
  },
  {
    key: 'comunicacao_alteracao_salarial', title: 'Comunicação de alteração salarial', category: 'communication',
    description: 'Informa a nova remuneração e a data de efeito (a remuneração em vigor na ficha).',
    inputs: [{ key: 'pedido.motivo', label: 'Motivo', placeholder: 'Ex.: actualização salarial anual', required: false }],
    body: `# Comunicação de alteração salarial

Exmo(a). Senhor(a) **{{colaborador.nome}}**,

Comunicamos que, com efeitos a partir de {{remuneracao.desde}}{{#se pedido.motivo}} e em virtude de {{pedido.motivo}}{{/se}}, a sua remuneração mensal passa a ser a seguinte: salário base de {{remuneracao.base}} ({{remuneracao.base_extenso}}){{#se remuneracao.alimentacao}}, subsídio de alimentação de {{remuneracao.alimentacao}}{{/se}}{{#se remuneracao.transporte}} e subsídio de transporte de {{remuneracao.transporte}}{{/se}}.

As restantes condições do seu contrato de trabalho mantêm-se inalteradas.

Com os melhores cumprimentos,

{{empresa.cidade}}, {{data.hoje}}

${ASSINATURAS('A Direcção / Recursos Humanos', 'Tomei conhecimento')}`,
  },
  {
    key: 'acordo_regime_horario', title: 'Acordo de regime de horário (turnos/rotação)', category: 'contract',
    description: 'Formaliza por escrito o regime de turnos ou de rotação atribuído ao trabalhador e os subsídios associados.',
    inputs: [
      { key: 'pedido.local_trabalho', label: 'Local de trabalho', placeholder: 'Ex.: Mina do Cafunfo, Lunda Norte', required: true },
      { key: 'pedido.viagens', label: 'Regime das viagens base ↔ local', placeholder: 'Ex.: dias de viagem por conta da empresa, fora do tempo de trabalho', required: false },
    ],
    body: `# Acordo de regime de horário

Entre **{{empresa.nome}}**, contribuinte n.º {{empresa.nif}}, adiante designada por Empregador, e **{{colaborador.nome}}**, portador(a) do Bilhete de Identidade n.º {{colaborador.bi}}, com a função de {{colaborador.funcao}}, adiante designado(a) por Trabalhador, é celebrado o presente acordo, complementar ao contrato de trabalho, nos termos da Lei Geral do Trabalho (Lei n.º 12/23, de 27 de Dezembro):

**1.ª (Regime)** — O Trabalhador presta o seu trabalho em regime de **{{horario.nome}}** ({{horario.descricao}}){{#se horario.inicio_ciclo}}, com início do ciclo em {{horario.inicio_ciclo}}{{/se}}.

**2.ª (Duração média)** — A duração média do trabalho, apurada ao longo do ciclo, é de {{horario.media_semanal}} horas por semana. O trabalho prestado para além do previsto na escala é trabalho extraordinário, remunerado nos termos legais.

**3.ª (Local)** — O trabalho é prestado em {{pedido.local_trabalho}}.{{#se pedido.viagens}} As deslocações entre a base e o local de trabalho regem-se pelo seguinte: {{pedido.viagens}}.{{/se}}

**4.ª (Descanso)** — Os dias de descanso previstos no ciclo substituem o descanso semanal, garantindo-se a média de descanso legalmente exigida.

{{#se subsidios.lista}}**5.ª (Subsídios)** — Em razão do regime, o Trabalhador aufere: {{subsidios.lista}}, sujeitos aos descontos legais aplicáveis.

{{/se}}**Disposição final** — Em tudo o que não estiver previsto neste acordo aplica-se o contrato de trabalho e a legislação laboral em vigor. Feito em dois exemplares, ficando um com cada parte.

{{empresa.cidade}}, {{data.hoje}}

${ASSINATURAS('O Empregador', 'O Trabalhador')}`,
  },
];

// ——— Composição ———

/** Substitui os campos e resolve os blocos condicionais. Campos sem valor ficam visíveis como [campo] e são listados. */
export function renderTemplate(body: string, data: Record<string, string | null | undefined>): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const has = (k: string) => { const v = data[k]; return v !== undefined && v !== null && String(v).trim() !== ''; };
  let text = body;
  // Blocos condicionais (sem aninhamento).
  text = text.replace(/\{\{#se\s+([\w.]+)\}\}([\s\S]*?)\{\{\/se\}\}/g, (_, k: string, inner: string) => (has(k) ? inner : ''));
  text = text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => {
    if (has(k)) return String(data[k]).trim();
    missing.add(k);
    return `[${k}]`;
  });
  return { text, missing: [...missing] };
}

/** Campos usados num modelo (para validar modelos editados pela empresa). */
export function templateFields(body: string): string[] {
  return [...new Set([...body.matchAll(/\{\{\s*#?(?:se\s+)?([\w.]+)\s*\}\}/g)].map((m) => m[1]!).filter((k) => k !== 'se'))];
}

export function unknownFields(body: string): string[] {
  const known = new Set(DOCUMENT_FIELDS.map((f) => f.key));
  return templateFields(body).filter((k) => !known.has(k) && !k.startsWith('pedido.'));
}

export type DocBlock =
  | { type: 'title'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; spans: { text: string; bold: boolean }[]; indent?: 1 | 2 | 3 }
  | { type: 'signatures'; labels: string[]; names?: string[] };

/** Marcadores de alínea: «1.1.» (nível 1), «a.»/«a)» (nível 2), «b1.» (nível 3). */
const ITEM_RE = /^(?:\d+\.\d+(?:\.\d+)*\.?|[a-z]\)|[a-z]\.|[a-z]\d+[.)])\s/;
function itemIndent(p: string): 1 | 2 | 3 | undefined {
  if (/^\d+\.\d+(?:\.\d+)*\.?\s/.test(p)) return 1;
  if (/^[a-z][.)]\s/.test(p)) return 2;
  if (/^[a-z]\d+[.)]\s/.test(p)) return 3;
  return undefined;
}
const spansOf = (p: string) => p.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((s) => (s.startsWith('**') && s.endsWith('**') ? { text: s.slice(2, -2), bold: true } : { text: s.replace(/\n/g, ' '), bold: false }));

/**
 * Converte o texto de um modelo em blocos. «# » título, «## » secção (ex.: «## 1. OBJECTO»),
 * alíneas numeradas (1.1., a., b1.) em linhas próprias, «--- assinaturas: Função // Nome | …».
 */
export function documentBlocks(text: string): DocBlock[] {
  const raw = text.split(/\n\s*\n/).map((r) => r.trim()).filter(Boolean)
    // Alíneas seguidas numa só linha de parágrafo passam a blocos próprios.
    .flatMap((p) => (p.split('\n').slice(1).some((l) => ITEM_RE.test(l.trim())) ? p.split(/\n(?=\s*(?:\d+\.\d+|[a-z]\d*[.)])\s)/).map((x) => x.trim()) : [p]));
  return raw.map((p): DocBlock => {
    if (p.startsWith('## ')) return { type: 'heading', text: p.slice(3).trim() };
    if (p.startsWith('# ')) return { type: 'title', text: p.slice(2).trim() };
    const sig = /^---\s*assinaturas:\s*(.*)$/i.exec(p);
    if (sig) {
      const parts = sig[1]!.split('|').map((s) => s.split('//').map((x) => x.trim()));
      const names = parts.map((x) => x[1] ?? '');
      return { type: 'signatures', labels: parts.map((x) => x[0]!), ...(names.some(Boolean) ? { names } : {}) };
    }
    const indent = itemIndent(p);
    return { type: 'paragraph', spans: spansOf(p), ...(indent ? { indent } : {}) };
  });
}

/**
 * Reconstrói a estrutura de um modelo importado (Word ou PDF): retira cabeçalhos/rodapés repetidos
 * e numeração de página, junta as linhas partidas do PDF em parágrafos e marca título, secções e alíneas.
 */
export function structureImportedText(lines: string[], source: 'pdf' | 'word'): string {
  const clean = lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const count = new Map<string, number>();
  for (const l of clean) count.set(l, (count.get(l) ?? 0) + 1);
  const body = clean.filter((l) => !/^(?:p[áa]gina\s*)?\d+\s*(?:\/|de)\s*\d+$/i.test(l) && !(source === 'pdf' && (count.get(l) ?? 0) > 1 && l.length > 25));
  const blocks: string[] = [];
  let titled = false;
  for (const l of body) {
    if (/^#{1,2} /.test(l) || /^---\s*assinaturas:/i.test(l)) { blocks.push(l); titled ||= l.startsWith('# '); continue; }
    const upper = l === l.toLocaleUpperCase('pt') && /[A-ZÀ-Ú]{3}/.test(l);
    if (!titled && upper && /CONTRATO|DECLARA|ACORDO|CERTIFICADO|ADENDA|TERMO|AVISO|NOTA|CARTA|REGULAMENTO/.test(l) && l.length < 120) { blocks.push(`# ${l}`); titled = true; continue; }
    if (/^\d+\.\s+\S/.test(l) && upper && l.length < 90) { blocks.push(`## ${l}`); continue; }
    const prev = blocks.at(-1);
    const startsNew = ITEM_RE.test(l) || /^_{3,}/.test(l) || !prev || prev.startsWith('#') || /^_{3,}/.test(prev);
    const joins = source === 'pdf' && !startsNew && !(/[.:;!?]$/.test(prev!) && /^[A-ZÀ-Ú"«(]/.test(l));
    if (joins) blocks[blocks.length - 1] = `${prev} ${l}`;
    else blocks.push(l);
  }
  return blocks.join('\n\n');
}

// ——— Valores por extenso ———

const UNITS = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezasseis', 'dezassete', 'dezoito', 'dezanove'];
const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const HUNDREDS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function below1000(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(HUNDREDS[h]!);
  if (r) parts.push(r < 20 ? UNITS[r]! : TENS[Math.floor(r / 10)]! + (r % 10 ? ` e ${UNITS[r % 10]}` : ''));
  return parts.join(' e ');
}

/** Número inteiro por extenso em português (escala longa: milhão, mil milhões). */
export function numberToWordsPt(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('inteiro não negativo');
  if (n === 0) return 'zero';
  const groups: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 1000)) groups.push(v % 1000);
  const scale = (i: number, g: number) => ['', 'mil', g === 1 ? 'milhão' : 'milhões', 'mil milhões', g === 1 ? 'bilião' : 'biliões'][i] ?? '';
  const parts: { text: string; g: number }[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!;
    if (!g) continue;
    if (i === 1) parts.push({ text: g === 1 ? 'mil' : `${below1000(g)} mil`, g });
    else if (i === 3) parts.push({ text: `${g === 1 ? 'mil' : `${below1000(g)} mil`} milhões`, g });
    else parts.push({ text: i ? `${below1000(g)} ${scale(i, g)}` : below1000(g), g });
  }
  // "e" antes do último grupo quando este é < 100 ou centena exacta (ex.: "mil e duzentos", "dois mil e cinco").
  return parts.map((p, i) => (i > 0 && i === parts.length - 1 && (p.g < 100 || p.g % 100 === 0) ? `e ${p.text}` : p.text)).join(' ').replace(/\s+/g, ' ');
}

/** Valor em kwanzas por extenso: "trezentos mil kwanzas e cinquenta cêntimos". */
export function kzInWords(minor: Minor): string {
  const kz = Math.floor(Math.abs(minor) / 100);
  const c = Math.abs(minor) % 100;
  const main = `${numberToWordsPt(kz)} ${kz === 1 ? 'kwanza' : 'kwanzas'}`;
  return c ? `${main} e ${numberToWordsPt(c)} ${c === 1 ? 'cêntimo' : 'cêntimos'}` : main;
}

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const longDatePt = (d: string) => `${Number(d.slice(8, 10))} de ${MONTHS[Number(d.slice(5, 7)) - 1]} de ${d.slice(0, 4)}`;
