/**
 * Armazenamento de ficheiros.
 * - Com o R2 ligado ao Worker (binding FILES), o conteúdo vai para o R2 e a base de dados guarda só os metadados.
 * - Sem R2 (desenvolvimento, testes, conta sem R2 activo), o conteúdo fica na tabela file_blobs (com RLS).
 * Cada ficheiro guarda onde ficou (files.storage), por isso os dois modos convivem.
 */
import { and, eq, fileBlobs, files, sql, type Db } from '@kianda/db';
import { DomainError } from './payroll.js';
import { WORD_MIME, wordArchive } from '@kianda/core';

export interface ObjectStore {
  put(key: string, data: Uint8Array, mime: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(keys: string[]): Promise<void>;
}

/** Forma mínima do binding R2 dos Workers (evita depender dos tipos do Cloudflare). */
export interface R2BucketLike {
  put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(keys: string | string[]): Promise<void>;
}

export function r2Store(bucket: R2BucketLike): ObjectStore {
  return {
    async put(key, data, mime) { await bucket.put(key, data, { httpMetadata: { contentType: mime } }); },
    async get(key) { const o = await bucket.get(key); return o ? new Uint8Array(await o.arrayBuffer()) : null; },
    async delete(keys) { for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000)); },
  };
}

let objectStore: ObjectStore | null = null;
/** Definido pelo Worker em cada pedido (R2 presente ou não); nos testes pode ser trocado por um falso. */
export function setObjectStore(s: ObjectStore | null) { objectStore = s; }
export const storageMode = () => (objectStore ? 'r2' : 'db');

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES_PER_ITEM = 10;
/** Quota por empresa quando o conteúdo fica na base de dados (sem R2). */
export const DB_QUOTA_BYTES = 250 * 1024 * 1024;

const KINDS: { mime: string; ext: string; test: (b: Uint8Array) => boolean }[] = [
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  { mime: 'image/png', ext: 'png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/webp', ext: 'webp',
    test: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

/** O tipo vem do conteúdo (assinatura do ficheiro), nunca do nome ou do cabeçalho enviado. */
export function detectKind(data: Uint8Array) {
  if (data[0] === 0x50 && data[1] === 0x4b) {
    try { wordArchive(data); return { mime: WORD_MIME, ext: 'docx' }; }
    catch { throw new DomainError('tipo_nao_suportado', 'Seleccione um Word DOCX válido, sem macros.', 415); }
  }
  const k = KINDS.find((x) => x.test(data));
  if (!k) throw new DomainError('tipo_nao_suportado', 'Só são aceites PDF, Word (DOCX), JPG, PNG ou WEBP', 415);
  return k;
}

/** Nome seguro para mostrar e descarregar: sem pastas nem caracteres de controlo, extensão de acordo com o conteúdo. */
export function safeName(raw: string | undefined, ext: string) {
  const base = (raw ?? '').split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, '').replace(/\s+/g, ' ').trim();
  const stem = base.replace(/\.[A-Za-z0-9]{1,5}$/, '').slice(0, 100) || 'ficheiro';
  return `${stem}.${ext}`;
}

async function sha256(data: Uint8Array) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const keyOf = (companyId: string, fileId: string) => `${companyId}/${fileId}`;

export interface StoreInput {
  companyId: string; entity: string; entityId: string; employeeId: string | null; name?: string; uploadedBy: string; data: Uint8Array;
}

export async function storeFile(db: Db, v: StoreInput) {
  if (!v.data.length) throw new DomainError('ficheiro_vazio', 'O ficheiro está vazio', 400);
  if (v.data.length > MAX_FILE_BYTES) throw new DomainError('ficheiro_grande', 'O ficheiro passa o limite de 5 MB — reduza a resolução ou divida o PDF', 413);
  const kind = detectKind(v.data);
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(files).where(and(eq(files.companyId, v.companyId), eq(files.entity, v.entity), eq(files.entityId, v.entityId)));
  if ((n?.n ?? 0) >= MAX_FILES_PER_ITEM) throw new DomainError('limite_ficheiros', `Máximo de ${MAX_FILES_PER_ITEM} ficheiros por registo`, 409);
  const mode = storageMode();
  if (mode === 'db') {
    const [u] = await db.select({ total: sql<number>`coalesce(sum(${files.sizeBytes}), 0)::bigint` }).from(files).where(and(eq(files.companyId, v.companyId), eq(files.storage, 'db')));
    if (Number(u?.total ?? 0) + v.data.length > DB_QUOTA_BYTES) throw new DomainError('quota_ficheiros', 'Espaço de ficheiros da empresa esgotado (250 MB). Contacte o suporte.', 409);
  }
  const [f] = await db.insert(files).values({
    companyId: v.companyId, entity: v.entity, entityId: v.entityId, employeeId: v.employeeId, name: safeName(v.name, kind.ext),
    mime: kind.mime, sizeBytes: v.data.length, sha256: await sha256(v.data), storage: mode, uploadedBy: v.uploadedBy,
  }).returning();
  if (mode === 'db') await db.insert(fileBlobs).values({ fileId: f!.id, companyId: v.companyId, data: v.data });
  else await objectStore!.put(keyOf(v.companyId, f!.id), v.data, kind.mime);
  return f!;
}

export async function readFileData(db: Db, f: typeof files.$inferSelect): Promise<Uint8Array> {
  if (f.storage === 'db') {
    const [b] = await db.select({ data: fileBlobs.data }).from(fileBlobs).where(eq(fileBlobs.fileId, f.id));
    if (b) return b.data instanceof Uint8Array ? b.data : new Uint8Array(b.data as ArrayBuffer);
  } else if (objectStore) {
    const d = await objectStore.get(keyOf(f.companyId, f.id));
    if (d) return d;
  }
  throw new DomainError('ficheiro_indisponivel', 'O conteúdo deste ficheiro não está disponível', 404);
}

/** Apaga registos e conteúdos (R2 incluído). Para chamar com os ficheiros já seleccionados. */
export async function removeFiles(db: Db, list: (typeof files.$inferSelect)[]) {
  if (!list.length) return 0;
  for (const f of list) await db.delete(files).where(eq(files.id, f.id));
  const r2 = list.filter((f) => f.storage === 'r2').map((f) => keyOf(f.companyId, f.id));
  if (r2.length && objectStore) await objectStore.delete(r2);
  return list.length;
}

/** Chaves R2 de uma empresa (para apagar depois de eliminar a empresa). */
export async function r2KeysOf(db: Db, companyId: string) {
  const rows = await db.select({ id: files.id }).from(files).where(and(eq(files.companyId, companyId), eq(files.storage, 'r2')));
  return rows.map((r) => keyOf(companyId, r.id));
}
export async function deleteObjects(keys: string[]) { if (keys.length && objectStore) await objectStore.delete(keys); }
