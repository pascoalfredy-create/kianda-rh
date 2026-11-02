/** Bibliotecas de exportação do Valora (PDF e Word), locais e versionadas; sem CDN nem envio a terceiros. */
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const web = new URL('../apps/web/', import.meta.url), require = createRequire(new URL('package.json', web));
const { transform } = require('esbuild');
const destination = fileURLToPath(new URL('public/valuation-lib/', web));
await mkdir(destination, { recursive: true });
const libs = [
  { name: 'jspdf', file: 'dist/jspdf.umd.min.js' },
  { name: 'jspdf-autotable', file: 'dist/jspdf.plugin.autotable.min.js' },
  { name: 'docx', file: 'dist/index.iife.js', minify: true },
];
const manifest = {};
for (const lib of libs) {
  const root = fileURLToPath(new URL(`node_modules/${lib.name}/`, web));
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const target = `${lib.name}-${version}.min.js`;
  const source = await readFile(join(root, lib.file), 'utf8');
  await writeFile(join(destination, target), lib.minify ? (await transform(source, { minify: true, legalComments: 'eof', target: 'es2020' })).code : source);
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  let licence = `${lib.name} ${version} — licença ${pkg.license} (ver o cabeçalho do ficheiro).`;
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) { try { licence = await readFile(join(root, name), 'utf8'); break; } catch { /* seguinte */ } }
  await writeFile(join(destination, `${lib.name}-LICENSE.txt`), licence);
  manifest[lib.name] = `/valuation-lib/${target}`;
}
await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log('Valora: bibliotecas de exportação locais preparadas.');
