import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["./tests/setup.ts"]
  },
  resolve: {
    alias: {
      "@minecraft/server": "./tests/mocks/@minecraft/server/index.ts"
    }
  }
})