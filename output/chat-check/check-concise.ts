import { loadEnvConfig } from '@next/env';
import { readFileSync } from 'node:fs';
import { ApiProvider } from '../../lib/llm/api';
async function main() {
loadEnvConfig(process.cwd());
const route = readFileSync('app/api/chat/route.ts', 'utf8');
const prompt = (name: string) => route.match(new RegExp('const ' + name + ' = `([\\s\\S]*?)`;'))![1];
const events = [];
let text = '';
for await (const event of new ApiProvider().stream({
  system: prompt('UNITED_STATES_SYSTEM_PROMPT') + prompt('COMPANION_GUIDANCE'),
  prompt: 'Test fixture only. Current company facts: empty; catalogue: demo products with proposed unconfirmed HTS codes. Saved historical alert says a CSL snapshot changed and says rescreening is required; no matched party, no verified applicable legal change. No fresh web research is available in this test. Customer: can you check to see if any of my compliance is updated?',
  tools: [], timeoutMs: 60000,
})) {
  events.push(event.type);
  if (event.type === 'text') text += event.text;
  if (event.type === 'error') throw Error(event.message);
}
console.log(JSON.stringify({events, words:text.trim().split(/\s+/).length, text}, null, 2));

}
main().catch(e => { console.error(e.message); process.exitCode=1; });
