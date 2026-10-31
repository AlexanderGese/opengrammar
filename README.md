# OpenGrammar

Private, local grammar checking in your browser. Underlines spelling and grammar issues as you type in
text boxes and rich editors, with fixes, ignore, a personal dictionary and per-site disable.
Grammar checking runs on [Harper](https://writewithharper.com) inside the extension — no text leaves your machine.

## Develop

```bash
npm install
npm run dev            # Chromium with the extension loaded, hot reload
npm run dev:firefox    # Firefox
npm test               # unit tests
npm run e2e            # build + Playwright tests (run `npx playwright install chromium` once)
```

Builds: `npm run build` → `.output/chrome-mv3`, `npm run build:firefox` → `.output/firefox-mv3`.

## Roadmap

Plan 2: in-browser model for better wording and non-English grammar, LanguageTool (Full mode), editor page.
