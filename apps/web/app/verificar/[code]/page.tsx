import { upstream } from '@/lib/upstream';

export const dynamic = 'force-dynamic';

interface Result { valid: boolean; revoked?: boolean; number?: string; title?: string; company?: string; companyNif?: string; employee?: string; issuedAt?: string; message?: string }

/** Verificação pública de documentos emitidos pelo Kianda (sem sessão). */
export default async function Verificar({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const res = await upstream(`/v1/public/documents/${encodeURIComponent(code)}`, { method: 'GET' });
  const r = (await res.json().catch(() => ({ valid: false }))) as Result;
  return (
    <main style={{ maxWidth: 560, margin: '60px auto', padding: 20 }}>
      <div className="card" style={{ padding: 28 }}>
        <div className="muted" style={{ marginBottom: 6 }}>Kianda RH · verificação de documento</div>
        {r.number ? (
          <>
            <h1 style={{ marginBottom: 14 }}>{r.revoked ? <span style={{ color: 'var(--red)' }}>Documento anulado</span> : <span style={{ color: 'var(--brand)' }}>Documento válido</span>}</h1>
            <dl className="dl">
              <div><dt>Documento</dt><dd>{r.title}</dd></div>
              <div><dt>Número</dt><dd>{r.number}</dd></div>
              <div><dt>Emitido por</dt><dd>{r.company} (NIF {r.companyNif})</dd></div>
              <div><dt>Em nome de</dt><dd>{r.employee}</dd></div>
              <div><dt>Data de emissão</dt><dd>{new Date(r.issuedAt!).toLocaleDateString('pt-PT', { timeZone: 'Africa/Luanda' })}</dd></div>
            </dl>
            <p className="muted" style={{ marginTop: 16 }}>Confirme que os dados coincidem com o documento apresentado. O conteúdo não é mostrado aqui por razões de privacidade.</p>
          </>
        ) : (
          <>
            <h1 style={{ color: 'var(--red)' }}>Código não encontrado</h1>
            <p>O código <code>{code}</code> não corresponde a nenhum documento emitido. Confirme o código impresso no rodapé do documento.</p>
          </>
        )}
      </div>
    </main>
  );
}
