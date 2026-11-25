/** Validações de identificação angolanas. Verificam formato, não titularidade. */

/** BI angolano: 9 dígitos + 2 letras (província) + 3 dígitos. Ex.: 004512398LA041 */
export function isValidAngolanBI(value: string): boolean {
  return /^\d{9}[A-Z]{2}\d{3}$/.test(value.trim().toUpperCase());
}

export function normalizeIban(value: string): string {
  // Aceita espaços, pontos e traços (como aparecem em extractos e no multicaixa) e o prefixo "IBAN".
  const s = value
    .toUpperCase()
    .replace(/^IBAN[:\s]*/, '')
    .replace(/[\s.\-]+/g, '');
  // Só os 21 dígitos da conta (NBA): os IBAN angolanos têm sempre o prefixo AO06.
  return /^\d{21}$/.test(s) ? `AO06${s}` : s;
}

/** IBAN genérico ISO 13616 (mod 97). */
export function isValidIban(value: string): boolean {
  const s = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const code = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of code) rem = (rem * 10 + Number(digit)) % 97;
  }
  return rem === 1;
}

/** IBAN angolano: AO + 23 caracteres numéricos (25 no total) e dígitos de controlo válidos. */
export function isValidAngolanIban(value: string): boolean {
  const s = normalizeIban(value);
  return /^AO\d{23}$/.test(s) && isValidIban(s);
}

/** Diagnóstico em português de um IBAN angolano inválido (null se for válido). */
export function angolanIbanProblem(value: string): string | null {
  const s = normalizeIban(value);
  if (!s) return 'Indique o IBAN';
  if (!s.startsWith('AO')) return 'O IBAN angolano começa por AO06';
  const digits = s.slice(2);
  if (!/^\d+$/.test(digits)) return 'O IBAN só pode ter números depois de "AO"';
  if (s.length !== 25)
    return `O IBAN tem ${s.length - 4 > 0 ? s.length - 4 : 0} dígitos depois de AO06; devem ser 21 (total de 25 caracteres)`;
  if (!isValidIban(s))
    return 'Os dígitos de controlo não conferem: há um número trocado ou em falta. Copie o IBAN do extracto ou da app do banco';
  return null;
}

