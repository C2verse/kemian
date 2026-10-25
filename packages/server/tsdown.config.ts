import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    'protocol/index': 'src/protocol/index.ts',
    'bundler/index': 'src/bundler/index.ts',
    'bundler/cli': 'src/bundler/cli.ts',
    'core/index': 'src/core/index.ts',
    'cloudflare/index': 'src/cloudflare/index.ts',
    'github/index': 'src/github/index.ts',
  },
  format: 'esm',
  platform: 'neutral',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  deps: { neverBundle: [/^cloudflare:/u, /^node:/u] },
});
