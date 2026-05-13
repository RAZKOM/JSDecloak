import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const shim = (name: string) => path.resolve(__dirname, 'src/shims', name)

// Node built-ins we need to substitute. Use array form with regex for exact match
// (alias keys are matched as prefixes by default, which collides for fs vs fs/promises).
const nodeAliases = [
  { find: /^node:fs\/promises$/, replacement: shim('fs-promises.js') },
  { find: /^fs\/promises$/, replacement: shim('fs-promises.js') },
  { find: /^node:fs$/, replacement: shim('fs.js') },
  { find: /^fs$/, replacement: shim('fs.js') },
  { find: /^node:path$/, replacement: shim('path.js') },
  { find: /^path$/, replacement: shim('path.js') },
  { find: /^node:os$/, replacement: shim('os.js') },
  { find: /^os$/, replacement: shim('os.js') },
  { find: /^node:assert\/strict$/, replacement: shim('assert.js') },
  { find: /^assert\/strict$/, replacement: shim('assert.js') },
  { find: /^node:assert$/, replacement: shim('assert.js') },
  { find: /^assert$/, replacement: shim('assert.js') },
]

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    'process.env': {},
    'process.platform': '"browser"',
    'process.version': '"v20.0.0"',
    'global': 'globalThis',
  },
  resolve: {
    alias: nodeAliases,
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
})
