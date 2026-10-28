import type { App } from '../src/app.js';

export interface InjectResponse {
  statusCode: number;
  body: string;
  bytes: Uint8Array;
  json(): any;
  cookies: { name: string; value: string }[];
  headers: Record<string, string>;
}

/** Adaptador de testes: mesma forma que o inject do Fastify, sobre app.request do Hono (sem rede). */
export function testClient(app: App) {
  return {
    async inject(o: { method: string; url: string; headers?: Record<string, string>; payload?: unknown }): Promise<InjectResponse> {
      const headers: Record<string, string> = { ...(o.headers ?? {}) };
      let body: string | Uint8Array | undefined;
      if (o.payload instanceof Uint8Array) {
        // Ficheiros: corpo em bruto.
        body = o.payload;
        headers['content-type'] ??= 'application/octet-stream';
      } else if (o.payload !== undefined) {
        // Texto passa tal como está (ex.: corpo assinado de um webhook); objectos vão em JSON.
        body = typeof o.payload === 'string' ? o.payload : JSON.stringify(o.payload);
        headers['content-type'] ??= 'application/json';
      }
      const res = await app.request(o.url, { method: o.method, headers, body });
      const bytes = new Uint8Array(await res.arrayBuffer());
      const text = new TextDecoder().decode(bytes);
      const cookies = res.headers.getSetCookie().map((c) => {
        const [pair] = c.split(';');
        const i = pair!.indexOf('=');
        return { name: pair!.slice(0, i), value: pair!.slice(i + 1) };
      });
      return { statusCode: res.status, body: text, bytes, json: () => JSON.parse(text), cookies, headers: Object.fromEntries(res.headers) };
    },
    async close() {},
  };
}
