'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { compatibleDraft, WorkspaceMemory } from '@/lib/workspace-memory';

const Workspace = createContext<WorkspaceMemory | null>(null);
const serverSnapshot = () => undefined;

export function WorkspaceState({ scope, children }: { scope: string; children: ReactNode }) {
  const [memory] = useState(() => new WorkspaceMemory(scope));
  return <Workspace.Provider value={memory}><ScrollMemory memory={memory} />{children}</Workspace.Provider>;
}

/** Os valores são restaurados depois da hidratação; nunca se enviam alterações à API. */
export function useWorkspaceState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const memory = useContext(Workspace);
  const serialized = JSON.stringify(initial);
  const defaults = useRef({ key, serialized, value: initial });
  // Sem rascunho, uma actualização do servidor também actualiza os valores iniciais.
  if (defaults.current.key !== key || defaults.current.serialized !== serialized) defaults.current = { key, serialized, value: initial };
  const [local, setLocal] = useState(initial);
  const read = useCallback(() => memory?.get(key), [memory, key]);
  const stored = useSyncExternalStore(memory?.subscribe ?? (() => () => {}), read, serverSnapshot);
  const value = memory ? compatibleDraft(stored, defaults.current.value) ? stored as T : defaults.current.value : local;
  const set = useCallback<Dispatch<SetStateAction<T>>>(next => {
    if (!memory) { setLocal(next); return; }
    const before = memory.get(key), current = compatibleDraft(before, defaults.current.value) ? before as T : defaults.current.value;
    memory.set(key, typeof next === 'function' ? (next as (value: T) => T)(current) : next);
  }, [key, memory]);
  return [value, set];
}

export function useClearWorkspace(prefix: string) {
  const memory = useContext(Workspace);
  return useCallback(() => memory?.clear(prefix), [memory, prefix]);
}

/** Restabelece a posição quando o conteúdo e os rascunhos voltam a estar montados. */
function ScrollMemory({ memory }: { memory: WorkspaceMemory }) {
  const path = usePathname(), search = useSearchParams();
  const router = useRouter(), visited = useRef(new Set<string>()), previousPath = useRef(path);
  useEffect(() => {
    // O retorno recupera a interface; os registos têm de vir da API actual.
    if (previousPath.current !== path && visited.current.has(path)) router.refresh();
    visited.current.add(path); previousPath.current = path;
  }, [path, router]);
  const params = new URLSearchParams(search.toString()); params.delete('voltar');
  const key = `scroll:${path}?${params}`;
  useEffect(() => {
    const previous = memory.get(key);
    const target = typeof previous === 'number' && previous >= 0 ? previous : 0;
    let position = target, restoring = target > 0, frame = 0;
    const started = performance.now();
    const restore = () => {
      if (!restoring) return;
      window.scrollTo(0, target);
      if (Math.abs(window.scrollY - target) < 2 || performance.now() - started > 1200) { restoring = false; position = window.scrollY; }
      else frame = requestAnimationFrame(restore);
    };
    if (restoring) frame = requestAnimationFrame(restore);
    const scroll = () => { if (!restoring) position = window.scrollY; };
    const save = () => memory.set(key, position);
    const interact = () => { restoring = false; cancelAnimationFrame(frame); };
    window.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('pagehide', save);
    document.addEventListener('click', save, true);
    window.addEventListener('wheel', interact, { passive: true });
    window.addEventListener('touchstart', interact, { passive: true });
    return () => {
      cancelAnimationFrame(frame); save();
      window.removeEventListener('scroll', scroll); window.removeEventListener('pagehide', save);
      document.removeEventListener('click', save, true); window.removeEventListener('wheel', interact); window.removeEventListener('touchstart', interact);
    };
  }, [key, memory]);
  return null;
}
