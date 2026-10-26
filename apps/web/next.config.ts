import type { NextConfig } from 'next';

/**
 * O navegador fala só com a web (mesma origem). /api/* é encaminhado para a API por app/api/[...path]/route.ts:
 * em Cloudflare pela ligação interna (service binding), localmente por HTTP (API_URL).
 */
const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default config;

