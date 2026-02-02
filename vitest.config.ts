import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000, // 30s for concurrent bot operations
    hookTimeout: 10000,
    include: ['tests/**/*.test.ts'],
    sequence: {
      shuffle: false, // Predictable test order
    },
  },
})
