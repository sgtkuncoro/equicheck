import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Pinned so a developer's own .env cannot change what the guard tests mean.
    // dotenv does not override variables that are already set.
    env: { ALLOW_PRIVATE_TARGETS: 'false', GEMINI_API_KEY: 'test-key-not-used' },
  },
});
