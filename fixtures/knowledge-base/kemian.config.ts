import type { KemianConfig } from '../../packages/server/src/bundler/index.ts';

export default {
  levels: ['public', 'private'],
  exclude: ['sources/**', '!sources/README.md'],
  frontmatter: { keep: ['status'] },
  filter: ({ level, frontmatter }) => level !== 'public' || frontmatter['status'] !== 'draft',
  instructions: { public: 'meta/public-instructions.md' },
  url: ({ path }) => `https://github.com/example/knowledge-base/blob/main/${path}`,
  review: { intervals: { evolving: 30, stable: 180 } },
} satisfies KemianConfig;
