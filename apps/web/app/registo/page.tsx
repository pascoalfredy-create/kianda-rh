import { registrationSelection, type RegistrationQuery } from '../../lib/registration-selection';
import { RegistoForm } from './form';

/** Ligações públicas com plano (?modulo=…&plano=…&ciclo=…) chegam ao cadastro com a escolha preenchida. */
export default async function Registo({ searchParams }: { searchParams?: Promise<RegistrationQuery> } = {}) {
  const query = (await searchParams) ?? {};
  return <RegistoForm selection={typeof query.plano === 'string' ? registrationSelection(query) : null} />;
}
