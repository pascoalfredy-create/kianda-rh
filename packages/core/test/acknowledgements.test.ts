import { describe, expect, it } from 'vitest';
import { ackAudienceIncludes, ackAudienceIssue, ackContentHash, ackState, DEFAULT_CHECKLIST_TEMPLATES } from '../src/index.js';

describe('aceitação de documentos: destinatários, impressão digital e estado', () => {
  it('destinatários: todos, o departamento ou o próprio', () => {
    const emp = { id: 'e1', departmentId: 'd1' };
    expect(ackAudienceIncludes({ all: true, departmentIds: [], employeeIds: [] }, emp)).toBe(true);
    expect(ackAudienceIncludes({ all: false, departmentIds: ['d1'], employeeIds: [] }, emp)).toBe(true);
    expect(ackAudienceIncludes({ all: false, departmentIds: ['d2'], employeeIds: ['e1'] }, emp)).toBe(true);
    expect(ackAudienceIncludes({ all: false, departmentIds: ['d2'], employeeIds: [] }, { id: 'e1', departmentId: null })).toBe(false);
    expect(ackAudienceIssue({ all: false, departmentIds: [], employeeIds: [] })).toMatch(/destinatários/);
  });
  it('a impressão digital muda com o texto, a versão ou um anexo, e não com a ordem dos anexos', async () => {
    const base = { title: 'Regulamento interno', version: 1, body: 'Art. 1.º Horário…', fileHashes: ['a', 'b'] };
    const h = await ackContentHash(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await ackContentHash({ ...base, fileHashes: ['b', 'a'] })).toBe(h);
    expect(await ackContentHash({ ...base, body: 'Art. 1.º Horário.' })).not.toBe(h);
    expect(await ackContentHash({ ...base, version: 2 })).not.toBe(h);
    expect(await ackContentHash({ ...base, fileHashes: ['a'] })).not.toBe(h);
    expect(await ackContentHash({ ...base, body: 'Art. 1.º Horário…'.replace('\n', '\r\n') })).toBe(h);
  });
  it('estado do pedido face ao prazo', () => {
    expect(ackState({ status: 'pending', dueDate: '2026-11-01' }, '2026-11-02')).toBe('overdue');
    expect(ackState({ status: 'pending', dueDate: null }, '2026-11-02')).toBe('pending');
    expect(ackState({ status: 'accepted', dueDate: '2026-11-01' }, '2026-11-02')).toBe('accepted');
  });
  it('o acolhimento-tipo liga a tarefa do regulamento à aceitação no portal', () => {
    expect(DEFAULT_CHECKLIST_TEMPLATES.onboarding.items.find(i => i.link === 'regulamento')).toMatchObject({ responsible: 'employee' });
  });
});
