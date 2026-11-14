// Emit only source locations and predefined classifications. The report may contain private data.
import { readFileSync } from 'node:fs';
let report;
try {
  report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
} catch {
  console.log('Diagnóstico: o Playwright não produziu um relatório JSON.');
  process.exit(0);
}
function classify(error) {
  const text = typeof error?.message === 'string' ? error.message : '';
  if (/webServer|ECONNREFUSED|EADDRINUSE/i.test(text)) return 'arranque ou ligação ao servidor';
  if (text.includes('Secção presente no texto do PDF')) return 'secção esperada ausente do PDF';
  if (/Timeout|timed out/i.test(text)) return 'tempo limite';
  return 'falha do teste';
}
function inspect(suites) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      if (spec.ok) continue;
      const location = typeof spec.file === 'string' ? spec.file.match(/(?:^|\/)(recovery|integra|valora)\.spec\.ts$/)?.[1] : undefined;
      if (!location || !Number.isSafeInteger(spec.line)) continue;
      const last = spec.tests?.[0]?.results?.at(-1);
      console.log(`Diagnóstico: ${location}.spec.ts:${spec.line} · ${classify(last?.error)}`);
    }
    inspect(suite.suites);
  }
}
for (const error of report.errors ?? []) console.log(`Diagnóstico geral: ${classify(error)}`);
inspect(report.suites);
