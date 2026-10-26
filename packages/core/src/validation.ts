/** Validações de identificação angolanas. Verificam formato, não titularidade. */

/** BI angolano: 9 dígitos + 2 letras (província) + 3 dígitos. Ex.: 004512398LA041 */
export function isValidAngolanBI(value: string): boolean {
  return /^\d{9}[A-Z]{2}\d{3}$/.test(value.trim().toUpperCase());
}

export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
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

export function formatIban(value: string): string {
  return normalizeIban(value).replace(/(.{4})/g, '$1 ').trim();
}

/** NIF de pessoa colectiva angolana: 10 dígitos. Pessoa singular usa o número do BI. */
export function isValidCompanyNif(value: string): boolean {
  return /^\d{10}$/.test(value.trim());
}
