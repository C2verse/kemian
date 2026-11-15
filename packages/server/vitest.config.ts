import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    // Tests that run the CLI as a child process take seconds each when Nx runs every target in parallel.
    testTimeout: 30_000,
  },
});
