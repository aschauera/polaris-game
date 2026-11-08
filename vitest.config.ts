import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', include: ['src/game/**/*.test.ts', 'src/exchange/**/*.test.ts', 'src/rendering/**/*.test.ts'] },
})
