/** PDF.js e worker locais, versionados em conjunto; sem CDN nem envio de documentos a terceiros. */
import { createRequire } from 'node:module';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const web = new URL('../apps/web/', import.meta.url), require = createRequire(new URL('package.json', web));
const source = dirname(require.resolve('pdfjs-dist/package.json'));
const { version } = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
const importer = await readFile(new URL('modeling/pdf-import.ts', web), 'utf8');
if (!importer.includes(`PDF_IMPORT_VERSION = '${version}'`)) throw new Error('O leitor e o worker PDF devem usar a mesma versão de pdfjs-dist.');
const destination = fileURLToPath(new URL(`public/modeling-pdf/${version}/`, web));
await mkdir(destination, { recursive: true });
// Legacy inclui os polyfills necessários ao Node 22 dos testes e a navegadores ainda suportados.
for (const filename of ['pdf.min.mjs', 'pdf.worker.min.mjs']) await copyFile(join(source, 'legacy', 'build', filename), join(destination, filename));
await copyFile(join(source, 'LICENSE'), join(destination, 'LICENSE'));
console.log(`Integra: leitor PDF local ${version} preparado.`);
