// Bundles the official Anthropic TypeScript SDK into a single classic script
// that the extension's background service worker loads with importScripts().
// The extension itself has no build step; only this vendored file is generated.
// Re-run with `npm run vendor` after bumping @anthropic-ai/sdk.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

await build({
  stdin: {
    contents: "import Anthropic from '@anthropic-ai/sdk'; globalThis.Anthropic = Anthropic;",
    resolveDir: root,
    loader: 'js',
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome120', 'safari16'],
  minify: true,
  legalComments: 'inline',
  outfile: path.join(root, 'extension/vendor/anthropic-sdk.js'),
});
console.log('wrote extension/vendor/anthropic-sdk.js');
