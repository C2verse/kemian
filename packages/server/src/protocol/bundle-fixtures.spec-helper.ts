export const build = { id: 'build-1', createdAt: '2026-10-25T12:00:00Z' };

export const bundleOf = (level: string, overrides: Record<string, unknown> = {}) => ({
  protocol: 1,
  level,
  build,
  folders: [{ path: '', summary: 'Root' }],
  files: [{ path: 'projects/lantern.md', summary: 'A project', content: '# Lantern' }],
  ...overrides,
});

export const bundleSetOf = (overrides: Record<string, unknown> = {}) => ({
  protocol: 1,
  build,
  bundles: [bundleOf('public'), bundleOf('private')],
  ...overrides,
});
