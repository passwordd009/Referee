import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        // Standalone laugh-detection diagnostic — open /vision-test.html
        // to verify the camera + AI pipeline outside of a match.
        visionTest: resolve(__dirname, 'vision-test.html'),
      },
    },
  },
});
