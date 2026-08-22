import { defineConfig } from 'tsdown'

const moduleHeader = `window.__ModuleLoader__.load({
  id: "@ch4acko3/dsh-agent-fleet-git",
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
  deps: {
    alwaysBundle: ['simple-icons', 'zod'],
    onlyBundle: ['simple-icons', 'zod'],
  },
  banner: { js: moduleHeader },
  footer: { js: moduleFooter },
})
