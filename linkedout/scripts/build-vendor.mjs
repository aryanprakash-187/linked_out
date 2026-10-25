// Builds extension/vendor/ (the extension itself has no build step):
//  - anthropic-sdk.js: the official Anthropic SDK bundled into one classic
//    script for the background service worker (importScripts).
//  - transformers.min.js + ort/: Transformers.js and the ONNX Runtime
//    WebAssembly files it loads, copied so nothing is fetched from a CDN.
// Re-run with `npm run vendor` after bumping either package.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const vendor = path.join(root, 'extension/vendor');

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
  outfile: path.join(vendor, 'anthropic-sdk.js'),
});
console.log('wrote extension/vendor/anthropic-sdk.js');

const tdist = path.join(root, 'node_modules/@huggingface/transformers/dist');
fs.copyFileSync(path.join(tdist, 'transformers.min.js'), path.join(vendor, 'transformers.min.js'));
// The bundled ONNX Runtime loads its WASM backend from env.backends.onnx.wasm.wasmPaths.
const ortOut = path.join(vendor, 'ort');
fs.rmSync(ortOut, { recursive: true, force: true });
fs.mkdirSync(ortOut, { recursive: true });
const ortDist = path.join(root, 'node_modules/onnxruntime-web/dist');
// CPU (WASM) backend only; the WebGPU build isn't needed for a 33M-param encoder.
for (const f of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
  const src = fs.existsSync(path.join(tdist, f)) ? path.join(tdist, f) : path.join(ortDist, f);
  fs.copyFileSync(src, path.join(ortOut, f));
}
console.log('wrote extension/vendor/transformers.min.js and extension/vendor/ort/');
