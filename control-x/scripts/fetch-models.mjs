// Downloads the on-device model into extension/models/ so it ships inside the
// extension package (loaded with allowRemoteModels = false; nothing is fetched
// at runtime). Run once after cloning: `npm run models`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MODELS = {
  // Sentence encoder (BERT family, 33M params, int8). See README "Model choice".
  'Xenova/gte-small': ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'],
};

for (const [id, files] of Object.entries(MODELS)) {
  for (const f of files) {
    const out = path.join(root, 'extension/models', id, f);
    if (fs.existsSync(out)) continue;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const res = await fetch(`https://huggingface.co/${id}/resolve/main/${f}`);
    if (!res.ok) throw new Error(`${id}/${f}: HTTP ${res.status}`);
    fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    console.log(`fetched ${id}/${f} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
  }
}
