'use client';

import { useId, useState, type InputHTMLAttributes } from 'react';

/** O botão só muda a apresentação local; mantém o valor, autocomplete e validação do campo. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false), generatedId = useId();
  const id = props.id ?? generatedId;
  return <span className="password-field">
    <input {...props} id={id} type={visible ? 'text' : 'password'} />
    <button type="button" aria-label={visible ? 'Ocultar palavra-passe' : 'Mostrar palavra-passe'} aria-controls={id} aria-pressed={visible} onClick={() => setVisible(v => !v)}>
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{visible && <path d="m3 3 18 18" />}</svg>
    </button>
  </span>;
}
