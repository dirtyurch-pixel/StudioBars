import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // the phone version is published under /StudioBars/ on GitHub Pages; everything else lives at /
  base:
    (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
      .VITE_BASE || '/',
  plugins: [react(), tailwindcss()],
  server: { port: 5173, host: 'localhost' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
})
