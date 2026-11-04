import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, sql } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { testClient, type InjectResponse } from './inject.js';

/** Aceitação electrónica: publicação, destinatários, prova da aceitação, versões, acolhimento e isolamento. */
const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });
const password = 'AceitacaoDocs2026x';
const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const cookieOf = (r: InjectResponse) => `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;
// PDF mínimo (a detecção do tipo é feita pelo conteúdo).
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

describe.skipIf(!process.env.DATABASE_URL)('aceitação electrónica de documentos', () => {
  let owner = '', other = '', ana = '', bento = '', anaId = '', bentoId = '', deptId = '', docId = '', anaRequest = '';
  const req = (session: string, method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) => app.inject({ method, url, headers: { cookie: session, ...headers }, ...(payload === undefined ? {} : { payload }) });
  const employee = (number: string, name: string, departmentId?: string) => ({ number, name, gender: 'F', jobTitle: 'Técnica', province: 'Luanda', nif: `00000${number.padStart(5, '0')}`, ...(departmentId ? { departmentId } : {}), contract: { type: 'indefinite', startDate: '2026-10-01', base: 300000, meal: 30000, transport: 25000 } });
  const user = async (name: string, employeeId: string) => {
    const email = `${stamp}.${name}@aceita.test`;
    expect((await req(owner, 'POST', '/v1/users', { name, email, password, role: 'employee', employeeId })).statusCode).toBe(201);
    return cookieOf(await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } }));
  };

  beforeAll(async () => {
    for (const i of [0, 1]) {
      const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { acceptTerms: true, company: { name: `Aceita ${i}`, sector: 'services', nif: String(Number(stamp.slice(-9)) * 10 + i).padStart(10, '0').slice(-10) }, name: 'Dona', email: `${stamp}.${i}@aceita.test`, password, modules: ['hr'] } });
      expect(r.statusCode).toBe(201);
      if (!i) owner = cookieOf(r); else other = cookieOf(r);
    }
    const d = await req(owner, 'POST', '/v1/departments', { name: 'Operações', costCenter: 'OPS' }); expect(d.statusCode).toBe(201); deptId = d.json().id;
    anaId = (await req(owner, 'POST', '/v1/employees', employee('31', 'Ana Muhongo', deptId))).json().id;
    bentoId = (await req(owner, 'POST', '/v1/employees', employee('32', 'Bento Kiala'))).json().id;
    ana = await user('ana', anaId); bento = await user('bento', bentoId);
  });

  it('só o RH prepara; o rascunho valida destinatários e não é visto pelos colaboradores', async () => {
    expect((await req(ana, 'POST', '/v1/ack-documents', { title: 'X', category: 'aviso', audience: { all: true } })).statusCode).toBe(403);
    expect((await req(owner, 'POST', '/v1/ack-documents', { title: 'Regulamento', category: 'regulamento', audience: { all: false } })).json().error).toBe('destinatarios');
    const d = await req(owner, 'POST', '/v1/ack-documents', { title: 'Regulamento interno', body: 'Art. 1.º O horário é das 8h às 17h.', category: 'regulamento', audience: { all: false, departmentIds: [deptId] }, dueDate: '2026-11-30' });
    expect(d.statusCode).toBe(201); docId = d.json().id;
    const up = await app.inject({ method: 'POST', url: `/v1/files?entity=ack_document&entityId=${docId}&name=regulamento.pdf`, headers: { cookie: owner, 'content-type': 'application/octet-stream' }, payload: PDF });
    expect(up.statusCode).toBe(201);
    expect((await req(ana, 'GET', '/v1/acknowledgements')).json()).toEqual([]);
    expect((await req(ana, 'GET', `/v1/files?entity=ack_document&entityId=${docId}`)).json().files ?? []).toEqual([]);
  });

  it('publicar congela o conteúdo e pede a aceitação aos destinatários (o departamento)', async () => {
    const p = await req(owner, 'POST', `/v1/ack-documents/${docId}/publish`);
    expect(p.statusCode).toBe(200); expect(p.json()).toMatchObject({ status: 'published', recipients: 1 });
    expect(p.json().contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await req(owner, 'PATCH', `/v1/ack-documents/${docId}`, { title: 'Outro', category: 'regulamento', audience: { all: true } })).json().error).toBe('documento_publicado');
    await expect(getDb().execute(sql`update ack_documents set body = 'alterado' where id = ${docId}`)).rejects.toThrow();
    const upload = await app.inject({ method: 'POST', url: `/v1/files?entity=ack_document&entityId=${docId}&name=x.pdf`, headers: { cookie: owner, 'content-type': 'application/octet-stream' }, payload: PDF });
    expect(upload.statusCode).toBe(403);
    expect((await req(bento, 'GET', '/v1/acknowledgements')).json()).toEqual([]);
    const mine = (await req(ana, 'GET', '/v1/acknowledgements')).json();
    expect(mine).toHaveLength(1); expect(mine[0]).toMatchObject({ status: 'pending', document: { title: 'Regulamento interno', version: 1 } });
    anaRequest = mine[0].id;
    expect((await req(ana, 'GET', '/v1/notifications/counts')).json().acks).toBe(1);
    expect((await req(ana, 'GET', `/v1/files?entity=ack_document&entityId=${docId}`)).json().files).toHaveLength(1);
  });

  it('aceitar: só o próprio, sobre o conteúdo exacto; fica a prova e a tarefa de acolhimento fecha sozinha', async () => {
    const view = (await req(ana, 'GET', `/v1/acknowledgements/${anaRequest}`)).json();
    expect(view).toMatchObject({ canAccept: true, document: { body: 'Art. 1.º O horário é das 8h às 17h.' }, proof: null });
    expect(view.document.files).toHaveLength(1);
    expect((await req(bento, 'GET', `/v1/acknowledgements/${anaRequest}`)).statusCode).toBe(404);
    expect((await req(owner, 'POST', `/v1/acknowledgements/${anaRequest}/accept`, { confirm: true, contentSha256: view.document.contentSha256 })).statusCode).toBe(403);
    expect((await req(ana, 'POST', `/v1/acknowledgements/${anaRequest}/accept`, { confirm: true, contentSha256: 'a'.repeat(64) })).json().error).toBe('conteudo_alterado');
    expect((await req(ana, 'POST', `/v1/acknowledgements/${anaRequest}/accept`, { contentSha256: view.document.contentSha256 })).statusCode).toBe(400);
    const ok = await req(ana, 'POST', `/v1/acknowledgements/${anaRequest}/accept`, { confirm: true, contentSha256: view.document.contentSha256 }, { 'x-forwarded-for': '102.214.1.7', 'user-agent': 'Teste/1.0' });
    expect(ok.statusCode).toBe(200); expect(ok.json()).toMatchObject({ status: 'accepted', completedTasks: 1 });
    const proof = (await req(owner, 'GET', `/v1/acknowledgements/${anaRequest}`)).json().proof;
    expect(proof).toMatchObject({ acceptedByName: 'ana', ip: '102.214.1.7', userAgent: 'Teste/1.0', contentSha256: view.document.contentSha256 });
    // A lista de acolhimento da Ana tinha «Ler e aceitar o regulamento interno»: ficou feita com a referência.
    const list = (await req(owner, 'GET', `/v1/checklists?employeeId=${anaId}`)).json()[0];
    const task = (await req(owner, 'GET', `/v1/checklists/${list.id}`)).json().tasks.find((t: { linkKey: string | null }) => t.linkKey === 'regulamento');
    expect(task.doneAt).toBeTruthy(); expect(task.note).toMatch(/Aceite electronicamente no portal: Regulamento interno \(versão 1\)/);
    expect((await req(owner, 'GET', '/v1/ack-documents')).json()[0]).toMatchObject({ recipients: 1, accepted: 1, pending: 0 });
    expect((await req(ana, 'GET', '/v1/notifications/counts')).json().acks).toBe(0);
  });

  it('um novo colaborador do departamento recebe o documento em vigor; o RH acrescenta destinatários', async () => {
    const c = await req(owner, 'POST', '/v1/employees', employee('33', 'Celeste Mbala', deptId));
    const celeste = await user('celeste', c.json().id);
    expect((await req(celeste, 'GET', '/v1/acknowledgements')).json()).toHaveLength(1);
    expect((await req(owner, 'POST', `/v1/ack-documents/${docId}/recipients`, { employeeIds: [bentoId] })).json()).toEqual({ created: 1 });
    expect((await req(bento, 'GET', '/v1/acknowledgements')).json()).toHaveLength(1);
  });

  it('nova versão: rascunho com o mesmo texto; ao publicar, substitui a anterior e volta a pedir a aceitação', async () => {
    const n = await req(owner, 'POST', `/v1/ack-documents/${docId}/new-version`);
    expect(n.statusCode).toBe(201); expect(n.json()).toMatchObject({ version: 2, status: 'draft', previousId: docId });
    const v2 = n.json().id;
    expect((await req(owner, 'PATCH', `/v1/ack-documents/${v2}`, { title: 'Regulamento interno', body: 'Art. 1.º O horário é das 7h30 às 16h30.', category: 'regulamento', audience: { all: false, departmentIds: [deptId] } })).statusCode).toBe(200);
    expect((await req(owner, 'POST', `/v1/ack-documents/${v2}/publish`)).json()).toMatchObject({ status: 'published', version: 2 });
    const all = (await req(owner, 'GET', '/v1/ack-documents')).json();
    expect(all.find((d: { id: string }) => d.id === docId)).toMatchObject({ status: 'archived' });
    // A aceitação da v1 continua no registo; a v2 volta a pedir à Ana. O pedido pendente do Bento (v1) foi anulado.
    const anaList = (await req(ana, 'GET', '/v1/acknowledgements')).json();
    expect(anaList.map((x: { document: { version: number }; status: string }) => [x.document.version, x.status])).toEqual([[2, 'pending'], [1, 'accepted']]);
    expect((await req(bento, 'GET', '/v1/acknowledgements')).json()).toEqual([]);
  });

  it('outra empresa não vê nem aceita', async () => {
    expect((await req(other, 'GET', `/v1/ack-documents/${docId}`)).statusCode).toBe(404);
    expect((await req(other, 'GET', `/v1/acknowledgements/${anaRequest}`)).statusCode).toBe(404);
    expect((await req(other, 'GET', '/v1/ack-documents')).json()).toEqual([]);
  });
});
