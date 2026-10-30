/** Read-only inventory comparison. Pass a metadata-only db-query inventory JSON.
 * Never put raw snapshots (which can contain private function metadata) in Git. */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const [inventoryPath,outputPath]=process.argv.slice(2);
if(!inventoryPath||!outputPath)throw Error('Usage: node scripts/audit-supabase-architecture.mjs <inventory.json> <report.json>');
const inventory=JSON.parse(fs.readFileSync(inventoryPath,'utf8'));
const files=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory()&&!/[\\/](?:test-fixtures|test-support)$/.test(file))walk(file);else if(/\.(?:ts|tsx|mjs)$/.test(file)&&!file.endsWith('.test.ts')&&!/^(?:test-|verify-)/.test(e.name))files.push(file);}}
for(const dir of ['app','lib','components','pipelines','scripts','supabase/functions'])if(fs.existsSync(dir))walk(dir);
const tables=new Map(inventory.tables.filter(t=>t.schema==='public').map(t=>[t.name,t]));
const functions=new Set(inventory.functions.filter(f=>f.schema==='public').map(f=>f.name));
const usages=[],dynamic=[],privilegedImports=[];
for(const file of files){const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
 function visit(node){
  if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)&&/supabase\/service$/.test(node.moduleSpecifier.text))privilegedImports.push({file,line:source.getLineAndCharacterOfPosition(node.pos).line+1});
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&['from','rpc'].includes(node.expression.name.text)&&!['Array','Buffer','Object','Uint8Array','ReadableStream'].includes(node.expression.expression.getText(source))){
   const argument=node.arguments[0],kind=node.expression.name.text,line=source.getLineAndCharacterOfPosition(node.getStart()).line+1;
   if(argument&&ts.isStringLiteral(argument)){const name=argument.text;if(/^[a-z_][a-z_0-9]*$/.test(name))usages.push({file,line,kind,name,exists:kind==='from'?tables.has(name):functions.has(name)});}
   else dynamic.push({file,line,kind,expression:argument?.getText(source).slice(0,100)??''});
  }
  ts.forEachChild(node,visit);
 }visit(source);
}
const sqlDependencies=inventory.functions.map(f=>({...f,tables:[...new Set([...f.definition.matchAll(/public\.([a-z_][a-z_0-9]*)/g)].map(m=>m[1]).filter(n=>tables.has(n)))]}));
const tableMap=[...tables].map(([name,t])=>({name,rls:t.rls,kind:t.kind,rpcFunctions:sqlDependencies.filter(f=>f.tables.includes(name)).map(f=>f.schema+"."+f.name),rpcCallers:[...new Set(sqlDependencies.filter(f=>f.tables.includes(name)).flatMap(f=>usages.filter(u=>u.kind==='rpc'&&u.name===f.name).map(u=>u.file)))],files:[...new Set(usages.filter(u=>u.kind==='from'&&u.name===name).map(u=>u.file))],policies:inventory.policies.filter(p=>p.schema==='public'&&p.table===name).map(p=>({name:p.policyname,command:p.cmd,roles:p.roles})),foreignKeys:inventory.constraints.filter(c=>c.schema==='public'&&c.table===name&&c.type==='f').map(c=>c.definition)}));
const report={scope:{sourceFiles:files.length,publicTables:tables.size,functions:functions.size,sqlPolicies:inventory.policies.length,indexes:inventory.indexes.length,migrations:inventory.migrations.length},usages,missingReferences:usages.filter(u=>!u.exists),dynamicReferences:dynamic,privilegedImports,tables:tableMap,unprotectedTables:inventory.tables.filter(t=>t.kind==='r'&&['public','private'].includes(t.schema)&&!t.rls),definerFunctions:inventory.functions.filter(f=>f.definer).map(f=>({schema:f.schema,name:f.name,anonymous:f.anon,authenticated:f.authenticated,searchPath:f.config})),storage:inventory.buckets,schedules:inventory.cron};
fs.writeFileSync(outputPath,JSON.stringify(report,null,2),{mode:0o600});
console.log(JSON.stringify({scope:report.scope,missingReferences:report.missingReferences,dynamicReferences:report.dynamicReferences,unprotectedTables:report.unprotectedTables,privilegedImports:report.privilegedImports},null,2));
