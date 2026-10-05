import { defineConfig } from 'vite'

export default defineConfig({
  server: { port: 5179, strictPort: true },
  preview: { port: 5180, strictPort: true },
  build: { target: 'es2022', assetsInlineLimit: 0 },
  assetsInclude: ['**/*.ktx2', '**/*.glb', '**/*.bin'],
  test: { environment: 'node', include: ['tests/**/*.test.js'] },
})
