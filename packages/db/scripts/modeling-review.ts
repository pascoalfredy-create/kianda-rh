import 'dotenv/config';
import { closeDb, getDb, provisionModelingReview } from '../src/index.js';
try {
  const result = await provisionModelingReview(getDb(), process.env.KIANDA_PLATFORM_ADMINS ?? '');
  console.log(result.status === 'created' ? 'Modelagem: acompanhamento activado para a conta de administração configurada (20 projectos, 5 utilizadores, sem facturação).' : result.status === 'preserved' ? 'Modelagem: licença existente da administração preservada.' : `Modelagem: acompanhamento não provisionado (${result.reason}); nenhuma licença alterada.`);
} finally { await closeDb(); }
