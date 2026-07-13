import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        // Standalone laugh-detector check, served at /vision-test.html
        visionTest: resolve(__dirname, 'vision-test.html'),
      },
    },
  },
})
