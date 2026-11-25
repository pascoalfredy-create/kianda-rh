/** Lista de pontos do cadastro: tipos e rótulos partilhados pelo cliente e pela consola. */
export type RegistrationCheck = {
  key: 'nif' | 'companyName' | 'ownerName' | 'ownerEmail' | 'review';
  label: string;
  value: string | null;
  status: 'ok' | 'invalid' | 'pending';
  blocking: boolean;
  message: string | null;
};

export type RegistrationData = {
  inReview: boolean;
  items: RegistrationCheck[];
  blocking: number;
  canEdit: boolean;
  supportEmail: string | null;
  supportPhone: string | null;
};

export const STATUS: Record<RegistrationCheck['status'], [string, string]> = {
  ok: ['approved', 'Cumpre os requisitos'],
  invalid: ['pending', 'Não cumpre'],
  pending: ['pending', 'Por confirmar'],
};

export function statusLabel(item: RegistrationCheck) {
  if (item.key === 'ownerEmail' && item.status === 'pending') return 'A confirmar';
  return STATUS[item.status][1];
}
