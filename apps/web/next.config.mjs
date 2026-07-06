/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Consume the shared types package directly (workspace).
  transpilePackages: ['@crm/types'],
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
