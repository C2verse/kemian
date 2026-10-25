import type { Bundle, BundleSet } from '../src/protocol/index.ts';

export const buildOf = (id: string) => ({ id, createdAt: '2026-10-25T12:00:00Z' });

export const publicBundle = (buildId = 'build-1'): Bundle => ({
  protocol: 1,
  level: 'public',
  build: buildOf(buildId),
  instructions: 'Answer only from these files.',
  folders: [{ path: '' }, { path: 'projects', summary: 'Things Robin has built.' }],
  files: [
    {
      path: 'README.md',
      title: 'Robin Example',
      summary: 'Who Robin is.',
      content: '# Robin Example\n\nA software engineer.',
    },
    {
      path: 'projects/lantern.md',
      title: 'Lantern',
      summary: 'A language server for configuration files.',
      updated: '2026-10-12',
      url: 'https://example.com/projects/lantern.md',
      meta: { status: 'stable' },
      content: '# Lantern\n\nLantern gives YAML files completion and validation.',
    },
  ],
});

export const privateBundle = (buildId = 'build-1'): Bundle => ({
  protocol: 1,
  level: 'private',
  build: buildOf(buildId),
  folders: [{ path: '' }, { path: 'projects', summary: 'Things Robin has built.' }],
  files: [
    ...publicBundle(buildId).files,
    {
      path: 'projects/atlas.md',
      visibility: 'private',
      title: 'Atlas',
      summary: 'An unannounced side project.',
      content: '# Atlas\n\nA map of internal services. Not announced yet.',
    },
  ],
});

export const bundleSetOf = (buildId = 'build-1'): BundleSet => ({
  protocol: 1,
  build: buildOf(buildId),
  bundles: [publicBundle(buildId), privateBundle(buildId)],
});
