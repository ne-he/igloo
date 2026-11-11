import { defineConfig } from 'vite'

// id build untuk versi aset (src/engine/assetVersion.js): berubah tiap build, kosong di dev
const buildId = Date.now().toString(36)

export default defineConfig(({ command }) => ({
  server: { port: 5179, strictPort: true },
  preview: { port: 5180, strictPort: true },
  define: { __BUILD_ID__: JSON.stringify(command === 'build' ? buildId : '') },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    // dua halaman: situs 3D (index.html) dan profil ringkas tanpa 3D (quick.html)
    rollupOptions: { input: { main: 'index.html', quick: 'quick.html' } },
  },
  assetsInclude: ['**/*.ktx2', '**/*.glb', '**/*.bin'],
  test: { environment: 'node', include: ['tests/**/*.test.js'] },
}))
