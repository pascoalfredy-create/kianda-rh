// Registo inicial do domínio de envio dedicado. Uma política própria ou herdada fica a cargo do operador.
const zoneName = 'yelaperformance.com';
const senderDomain = `notificacoes.${zoneName}`;
const from = (process.env.MAIL_FROM ?? '').trim();
const address = from.match(/<([^<>]+)>$/)?.[1].trim() ?? from;
const configuredDomain = address.match(/^[^\s@<>]+@([a-z0-9.-]+)$/i)?.[1].toLowerCase();
const token = process.env.CLOUDFLARE_API_TOKEN;

async function cloudflare(method, path, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success !== true) {
    const codes = (data.errors ?? []).map(error => error.code).filter(Number.isInteger);
    throw new Error(`Pedido Cloudflare recusado (HTTP ${response.status}${codes.length ? `, código ${codes.join(', ')}` : ''}).`);
  }
  return data;
}

async function configureDmarc() {
  if (configuredDomain !== senderDomain) {
    console.log('DMARC: o remetente configurado usa outro domínio.');
    return;
  }
  if (!token) throw new Error('O token Cloudflare está em falta.');
  const { result: zones } = await cloudflare('GET', `/zones?${new URLSearchParams({ name: zoneName, status: 'active' })}`);
  if (!Array.isArray(zones) || zones.length !== 1 || zones[0].name !== zoneName) {
    throw new Error(`Zona activa ${zoneName} indisponível.`);
  }
  const records = `/zones/${zones[0].id}/dns_records`;
  const recordName = `_dmarc.${senderDomain}`;
  const dmarcNames = new Set([recordName, `_dmarc.${zoneName}`]);
  const pageSize = 100;
  for (let page = 1; ; page++) {
    const { result, result_info: info } = await cloudflare('GET', `${records}?page=${page}&per_page=${pageSize}`);
    if (!Array.isArray(result) || (info?.page != null && info.page !== page)) {
      throw new Error('A Cloudflare devolveu uma página DNS inválida.');
    }
    if (result.some(record => dmarcNames.has(record.name?.toLowerCase()))) {
      console.log('DMARC: já existe um registo próprio ou na zona principal. Mantida a configuração existente.');
      return;
    }
    const perPage = info?.per_page || pageSize;
    const totalPages = info?.total_pages ?? (info?.total_count == null ? null : Math.ceil(info.total_count / perPage));
    if (totalPages == null ? result.length < perPage : page >= totalPages) break;
    if (result.length === 0) throw new Error('A listagem DNS terminou antes da última página.');
  }
  await cloudflare('POST', records, { type: 'TXT', name: recordName, content: 'v=DMARC1; p=none', ttl: 300 });
  console.log(`DMARC: criado TXT ${recordName} com política p=none.`);
}

try {
  await configureDmarc();
} catch (error) {
  console.error(`DMARC: ${error.message}`);
  process.exitCode = 1;
}
