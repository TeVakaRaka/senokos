import { defineConfig } from 'vite';

// Сборка одной только симуляции в один файл без импортов:
// его можно запустить и в Node (V8), и во встроенном в macOS jsc (JavaScriptCore).
export default defineConfig({
  publicDir: false,
  build: {
    target: 'es2020',
    outDir: 'dist-sim',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: 'tools/xengine-entry.ts',
      formats: ['iife'],
      name: 'SenokosXEngine',
      fileName: () => 'xengine.js',
    },
  },
});
