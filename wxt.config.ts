import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
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
