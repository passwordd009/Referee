import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // face-api.js ES6 build only imports tfjs-core (no backends).
      // The UMD dist bundle has WebGL + CPU backends bundled in.
      'face-api.js': path.resolve(__dirname, 'node_modules/face-api.js/dist/face-api.js'),
    },
  },
  optimizeDeps: {
    include: ['face-api.js'],
  },
})
