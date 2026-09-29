import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    // Vitest's default is 5000ms, and this suite has a CLUSTER of heavy render
    // tests sitting right on that line. Measured in one serial run on 2026-09-29:
    //
    //   4103ms  ThisWeekTab  "renders the three cards..."        passed
    //   4319ms  ColumnChart  "names the newest month..."         passed
    //   4882ms  Heatmap      "the toggle changes the counts"     passed
    //   6529ms  ImproveTab   "names the year on the grid..."     FAILED (timeout)
    //   6889ms  ImproveTab   "renders the four cards..."         FAILED (timeout)
    //
    // 118ms of headroom on the fastest passer. Which tests cross is decided by
    // run-to-run jitter, not by the code under test, so the failing NAMES move
    // every run — the signature that cost hours on 2026-09-29 chasing a
    // regression that did not exist. CI never saw it because ubuntu-latest
    // renders these faster than a local Windows/jsdom run does.
    //
    // A ceiling can only ever turn a false failure into a pass; it cannot hide a
    // real one, because a genuinely hung test still never finishes. The suite's
    // slowest legitimate test (InsightsSlices, 640 slices) takes ~230s in one
    // synchronous block, so this is deliberately well clear of the real work.
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      'server-only': path.resolve(__dirname, './__tests__/stubs/server-only.ts'),
    },
  },
})
