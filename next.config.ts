import type { NextConfig } from 'next';
import createMDX from '@next/mdx';
import createNextIntlPlugin from 'next-intl/plugin';

const withMDX = createMDX();

const withNextIntl = createNextIntlPlugin({
  requestConfig: './src/core/i18n/request.ts',
});

const nextConfig: NextConfig = {
  reactStrictMode: false,
  pageExtensions: ['ts', 'tsx', 'md', 'mdx'],
  serverExternalPackages: [
    '@libsql/client',
    'drizzle-orm',
    'better-auth',
    'mysql2',
    'postgres',
    'stripe',
  ],
};

export default withNextIntl(withMDX(nextConfig));
