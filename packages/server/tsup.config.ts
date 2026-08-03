import { defineConfig } from 'tsup';

// tsc 대신 tsup으로 번들한다.
//  - tsc + moduleResolution:"bundler" 조합은 확장자 없는 상대 import를 그대로 뱉어서
//    `node dist/index.js`가 ERR_MODULE_NOT_FOUND로 죽는다.
//  - @dropfall/shared는 빌드 산출물 없이 TS 소스를 직접 export하므로 반드시 번들에 인라인해야 한다.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // 워크스페이스 패키지는 번들 안으로, 나머지 node_modules는 외부 참조로 남긴다.
  noExternal: ['@dropfall/shared'],
});
