import { formatKz } from '@kianda/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api } from '@/lib/api';
import { DocumentPrintButton } from '@/components/document-export';
import { type Offer, OFFER_STATUS } from '../../../../offer-types';

export const dynamic = 'force-dynamic';
export default async function OfferPreview({ params }: { params: Promise<{ id: string; offerId: string }> }) {
  const { id, offerId } = await params;
  const candidate = await api<{ name: string; opening: { title: string }; offers: Offer[] }>(`/v1/candidates/${id}`);
  const offer = candidate.offers.find(o => o.id === offerId); if (!offer) notFound();
  return <>
    <div className="page-head no-print"><Link className="btn ghost" href={`/recrutamento/candidatos/${id}`}>← Voltar à candidatura</Link><DocumentPrintButton className="btn">Imprimir / PDF</DocumentPrintButton></div>
    <article className="card" style={{ padding: 30, maxWidth: 850, margin: '16px auto' }}>
      <p className="muted">Proposta de recrutamento · versão {offer.version} · {OFFER_STATUS[offer.status]}</p>
      <h1>{offer.kind === 'accept_expected' ? 'Proposta de acordo com a pretensão salarial' : 'Contraproposta salarial'}</h1>
      <p>Exmo.(a) {candidate.name},</p><p>Apresentamos a seguinte proposta para a função de <b>{candidate.opening.title}</b>:</p>
      <dl className="dl"><div><dt>Salário base bruto mensal</dt><dd>{formatKz(offer.baseMinor)}</dd></div><div><dt>Alimentação mensal</dt><dd>{formatKz(offer.mealMinor)}</dd></div><div><dt>Transporte mensal</dt><dd>{formatKz(offer.transportMinor)}</dd></div><div><dt>Início previsto</dt><dd>{offer.startDate ?? 'A acordar'}</dd></div><div><dt>Válida até</dt><dd>{offer.validUntil}</dd></div></dl>
      {offer.terms && <p style={{ whiteSpace: 'pre-wrap' }}>{offer.terms}</p>}
      <p>Solicitamos a comunicação da sua resposta à equipa de recrutamento. A admissão e o contrato são formalizados separadamente.</p>
    </article>
  </>;
}
