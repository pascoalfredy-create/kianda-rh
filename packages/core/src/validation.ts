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

/** Sinais para revisão humana, sem afirmar a existência ou titularidade fiscal. */
export function registrationReviewReasons(nif: string): string[] {
  if (/(\d)\1{5}/.test(nif) || '01234567890123456789'.includes(nif) || '98765432109876543210'.includes(nif)) {
    return ['O NIF apresenta uma sequência ou repetição de dígitos que requer confirmação.'];
  }
  return [];
}

/** Aviso de regularização, incluindo contas anteriores às validações do cadastro. */
export function ownerRegistrationIssues(name: string, email: string | null): string[] {
  const issues: string[] = [];
  if (registrationNameProblem(name) || !/^[\p{L}\p{M} .’'\-]+$/u.test(name.trim())) {
    issues.push('Confirme o nome completo do proprietário.');
  }
  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    /^(?:teste?|demo|exemplo)(?:[0-9._+-]*|[._+-][^@]*)@/i.test(email)
  ) {
    issues.push('Confirme o email do proprietário e utilize um endereço real ao qual tenha acesso.');
  }
  return issues;
}
