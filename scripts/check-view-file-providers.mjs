// Checks that chat models accept view_file's pictures where the agent loop puts them: in a user
// message straight after a tool result. OpenAI's format has no images inside a tool message, so
// the loop sends them in the next user message, and some providers refuse a user message there.
// When a provider refuses, the loop sends the step again without the pictures and turns view_file
// off for the reply. This script shows which models need that fallback.
//
// Each model gets the request the loop would send after one view_file call: a tool result and then
// two labelled pictures, a red square ("page 1") and a blue one ("page 2"), and is asked the colour
// of page 2. A model that answers blue saw the pictures and kept their labels apart.
//
// Usage:
//   OPENROUTER_API_KEY=sk-or-... node scripts/check-view-file-providers.mjs [model ...]
// With no models given, it checks the cheapest image-input model from each of several providers,
// read from OpenRouter's public model list. Each request costs a fraction of a cent.
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const rules = require('../agent/fileViewRules.js');
require('../agent/tools.js');
const viewFileDef = globalThis.ABChatAgent.toolDefs.find((def) => def.function.name === 'view_file');

const API_KEY = process.env.OPENROUTER_API_KEY || '';
const PROVIDERS = ['anthropic/', 'openai/', 'google/', 'mistralai/', 'qwen/', 'meta-llama/', 'x-ai/'];

// A solid-colour PNG, built by hand so the script needs no image library.
function solidPng(r, g, b, size) {
  const crcTable = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
  return 'data:image/png;base64,' + png.toString('base64');
}

async function defaultModels() {
  const response = await fetch('https://openrouter.ai/api/v1/models');
  if (!response.ok) throw new Error('Could not read the model list: HTTP ' + response.status);
  const list = (await response.json()).data || [];
  const picked = [];
  for (const prefix of PROVIDERS) {
    const candidates = list.filter((model) => model.id.startsWith(prefix)
      && !/:free$/.test(model.id)
      && model.architecture && Array.isArray(model.architecture.input_modalities) && model.architecture.input_modalities.includes('image')
      && Array.isArray(model.supported_parameters) && model.supported_parameters.includes('tools'));
    candidates.sort((a, b) => Number(a.pricing.prompt) - Number(b.pricing.prompt));
    if (candidates[0]) picked.push(candidates[0].id);
  }
  return picked;
}

function requestFor(model) {
  const pictures = rules.imagesMessage([
    { label: 'check.pdf (blob 5), page 1 of 2', dataUrl: solidPng(220, 30, 30, 64) },
    { label: 'check.pdf (blob 5), page 2 of 2', dataUrl: solidPng(30, 60, 220, 64) }
  ]);
  return {
    model,
    max_tokens: 400,
    tools: [viewFileDef],
    messages: [
      { role: 'system', content: 'You check files you made. Answer in one short sentence.' },
      { role: 'user', content: 'Look at both pages of check.pdf, then tell me the colour of page 2.' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_view_1', type: 'function', function: { name: 'view_file', arguments: '{"blob_id":5}' } }] },
      { role: 'tool', tool_call_id: 'call_view_1', content: JSON.stringify({ ok: true, file: 'check.pdf', blob_id: 5, kind: 'pdf', pages: 2, shown: 'pages 1-2 at full size', note: 'The pictures follow in the next message, this once.' }) },
      pictures
    ]
  };
}

async function check(model) {
  const started = Date.now();
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API_KEY, 'X-Title': 'Agentic Browser Chat provider check' },
    body: JSON.stringify(requestFor(model))
  });
  const text = await response.text();
  if (!response.ok) return { model, status: response.status, verdict: 'REFUSED', detail: text.slice(0, 160).replace(/\s+/g, ' ') };
  let json = {};
  try { json = JSON.parse(text); } catch (err) { return { model, status: response.status, verdict: 'BAD JSON', detail: text.slice(0, 160) }; }
  const message = json.choices && json.choices[0] && json.choices[0].message || {};
  const answer = String(message.content || '').replace(/\s+/g, ' ').trim();
  // The pictures message asks for a note on what the model sees, so an answer may name both
  // pages. It is right when it ties blue to page 2, or names blue and not red.
  const saysPage2Blue = /page\s*2\b[^.;\n]*\bblue\b/i.test(answer) || /\bblue\b[^.;\n]*\bpage\s*2\b/i.test(answer);
  const saysPage2Red = /page\s*2\b[^.;\n]*\bred\b/i.test(answer);
  const onlyBlue = /\bblue\b/i.test(answer) && !/\bred\b/i.test(answer);
  const verdict = (saysPage2Blue && !saysPage2Red) || onlyBlue ? 'OK' : (message.tool_calls ? 'CALLED A TOOL' : 'WRONG');
  return { model: json.model || model, status: response.status, verdict, detail: (answer || JSON.stringify(message.tool_calls || '')).slice(0, 160), ms: Date.now() - started };
}

if (!API_KEY) {
  console.error('Set OPENROUTER_API_KEY to an OpenRouter key. Nothing was sent.');
  process.exit(2);
}
const models = process.argv.slice(2).length ? process.argv.slice(2) : await defaultModels();
console.log('Checking ' + models.length + ' models: ' + models.join(', ') + '\n');
let failures = 0;
for (const model of models) {
  let outcome;
  try {
    outcome = await check(model);
  } catch (err) {
    outcome = { model, status: 0, verdict: 'ERROR', detail: err.message };
  }
  if (outcome.verdict !== 'OK') failures++;
  console.log(outcome.verdict.padEnd(14) + String(outcome.status).padEnd(5) + outcome.model + '\n' + ' '.repeat(19) + outcome.detail);
}
console.log('\nREFUSED means the loop falls back to no pictures for that model. WRONG means the model got the pictures but mixed them up or did not look.');
process.exit(failures ? 1 : 0);
