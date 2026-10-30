import { RegistoForm } from './form';
import { registrationSelection, type RegistrationQuery } from '../../lib/registration-selection';

export default async function Registo({ searchParams }: { searchParams: Promise<RegistrationQuery> }) {
  return <RegistoForm initial={registrationSelection(await searchParams)} />;
}
