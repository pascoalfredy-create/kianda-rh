import type { App } from '../src/app.js';

export interface InjectResponse {
  statusCode: number;
  body: string;
  json(): any;
  cookies: { name: string; value: string }[];
}

/** Adaptador de testes: mesma forma que o inject do Fastify, sobre app.request do Hono (sem rede). */
export function testClient(app: App) {
  return {
    async inject(o: { method: string; url: string; headers?: Record<string, string>; payload?: unknown }): Promise<InjectResponse> {
      const headers: Record<string, string> = { ...(o.headers ?? {}) };
      let body: string | undefined;
      if (o.payload !== undefined) {
        body = JSON.stringify(o.payload);
        headers['content-type'] = 'application/json';
      }
      const res = await app.request(o.url, { method: o.method, headers, body });
      const text = await res.text();
      const cookies = res.headers.getSetCookie().map((c) => {
        const [pair] = c.split(';');
        const i = pair!.indexOf('=');
        return { name: pair!.slice(0, i), value: pair!.slice(i + 1) };
      });
      return { statusCode: res.status, body: text, json: () => JSON.parse(text), cookies };
    },
    async close() {},
  };
}