export function formatIban(value: string): string {
  return normalizeIban(value)
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

/** NIF de pessoa colectiva angolana: 10 dígitos. Pessoa singular usa o número do BI. */
export function isValidCompanyNif(value: string): boolean {
  return /^\d{10}$/.test(value.trim());
}

/** Valores provisórios completos. A comparação nunca procura partes de apelidos. */
export function registrationNameProblem(value: string): string | null {
  const normalized = value.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const placeholders = new Set([
    'test',
    'teste',
    'demo',
    'admin',
    'administrador',
    'administrator',
    'exemplo',
    'asdf',
    'qwerty',
  ]);
  if (!/\p{L}/u.test(normalized) || (words.length > 0 && words.every(word => placeholders.has(word)))) {
    return 'Indique um nome real. Valores como Teste, Demo ou Admin não são aceites.';
  }
  return null;
}

/** NIF com dígitos repetidos ou em sequência: um sinal para confirmar, nunca a prova de que não existe. */
export function isUnusualNif(nif: string): boolean {
  const n = nif.trim();
  return /(\d)\1{5}/.test(n) || '01234567890123456789'.includes(n) || '98765432109876543210'.includes(n);
}

/** Sinais para revisão humana, sem afirmar a existência ou titularidade fiscal. */
export function registrationReviewReasons(nif: string): string[] {
  return isUnusualNif(nif) ? ['O NIF apresenta uma sequência ou repetição de dígitos que requer confirmação.'] : [];
}

export const ownerNameProblem = (name: string) =>
  Boolean(registrationNameProblem(name) || !/^[\p{L}\p{M} .’'\-]+$/u.test(name.trim()));

export const ownerEmailProblem = (email: string | null) =>
  !email ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
  /^(?:teste?|demo|exemplo)(?:[0-9._+-]*|[._+-][^@]*)@/i.test(email);

/** Aviso de regularização, incluindo contas anteriores às validações do cadastro. */
export function ownerRegistrationIssues(name: string, email: string | null): string[] {
  const issues: string[] = [];
  if (ownerNameProblem(name)) issues.push('Confirme o nome completo do proprietário.');
  if (ownerEmailProblem(email))
    issues.push('Confirme o email do proprietário e utilize um endereço real ao qual tenha acesso.');
  return issues;
}

export type RegistrationCheckKey = 'nif' | 'companyName' | 'ownerName' | 'ownerEmail' | 'review';
export type RegistrationCheck = {
  key: RegistrationCheckKey;
  label: string;
  value: string | null;
  /** ok: cumpre · invalid: não cumpre · pending: por confirmar (NIF invulgar, email novo por confirmar ou revisão manual). */
  status: 'ok' | 'invalid' | 'pending';
  /** Enquanto o cadastro está em revisão, um ponto bloqueante por resolver impede o acesso aos módulos. */
  blocking: boolean;
  message: string | null;
};

/**
 * Lista de pontos do cadastro, igual para o cliente e para a consola.
 * Só bloqueia o que a revisão bloqueia: NIF invulgar e nomes provisórios (empresa ou proprietário).
 * O email nunca bloqueia: é um aviso até ser corrigido.
 */
export function registrationChecklist(input: {
  companyName: string;
  nif: string;
  ownerName: string | null;
  ownerEmail: string | null;
  pendingEmail?: string | null;
  inReview: boolean;
}): RegistrationCheck[] {
  const items: RegistrationCheck[] = [];
  const unusual = isUnusualNif(input.nif);
  items.push({
    key: 'nif',
    label: 'NIF',
    value: input.nif,
    status: unusual ? 'pending' : 'ok',
    blocking: input.inReview,
    message: unusual
      ? 'O número tem um padrão invulgar (dígitos repetidos ou em sequência). Corrija se houver engano ou envie o comprovativo do NIF.'
      : null,
  });
  if (registrationNameProblem(input.companyName))
    items.push({
      key: 'companyName',
      label: 'Nome da empresa',
      value: input.companyName,
      status: 'invalid',
      blocking: input.inReview,
      message: 'Não cumpre os requisitos: parece um nome de teste. Indique a denominação real da empresa.',
    });
  if (input.ownerName !== null)
    items.push({
      key: 'ownerName',
      label: 'Nome do proprietário',
      value: input.ownerName,
      status: ownerNameProblem(input.ownerName) ? 'invalid' : 'ok',
      blocking: input.inReview,
      message: ownerNameProblem(input.ownerName)
        ? 'Não cumpre os requisitos: indique o nome completo, sem números nem valores como Teste, Demo ou Admin.'
        : null,
    });
  const emailBad = ownerEmailProblem(input.ownerEmail);
  items.push({
    key: 'ownerEmail',
    label: 'Email do proprietário',
    value: input.ownerEmail,
    status: input.pendingEmail ? 'pending' : emailBad ? 'invalid' : 'ok',
    blocking: false,
    message: input.pendingEmail
      ? `Enviámos uma ligação de confirmação para ${input.pendingEmail}. O email muda quando a confirmar.`
      : emailBad
        ? 'Não cumpre os requisitos: parece um endereço de teste. Use um email real a que tenha acesso.'
        : null,
  });
  // Revisão sem motivo que o cliente possa corrigir (ex.: marcada pela equipa): só o suporte a resolve.
  if (input.inReview && !items.some(i => i.blocking && i.status !== 'ok'))
    items.unshift({
      key: 'review',
      label: 'Confirmação pela equipa Kianda',
      value: null,
      status: 'pending',
      blocking: true,
      message: 'A equipa Kianda está a confirmar os dados da empresa. Contacte o suporte se precisar de ajuda.',
    });
  return items;
}

/** Pontos que ainda impedem o acesso. */
export const blockingChecks = (items: RegistrationCheck[]) => items.filter(i => i.blocking && i.status !== 'ok');
