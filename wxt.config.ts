import { fileURLToPath } from 'node:url';
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  hooks: {
    'build:publicAssets': (_wxt, files) => {
      files.push({
        absoluteSrc: fileURLToPath(new URL('./node_modules/harper.js/dist/harper_wasm_bg.wasm', import.meta.url)),
        relativeDest: 'harper.wasm',
      });
    },
  },
  manifest: ({ browser }) => ({
    name: 'OpenGrammar',
    description: 'Local, private grammar checking and better wording.',
    permissions: ['storage', 'activeTab'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: { id: 'opengrammar@opengrammar.dev', strict_min_version: '128.0' },
      },
    }),
  }),
});
