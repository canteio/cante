import test from'node:test';
import assert from'node:assert/strict';
import{readFileSync}from'node:fs';
import{ratesOnPdfPage,type PdfCell}from'../app/api/tariff/references/pdf-rates';
import{computeExactDuty}from'../lib/tariff/duty-expression';
const original=JSON.parse(readFileSync('scripts/test-fixtures/historical-audits/wood-unit-2025-page-cells.json','utf8'));
const project=(cells:PdfCell[]=original.cells,notes?:Set<string>)=>ratesOnPdfPage(cells,original.sourceId,new Set(['4407110001']),original.page,false,notes)[0];
test('actual dated wood table preserves the cubic quantity and independently established exponent/footnote',()=>{
 const r=project(undefined,new Set(['1','2']));assert(r);assert.equal(r.general,'Free');assert.equal(r.column2,'$1.70/m3 2/');assert.deepEqual(r.units,['m3']);assert.equal(r.hts,'4407110001');
 // The footnote is deliberately retained. A bare unit restoration is not
 // permission to remove the legal condition or compute a complete duty.
 assert.equal(computeExactDuty(r.column2,{value:'1000.00',quantity:'25',unit:'m3'}),null);
 assert.equal(computeExactDuty('$1.70/m3',{value:'1000.00',quantity:'25',unit:'m3'}),'42.50');
 assert.equal(computeExactDuty('$1.70/m3',{value:'1000.00',quantity:'25',unit:'m'}),null);
});
test('missing, conflicting or ambiguous markers never turn a merged glyph into a simple linear-unit rate',()=>{
 for(const notes of [undefined,new Set<string>(),new Set(['1','32']),new Set(['1','2','32'])]){const r=project(undefined,notes);assert(r);assert.match(r.column2,/unresolved unit exponent/);assert.equal(computeExactDuty(r.column2,{value:'1000.00',quantity:'25',unit:'m'}),null);}
});
test('geometry must establish one raised, adjacent anchor in its own rate column',()=>{
 const marks=(original.cells as PdfCell[]).filter(c=>c.text==='32/');assert.equal(marks.length,1);
 for(const cells of [(original.cells as PdfCell[]).map(c=>c.text==='32/'?{...c,x:c.x+10}:c),(original.cells as PdfCell[]).map(c=>c.text==='32/'?{...c,y:c.y-5}:c),[...original.cells,{...(original.cells as PdfCell[]).find(c=>c.text==='$1.70/m')!}]]){
  const r=project(cells,new Set(['1','2']));assert(r);assert.notEqual(r.column2,'$1.70/m3 2/');
 }
});
