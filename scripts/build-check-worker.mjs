import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const tsxRequire = createRequire(require.resolve('tsx'));
const { build } = tsxRequire('esbuild');
const destination = resolve(process.argv[2] ?? 'output/check-worker');
await mkdir(resolve(destination,'api'),{recursive:true});
const result=await build({entryPoints:[resolve('scripts/check-worker/entry.ts')],outfile:resolve(destination,'api/check.mjs'),bundle:true,platform:'node',format:'esm',target:'node22',treeShaking:true,minify:true,metafile:true,external:['@napi-rs/canvas','pdfjs-dist/*'],banner:{js:'import { createRequire as __workerCreateRequire } from "node:module";const require=__workerCreateRequire(import.meta.url);'},plugins:[{name:'worker-session',setup(builder){
  builder.onResolve({filter:/^@\/lib\/supabase\/server$/},()=>({path:resolve('scripts/check-worker/session.ts')}));
  builder.onResolve({filter:/^next\/headers$/},()=>({path:resolve('scripts/check-worker/no-next.ts')}));
}}]});
const inputs=Object.keys(result.metafile.inputs);
if(inputs.some(p=>p.includes('node_modules/next/')||p.includes('lib/llm/')||p.includes('lib/delivery/')))throw Error('Worker unexpectedly includes website/provider/delivery code.');
await writeFile(resolve(destination,'api/monitor.mjs'), 'export { default } from \"./check.mjs\";\n');
await writeFile(resolve(destination,'package.json'),JSON.stringify({private:true,type:'module',engines:{node:'22.x'}},null,2));
await writeFile(resolve(destination,'vercel.json'),JSON.stringify({version:2,framework:null,buildCommand:'',installCommand:'',functions:{'api/check.mjs':{maxDuration:300},'api/monitor.mjs':{maxDuration:300}}},null,2));
await writeFile(resolve(destination,'.vercelignore'),'.env*\n');
console.log(JSON.stringify({directory:destination,bundleBytes:result.metafile.outputs[Object.keys(result.metafile.outputs)[0]].bytes,inputs:inputs.length,noWebsiteOrProviderCode:true}));
