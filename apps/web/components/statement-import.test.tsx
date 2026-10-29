import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Executa os eventos reais do componente com pedidos diferidos, sem depender de um motor de layout.
const harness = vi.hoisted(() => ({ hooks: [] as any[], cursor: 0, send: vi.fn(), read: vi.fn(), refresh: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState(initial: unknown) { const i = harness.cursor++; if (!(i in harness.hooks)) harness.hooks[i] = initial; return [harness.hooks[i], (next: unknown) => { harness.hooks[i] = typeof next === 'function' ? next(harness.hooks[i]) : next; }]; },
  useRef(initial: unknown) { const i = harness.cursor++; return harness.hooks[i] ??= { current: initial }; },
  useEffect() {},
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: harness.refresh }) }));
vi.mock('@/lib/client', () => ({ send: harness.send, useMutation: vi.fn() }));
vi.mock('@/lib/document-import', () => ({ readStatementDocument: harness.read }));
import { StatementImport } from '../app/(app)/conciliacao/actions';

type Node = ReactElement<any>;
const all = (value: unknown): Node[] => {
  if (Array.isArray(value)) return value.flatMap(all);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node; return [node, ...all(node.props.children)];
};
const text = (value: any): string => Array.isArray(value) ? value.map(text).join('') : value?.props ? text(value.props.children) : typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const render = () => { harness.cursor = 0; return StatementImport({ accountId: 'conta-sintetica' }); };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const fileInput = () => all(render()).find(n => n.type === 'input' && n.props.type === 'file')!;
const button = (name: string) => all(render()).find(n => n.type === 'button' && text(n) === name)!;
const preview = { headers: ['Data', 'Descritivo', 'Valor'], headerRow: 0, mapping: { date: 0, description: 1, amount: 2 }, count: 1, newCount: 1, duplicates: 0, from: '2026-10-01', to: '2026-10-01', inflowMinor: 0, outflowMinor: 10025, balance: null, problems: [], problemCount: 0, sample: [] };
beforeEach(() => { harness.hooks = []; harness.cursor = 0; harness.send.mockReset(); harness.read.mockReset(); harness.refresh.mockReset(); });

describe('conciliação: cancelar e substituir documentos em leitura', () => {
  it('uma pré-visualização tardia não reaparece depois de remover o documento', async () => {
    let finish!: (value: unknown) => void;
    harness.read.mockResolvedValue('Data;Descritivo;Valor\n01/10/2026;Salário;-100,25');
    harness.send.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    fileInput().props.onChange({ target: { files: [{ name: 'extracto.pdf' }] } }); await flush();
    expect(text(render())).toContain('extracto.pdf');
    button('Cancelar leitura').props.onClick(); finish({ ok: true, data: preview }); await flush();
    expect(text(render())).not.toContain('extracto.pdf'); expect(button('Importar 1 movimento(s)')).toBeUndefined();
    expect(harness.send.mock.calls.every(call => call[0].endsWith('/preview'))).toBe(true);
  });
  it('a segunda selecção vence uma primeira leitura que termina mais tarde', async () => {
    let finishFirst!: (value: string) => void, firstSignal!: AbortSignal;
    harness.read.mockImplementationOnce((_file, options) => { firstSignal = options.signal; return new Promise(resolve => { finishFirst = resolve; }); }).mockResolvedValueOnce('segundo documento');
    harness.send.mockResolvedValue({ ok: true, data: preview });
    fileInput().props.onChange({ target: { files: [{ name: 'primeiro.docx' }] } });
    fileInput().props.onChange({ target: { files: [{ name: 'segundo.docx' }] } }); await flush();
    expect(firstSignal.aborted).toBe(true);
    finishFirst('primeiro documento'); await flush();
    expect(text(render())).toContain('segundo.docx'); expect(text(render())).not.toContain('primeiro.docx');
    expect(harness.send).toHaveBeenCalledTimes(1); expect(harness.send.mock.calls[0]![2].text).toBe('segundo documento');
    button('Remover documento').props.onClick(); expect(button('Importar 1 movimento(s)')).toBeUndefined();
  });
  it('uma leitura falhada continua a permitir remover e escolher outro ficheiro', async () => {
    harness.read.mockRejectedValueOnce(new Error('Documento danificado'));
    fileInput().props.onChange({ target: { files: [{ name: 'errado.docx' }] } }); await flush();
    expect(text(render())).toContain('Documento danificado'); button('Remover documento').props.onClick();
    expect(text(render())).not.toContain('Documento danificado'); expect(harness.send).not.toHaveBeenCalled();
    harness.read.mockResolvedValue('documento válido'); harness.send.mockResolvedValue({ ok: true, data: preview });
    fileInput().props.onChange({ target: { files: [{ name: 'certo.docx' }] } }); await flush();
    expect(button('Importar 1 movimento(s)')?.props.disabled).toBe(false);
  });
});
