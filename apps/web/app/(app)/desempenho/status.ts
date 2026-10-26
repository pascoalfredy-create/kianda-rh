export const REVIEW_STATUS: Record<string, [string, string]> = {
  self: ['Auto-avaliação', 'st pending'], manager: ['Avaliação da chefia', 'st pending'], acknowledgement: ['A aguardar conhecimento', 'tag future'], done: ['Concluída', 'st approved'],
};
export const CYCLE_STATUS: Record<string, [string, string]> = { draft: ['Em preparação', 'tag'], open: ['Aberto', 'st approved'], closed: ['Fechado', 'tag'] };
