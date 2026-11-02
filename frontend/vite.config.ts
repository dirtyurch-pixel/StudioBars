import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { phoneData } from './phone-data.mjs'

export default defineConfig({
  // the phone version is published under /StudioBars/ on GitHub Pages; everything else lives at /
  base:
    (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
      .VITE_BASE || '/',
  plugins: [react(), tailwindcss(), phoneData()],
  // the phone version's tests read the dictionaries straight from the backend folder
  server: { port: 5173, host: 'localhost', fs: { allow: ['..'] } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
})
