export const CLAIM_STATUS: Record<string, [string, string]> = {
  draft: ['Rascunho', 'tag'], submitted: ['À espera de aprovação', 'st pending'], approved: ['Aprovada — por reembolsar', 'st approved'],
  rejected: ['Recusada', 'st rejected'], paid: ['Reembolsada', 'tag future'], cancelled: ['Anulada', 'tag'],
};
