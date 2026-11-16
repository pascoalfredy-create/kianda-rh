/** API de ensaio. Só escuta em loopback e usa a cópia privada dos objectos. */
import { serve } from '@hono/node-server';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildApp } from '../src/app.js';
import { setObjectStore } from '../src/services/storage.js';

const root = process.env.RECOVERY_OBJECTS;
if (
  !root ||
  !process.env.API_JWT_SECRET ||
  process.env.DATABASE_URL !== 'postgresql://postgres:restore@127.0.0.1:15432/kianda'
) {
  throw new Error('O servidor de recuperação exige a base e os objectos isolados.');
}
const pathFor = (key: string) => {
  if (!/^[\w-]+\/[\w-]+$/.test(key)) throw new Error('Chave de recuperação inválida.');
  return join(root, key);
};
setObjectStore({
  async get(key) {
    try {
      return await readFile(pathFor(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  },
  async put(key, bytes) {
    const path = pathFor(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, bytes, { mode: 0o600 });
  },
  async delete(keys) {
    for (const key of keys) await rm(pathFor(key), { force: true });
  },
});
serve({ fetch: buildApp().fetch, port: 4000, hostname: '127.0.0.1' });
