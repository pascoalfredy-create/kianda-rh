/** Validações de identificação angolanas. Verificam formato, não titularidade. */

/** BI angolano: 9 dígitos + 2 letras (província) + 3 dígitos. Ex.: 004512398LA041 */
export function isValidAngolanBI(value: string): boolean {
  return /^\d{9}[A-Z]{2}\d{3}$/.test(value.trim().toUpperCase());
}

export function normalizeIban(value: string): string {
  // Aceita espaços, pontos e traços (como aparecem em extractos e no multicaixa) e o prefixo "IBAN".
  const s = value.toUpperCase().replace(/^IBAN[:\s]*/, '').replace(/[\s.\-]+/g, '');
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
  if (s.length !== 25) return `O IBAN tem ${s.length - 4 > 0 ? s.length - 4 : 0} dígitos depois de AO06; devem ser 21 (total de 25 caracteres)`;
  if (!isValidIban(s)) return 'Os dígitos de controlo não conferem: há um número trocado ou em falta. Copie o IBAN do extracto ou da app do banco';
  return null;
}

export function formatIban(value: string): string {
  return normalizeIban(value).replace(/(.{4})/g, '$1 ').trim();
}

/** NIF de pessoa colectiva angolana: 10 dígitos. Pessoa singular usa o número do BI. */
export function isValidCompanyNif(value: string): boolean {
  return /^\d{10}$/.test(value.trim());
}
