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
  { key: 'data.hoje', label: 'Data de hoje (por extenso)' },
];

const ASSINATURAS = (a: string, b: string) => `--- assinaturas: ${a} | ${b}`;

export const BUILTIN_TEMPLATES: DocumentTemplate[] = [
  {
    key: 'contrato_indeterminado', title: 'Contrato de trabalho por tempo indeterminado', category: 'contract',
    description: 'Contrato regra da Lei Geral do Trabalho, com período experimental, remuneração e férias.',
    inputs: [{ key: 'pedido.local_trabalho', label: 'Local de trabalho', placeholder: 'Ex.: Luanda, instalações da empresa', required: true }],
    body: `# Contrato de trabalho por tempo indeterminado

Entre **{{empresa.nome}}**, contribuinte n.º {{empresa.nif}}, com sede em {{empresa.morada}}, adiante designada por Empregador, e **{{colaborador.nome}}**, portador(a) do Bilhete de Identidade n.º {{colaborador.bi}}{{#se colaborador.nif}}, contribuinte n.º {{colaborador.nif}}{{/se}}{{#se colaborador.morada}}, residente em {{colaborador.morada}}{{/se}}, adiante designado(a) por Trabalhador, é celebrado o presente contrato de trabalho, nos termos da Lei Geral do Trabalho (Lei n.º 12/23, de 27 de Dezembro), que se rege pelas cláusulas seguintes:

**Cláusula 1.ª (Funções)** — O Trabalhador é admitido para exercer as funções de {{colaborador.funcao}}{{#se colaborador.departamento}}, no departamento de {{colaborador.departamento}}{{/se}}, obrigando-se a desempenhá-las com zelo, diligência e lealdade.

**Cláusula 2.ª (Início e duração)** — O contrato produz efeitos a partir de {{contrato.inicio}} e é celebrado por tempo indeterminado.

**Cláusula 3.ª (Período experimental)** — Os primeiros {{pacote.periodo_experimental}} dias de execução do contrato constituem período experimental, durante o qual qualquer das partes o pode fazer cessar sem aviso prévio, indemnização ou justificação.

**Cláusula 4.ª (Local e horário)** — O trabalho é prestado em {{pedido.local_trabalho}}, com o período normal de trabalho de {{empresa.jornada_horas}} horas diárias e {{pacote.horas_semanais}} horas semanais, segundo o horário em vigor na empresa.

**Cláusula 5.ª (Remuneração)** — O Trabalhador aufere o salário base mensal de {{remuneracao.base}} ({{remuneracao.base_extenso}}){{#se remuneracao.alimentacao}}, acrescido de subsídio de alimentação de {{remuneracao.alimentacao}}{{/se}}{{#se remuneracao.transporte}} e de subsídio de transporte de {{remuneracao.transporte}}{{/se}}, pagos mensalmente por transferência bancária, deduzidos os descontos legais (IRT e Segurança Social).

**Cláusula 6.ª (Férias e subsídios)** — O Trabalhador tem direito a {{pacote.dias_ferias}} dias úteis de férias remuneradas por ano civil, bem como aos subsídios de férias e de Natal, nos termos da lei.

**Cláusula 7.ª (Cessação)** — A cessação do contrato rege-se pelo disposto na Lei Geral do Trabalho.

**Cláusula 8.ª (Disposições finais)** — Em tudo o que não estiver expressamente previsto aplica-se a Lei Geral do Trabalho e demais legislação aplicável. O presente contrato é feito em dois exemplares, ficando um em poder de cada parte.

{{empresa.cidade}}, {{data.hoje}}

${ASSINATURAS('O Empregador', 'O Trabalhador')}`,
  },
  {
    key: 'contrato_termo', title: 'Contrato de trabalho por tempo determinado', category: 'contract',
    description: 'Só nas situações excepcionais da lei: o fundamento do termo é obrigatório e tem de constar do contrato.',
    inputs: [{ key: 'pedido.local_trabalho', label: 'Local de trabalho', placeholder: 'Ex.: Luanda, instalações da empresa', required: true }],
    body: `# Contrato de trabalho por tempo determinado

Entre **{{empresa.nome}}**, contribuinte n.º {{empresa.nif}}, com sede em {{empresa.morada}}, adiante designada por Empregador, e **{{colaborador.nome}}**, portador(a) do Bilhete de Identidade n.º {{colaborador.bi}}{{#se colaborador.nif}}, contribuinte n.º {{colaborador.nif}}{{/se}}{{#se colaborador.morada}}, residente em {{colaborador.morada}}{{/se}}, adiante designado(a) por Trabalhador, é celebrado o presente contrato de trabalho por tempo determinado, nos termos da Lei Geral do Trabalho (Lei n.º 12/23, de 27 de Dezembro), que se rege pelas cláusulas seguintes:

**Cláusula 1.ª (Funções)** — O Trabalhador é admitido para exercer as funções de {{colaborador.funcao}}{{#se colaborador.departamento}}, no departamento de {{colaborador.departamento}}{{/se}}.

**Cláusula 2.ª (Duração e fundamento)** — O contrato tem início em {{contrato.inicio}} e termo em {{contrato.fim}}, sendo celebrado com o seguinte fundamento: {{contrato.fundamento}}.

**Cláusula 3.ª (Renovação)** — A parte que não pretenda a renovação deve comunicá-lo à outra por escrito com a antecedência mínima de 30 dias (art. 17.º, n.º 3, da Lei Geral do Trabalho).

**Cláusula 4.ª (Período experimental)** — Os primeiros {{pacote.periodo_experimental_termo}} dias de execução do contrato constituem período experimental.

**Cláusula 5.ª (Local e horário)** — O trabalho é prestado em {{pedido.local_trabalho}}, com o período normal de trabalho de {{empresa.jornada_horas}} horas diárias e {{pacote.horas_semanais}} horas semanais.

**Cláusula 6.ª (Remuneração)** — O Trabalhador aufere o salário base mensal de {{remuneracao.base}} ({{remuneracao.base_extenso}}){{#se remuneracao.alimentacao}}, acrescido de subsídio de alimentação de {{remuneracao.alimentacao}}{{/se}}{{#se remuneracao.transporte}} e de subsídio de transporte de {{remuneracao.transporte}}{{/se}}, deduzidos os descontos legais.

**Cláusula 7.ª (Férias e subsídios)** — O Trabalhador tem direito a férias e aos subsídios de férias e de Natal proporcionais à duração do contrato, nos termos da lei.

**Cláusula 8.ª (Disposições finais)** — Aplica-se subsidiariamente a Lei Geral do Trabalho. Feito em dois exemplares, ficando um em poder de cada parte.

{{empresa.cidade}}, {{data.hoje}}

${ASSINATURAS('O Empregador', 'O Trabalhador')}`,
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
    description: 'Aviso escrito com 30 dias de antecedência (art. 17.º, n.º 3); sem aviso, a empresa paga 30 dias.',
    inputs: [],
    body: `# Comunicação de não renovação do contrato

Exmo(a). Senhor(a) **{{colaborador.nome}}**,

Nos termos do n.º 3 do artigo 17.º da Lei Geral do Trabalho (Lei n.º 12/23, de 27 de Dezembro), comunicamos que o contrato de trabalho por tempo determinado celebrado consigo com início em {{contrato.inicio}} não será renovado, cessando os seus efeitos no seu termo, em {{contrato.fim}}.

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
  | { type: 'paragraph'; spans: { text: string; bold: boolean }[] }
  | { type: 'signatures'; labels: string[] };

/** Texto composto → blocos para apresentar/imprimir sem HTML arbitrário. */
export function documentBlocks(text: string): DocBlock[] {
  return text.split(/\n\s*\n/).map((raw) => raw.trim()).filter(Boolean).map((p): DocBlock => {
    if (p.startsWith('# ')) return { type: 'title', text: p.slice(2).trim() };
    const sig = /^---\s*assinaturas:\s*(.*)$/i.exec(p);
    if (sig) return { type: 'signatures', labels: sig[1]!.split('|').map((s) => s.trim()) };
    const spans = p.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((s) => (s.startsWith('**') && s.endsWith('**') ? { text: s.slice(2, -2), bold: true } : { text: s.replace(/\n/g, ' '), bold: false }));
    return { type: 'paragraph', spans };
  });
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
