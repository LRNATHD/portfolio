import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        highschoolfinal: resolve(__dirname, 'highschoolfinal/index.html'),
      },
    },
  },
  assetsInclude: ['**/*.md'],
});
