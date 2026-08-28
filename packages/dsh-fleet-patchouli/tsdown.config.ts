import { defineConfig } from 'tsdown'

const moduleHeader = `window.__ModuleLoader__.load({
  id: "dsh-agent-fleet-patchouli",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;`

const moduleFooter = `return module.exports;
  },
});`

export default defineConfig({
  entry: { client: 'src/client/index.ts' },
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
  banner: { js: moduleHeader },
  footer: { js: moduleFooter },
})
