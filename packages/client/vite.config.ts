import { defineConfig } from 'vite';

export default defineConfig({
  // 상대 경로로 빌드해야 GitHub Pages(/DropFall/)와 홈서버(/) 양쪽에
  // 같은 산출물을 그대로 올릴 수 있다. (docs/02-tech-spec.md §9.4)
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
  },
});
