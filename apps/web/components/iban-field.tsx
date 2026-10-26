'use client';

import { angolanIbanProblem, formatIban, normalizeIban } from '@kianda/core';
import { useState } from 'react';

const BANKS: Record<string, string> = { '0006': 'BFA', '0040': 'BAI' };

/** Campo de IBAN com validação imediata (mesmo motor da API) e formatação em grupos de 4. */
export function IbanField({ defaultValue, className }: { defaultValue?: string | null; className?: string }) {
  const [value, setValue] = useState(defaultValue ? formatIban(defaultValue) : '');
  const [touched, setTouched] = useState(false);
  const problem = value.trim() ? angolanIbanProblem(value) : null;
  const n = normalizeIban(value);
  const bank = !problem && n.length === 25 ? BANKS[n.slice(4, 8)] : undefined;
  return (
    <label className={className}>
      IBAN
      <input
        name="iban"
        value={value}
        placeholder="AO06 0040 0000 5521 8890 1015 5"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => { setTouched(true); if (value.trim() && !angolanIbanProblem(value)) setValue(formatIban(value)); }}
        aria-invalid={!!problem && touched}
        style={problem && touched ? { borderColor: 'var(--red)' } : undefined}
      />
      {problem && touched && <span style={{ color: 'var(--red)', fontWeight: 500 }}>{problem}</span>}
      {!problem && value.trim() && <span style={{ color: 'var(--brand)', fontWeight: 500 }}>IBAN válido{bank ? ` · ${bank}` : ''}</span>}
    </label>
  );
}
