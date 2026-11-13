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
        'tx-0d2da0954a': resolve(__dirname, 'tx-0d2da0954a/index.html'),
        'desk-d4e15ff7a7': resolve(__dirname, 'desk-d4e15ff7a7/index.html'),
      },
    },
  },
  assetsInclude: ['**/*.md'],
});
