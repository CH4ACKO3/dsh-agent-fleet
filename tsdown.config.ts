import { defineConfig } from 'tsdown'

const moduleHeader = `window.__ModuleLoader__.load({
  id: "dsh-agent-fleet",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;`

const moduleFooter = `return module.exports;
  },
});`

export default defineConfig({
  entry: { client: 'packages/ui/src/index.ts' },
  tsconfig: 'tsconfig.client.json',
  format: 'cjs',
  platform: 'browser',
  target: 'es2023',
  outDir: 'lib',
  clean: false,
  fixedExtension: false,
  outExtensions: () => ({ js: '.js' }),
  hash: false,
  sourcemap: true,
  dts: false,
  deps: {
    alwaysBundle: ['dsh-hover-hint', '@dsh-agent-fleet/core/activation', '@dsh-agent-fleet/core/names', '@dsh-agent-fleet/core/web', 'human-names', 'unique-random-array', 'unique-random'],
    onlyBundle: ['human-names', 'unique-random-array', 'unique-random', 'zod'],
  },
  banner: { js: moduleHeader },
  footer: { js: moduleFooter },
})
