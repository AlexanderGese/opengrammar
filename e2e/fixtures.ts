import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

const EXTENSION = path.resolve('.output/chrome-mv3');
const PAGE = fs.readFileSync(path.resolve('e2e/fixtures/page.html'));

export const test = base.extend<{ context: BrowserContext; extensionWorker: Worker; site: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    await use(context);
    await context.close();
  },
  extensionWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },
  site: async ({}, use) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    await use(`http://127.0.0.1:${port}/`);
    server.close();
  },
});

export const expect = test.expect;

export const underlines = (kind: string) => `opengrammar-overlay [data-og-underline="${kind}"]`;
