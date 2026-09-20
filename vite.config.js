import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'PCB-CNC-Multitool': resolve(__dirname, 'PCB-CNC-Multitool/index.html'),
        'realtalk': resolve(__dirname, 'realtalk/index.html'),
      },
    },
  },
  assetsInclude: ['**/*.md'],
});
