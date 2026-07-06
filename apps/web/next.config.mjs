import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Consume the shared types package as TypeScript SOURCE (ESM), not its compiled
  // CommonJS `dist`. Reason: pnpm resolves @crm/types to its real path outside
  // node_modules, so Next's React Refresh loader treats it as app code and injects
  // `import.meta.webpackHot` — which webpack cannot parse inside the CJS dist
  // ("Cannot use 'import.meta' outside a module"). Aliasing to the ESM source +
  // transpilePackages lets Next transpile it so React Refresh is valid.
  transpilePackages: ['@crm/types'],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@crm/types': path.resolve(dirname, '../../packages/types/src'),
    };
    return config;
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
