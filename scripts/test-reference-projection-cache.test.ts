import test from'node:test';import assert from'node:assert/strict';import{cachedChapter99Projection,referenceExecutionCache,type ReferenceRate}from'../app/api/tariff/references/store';
const source={id:'SYNTHETIC-PUBLIC-ORIGINAL',original_sha256:'a'.repeat(64)},row:ReferenceRate={source_id:source.id,hts:'99039101',description:'SYNTHETIC isolated projection',general:'25%',special:'',column2:'',additional_duties:'',units:[],footnotes:[],pdfPage:2,projection:'official-chapter99-pdf-v1'};
test('only a fully returned table is cached once for its pinned source and content hash, without sharing mutable results',async()=>{
 const cache=referenceExecutionCache();let calls=0;const load=async()=>{calls++;return[structuredClone(row)];},first=await cachedChapter99Projection(source,load,cache);first[0].general='99%';const second=await cachedChapter99Projection(source,load,cache);assert.equal(second[0].general,'25%');second[0].general='88%';assert.equal((await cachedChapter99Projection(source,load,cache))[0].general,'25%');assert.equal(calls,1);assert(cache.pdfRateBytes>0&&cache.pdfRateBytes<=4000000);
 await cachedChapter99Projection({...source,original_sha256:'b'.repeat(64)},load,cache);assert.equal(calls,2);await cachedChapter99Projection(source,load,referenceExecutionCache());assert.equal(calls,3);
 const other={...source,id:'SYNTHETIC-DIFFERENT-ORIGINAL'};await cachedChapter99Projection(other,async()=>[{...row,source_id:other.id}],cache);assert.equal(cache.chapter99Tables?.size,3);
});
test('failures, empty or invalid projections and cancellation never publish a partial cache entry',async()=>{
 const cache=referenceExecutionCache();await assert.rejects(cachedChapter99Projection(source,async()=>{throw Error('SYNTHETIC failed page');},cache));assert.equal(cache.chapter99Tables?.size??0,0);
 for(const rows of[[{...row,source_id:'SYNTHETIC-WRONG'}],[{...row,projection:'unknown'}],[row,row],[{...row,hts:'10000000'}]]){await assert.rejects(cachedChapter99Projection(source,async()=>rows,cache));assert.equal(cache.chapter99Tables?.size??0,0);}
 await cachedChapter99Projection(source,async()=>[],cache);assert.equal(cache.chapter99Tables?.size??0,0);const abort=new AbortController();cache.signal=abort.signal;await assert.rejects(cachedChapter99Projection(source,async()=>{abort.abort();return[row];},cache));assert.equal(cache.chapter99Tables?.size??0,0);
});
test('complete Chapter99 projections share the existing four-megabyte PDF budget and never leak across requests',async()=>{
 const cache=referenceExecutionCache();cache.pdfRateBytes=3999999;let calls=0;const load=async()=>{calls++;return[row];};await cachedChapter99Projection(source,load,cache);await cachedChapter99Projection(source,load,cache);assert.equal(calls,2);assert.equal(cache.pdfRateBytes,3999999);assert.equal(cache.chapter99Tables?.size??0,0);await cachedChapter99Projection(source,load);await cachedChapter99Projection(source,load);assert.equal(calls,4);
});
