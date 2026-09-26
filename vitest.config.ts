import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * 测试配置。
 *
 * 为什么用 swc：NestJS 的依赖注入依赖 `emitDecoratorMetadata`（design:paramtypes），
 * 而 esbuild（vitest 默认）不支持它 —— 不换 swc 的话 DI 会直接报"依赖解析失败"。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // 每个测试文件独立进程，避免 pg-mem 实例互相污染
    isolate: true,
  },
  plugins: [
    swc.vite({
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
      module: { type: 'es6' },
    }),
  ],
});
