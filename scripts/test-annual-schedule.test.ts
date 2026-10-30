/** Public printed cell excerpts, fictional source identities and declarations.
 * Functionality/provenance contracts do not establish legal approval. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {referencePackage} from '../app/api/tariff/references/ingestion';
import {readReferenceBytes} from '../app/api/tariff/references/store';
import {proveAnnualScheduleIdentity,proveAnnualScheduleChangeIdentity,proveAnnualScheduleChanges,type AnnualScheduleIdentity} from '../app/api/tariff/references/ordinary-contract';
import {annualChapterPageNumber,ratesOnPdfPage,type PdfCell} from '../app/api/tariff/references/pdf-rates';
import {annualForEntry,annualQuantityCodeContract,corroborateAnnualRate,type AnnualRow,type AnnualScheduleEvidence} from '../app/api/tariff/references/annual-data';
import {computeExactDutySum} from '../lib/tariff/duty-expression';
const source={id:'SYNTHETIC-CHAPTER',kind:'legal_document',url:'https://hts.usitc.gov/reststop/file?release=chapter98&filename=Chapter%2065',metadata:{role:'annual_schedule_chapter',annualScheduleYear:2016,chapter:'65',publisherRelease:'chapter98',registryId:'SYNTHETIC-REGISTRY',detailsId:'SYNTHETIC-DETAILS',archiveId:'SYNTHETIC-ARCHIVE'}};
const record={name:'chapter98',description:'2016 HTSA Basic Edition',status:'archive',releaseStartDate:'05/17/2016',releaseEndDate:'06/30/2016'};
const provenance={source,registrySource:{id:'SYNTHETIC-REGISTRY',kind:'release_registry',url:'https://hts.usitc.gov/reststop/releaseList'},detailsSource:{id:'SYNTHETIC-DETAILS',kind:'legal_document',url:'https://hts.usitc.gov/reststop/releaseDetails?release=chapter98',metadata:{role:'annual_schedule_details',annualScheduleYear:2016,publisherRelease:'chapter98'}},archiveSource:{id:'SYNTHETIC-ARCHIVE',kind:'legal_document',url:'https://www.usitc.gov/harmonized_tariff_information/hts/archive/list?page=7'},registry:[record],details:{reldetail:record,pdfList:{'Chapter 65':''}},archive:'<div><div>2016 HTSA Basic Edition (March 21, 2016)</div><div class="views-field-nothing"><a href="https://hts.usitc.gov/view/release?release=chapter98">HTML</a></div></div>'};
const identity=proveAnnualScheduleIdentity(provenance)!;
const units=annualQuantityCodeContract(readFileSync('scripts/test-fixtures/historical-audits/annual-quantity-code-key.txt','utf8'));
const row:AnnualRow={record:1,hts8:'65050008',description:'SYNTHETIC declared classification',from:'2014-01-01',through:'2016-12-31',rateType:'6',adValorem:'0.06',specific:'0.01',other:'0.13',textRate:'13.5 cents/kg + 6.3% + 1.9 cents/article',textRateAvailable:true,special:'',column2:'',units:['NO','KG'],quantityCodes:['NO','KG'],footnote:'',additional:''};
const cells=JSON.parse(readFileSync('scripts/test-fixtures/historical-audits/annual-schedule-page-cells.json','utf8')) as PdfCell[],rate=ratesOnPdfPage(cells,source.id,new Set(['6505000800']),4,true)[0];rate.projection='official-annual-chapter-v1';
const entry={date:'2016-06-15',hts:'6505000800'},annual=annualForEntry([row],2016,'SYNTHETIC-ANNUAL',entry,{id:'SYNTHETIC-KEY',valid:true,quantityUnits:units,fieldsSourceId:'SYNTHETIC-FIELDS'}),evidence:AnnualScheduleEvidence={identity,sourceId:source.id,rate};
const reconcile=(es:AnnualScheduleEvidence[]=[evidence],r=annual,e=entry)=>corroborateAnnualRate(r,e,es,units,'SYNTHETIC-FIELDS');
test('older edition names bind to exact original URLs and archive/registry/details identities',()=>{
 assert(identity);assert.equal(identity.year,2016);assert.equal(identity.publisherRelease,'chapter98');assert.equal(identity.availableFrom,'2016-05-17');
 for(const broken of [{source:{...source,url:source.url.replace('Chapter%2065','Chapter%2064')}},{source:{...source,metadata:{...source.metadata,annualScheduleYear:2017}}},{registry:[record,record]},{registry:[{...record,status:'current'}]},{details:{...provenance.details,reldetail:{...record,releaseStartDate:'06/17/2016'}}},{archive:provenance.archive.replace('hts.usitc.gov','example.invalid')},{archive:provenance.archive.replace('2016 HTSA Basic','2016 HTSA Preliminary')},{detailsSource:{...provenance.detailsSource,url:provenance.detailsSource.url+'&other=1'}},{source:{...source,url:'invalid'}}])assert.equal(proveAnnualScheduleIdentity({...provenance,...broken}),null);
});

test('a published change record proves explicit dates while an N/A correction remains undated',()=>{
 const record2017={...record,name:'NTE',description:'2017 HTSA Revision 1 Edition',releaseStartDate:'10/30/2017',releaseEndDate:'12/21/2017'};
 const metadata={role:'annual_schedule_changes',annualScheduleYear:2017,publisherRelease:'NTE',registryId:'SYNTHETIC-REGISTRY',detailsId:'SYNTHETIC-DETAILS',archiveId:'SYNTHETIC-ARCHIVE'};
 const changed={...provenance,source:{id:'SYNTHETIC-CHANGES',kind:'legal_document',url:'https://hts.usitc.gov/reststop/file?release=NTE&filename=Change%20Record',metadata},detailsSource:{...provenance.detailsSource,url:'https://hts.usitc.gov/reststop/releaseDetails?release=NTE',metadata:{role:'annual_schedule_details',annualScheduleYear:2017,publisherRelease:'NTE'}},registry:[record2017],details:{reldetail:record2017,pdfList:{'Change Record':''}},archive:provenance.archive.replaceAll('2016 HTSA Basic Edition','2017 HTSA Revision 1 Edition').replaceAll('release=chapter98','release=NTE')};
 const identity=proveAnnualScheduleChangeIdentity(changed);assert(identity);
 assert.equal(proveAnnualScheduleIdentity(changed),null,'A change record is never a chapter table');
 const text=readFileSync('scripts/test-fixtures/historical-audits/2017-change-record.txt','utf8');
 const proof=proveAnnualScheduleChanges({source:changed.source,identity,text});assert(proof);
 assert.deepEqual(proof.restorations,[{hts8:'69073010',effectiveOn:'2017-01-01',authority:'PP 9549'}]);
 assert.deepEqual(proof.undatedRestorations,['44092265']);
 assert.deepEqual(proof.annotations.map(a=>[a.hts8,a.effectiveOn,a.previous,a.established]),[['29181700','2017-07-01',['00'],['01']],['29313900','2017-07-01',['00'],['12','15','18']]]);
 for(const broken of [{...changed,details:{...changed.details,pdfList:{'Chapter 69':''}}},{...changed,registry:[record2017,record2017]},{...changed,archive:changed.archive.replaceAll('hts.usitc.gov','example.invalid')},{...changed,source:{...changed.source,url:changed.source.url+'&ignored=1'}}])assert.equal(proveAnnualScheduleChangeIdentity(broken),null);
 for(const t of [text.replace('January 1, 2017 PP 9549','February 1, 2017 PP 9549'),text.replace('Restored N/A','Restored January 1, 2017'),text+' 6907.30.10 Restored column 2 rate of duty July 1, 2017 PP 9549',text.slice(0,-100)])assert.equal(proveAnnualScheduleChanges({source:changed.source,identity,text:t}),null);
 assert.equal(proveAnnualScheduleChanges({source:{...changed.source,metadata:{...metadata,registryId:'other-source'}},identity,text}),null);
});
test('a raw multi-unit PDF expression remains evidence until the full annual formula is corroborated',()=>{
 assert.equal(ratesOnPdfPage(cells,source.id,new Set(['6505000800']),4).length,0);
 assert.equal(rate.general,'13.5¢/kg + 6.3% + 1.9¢/article');assert.equal(rate.hts,'6505000800');assert.deepEqual(rate.footnotes,[]);assert.equal(annual.mfnRate,null);
 const resolved=reconcile();assert.equal(resolved.mfnRate,'$0.019/no + $0.135/kg + 6.3%');assert.equal(resolved.row?.specific,'0.01');assert.equal(annual.mfnRate,null);assert.equal(resolved.mfnComputation?.compiler,'annual-schedule-formula-v2');assert.equal(resolved.scheduleCorroboration?.reconciledFields.length,3);
 const amount=computeExactDutySum(resolved.mfnComputation!.terms.map(t=>({raw:t.rate,input:{value:'1000.00',quantity:t.unit==='no'?'100':t.unit==='kg'?'25':null,unit:t.unit}})));assert.equal(amount,'68.28');
});
test('all retained applicable candidates must agree; none is silently selected or dropped',()=>{
 const later={...evidence,identity:{...identity,publisherRelease:'SYNTHETIC-LATER',availableFrom:'2016-11-17'},sourceId:'SYNTHETIC-LATER',rate:{...rate,source_id:'SYNTHETIC-LATER'}};
 assert.equal(reconcile([evidence,later]).scheduleCorroboration?.originals.length,2);
 for(const bad of [{...later,rate:{...later.rate,general:'14.5¢/kg + 6.3% + 1.9¢/article'}},{...later,rate:null},{...later,issue:'Unparsed original'},{...later,rate:{...later.rate,footnotes:[{value:'Unreviewed quota'}]}}])assert.equal(reconcile([evidence,bad]).mfnRate,null);
 assert.equal(corroborateAnnualRate(annual,entry,[evidence],units,'SYNTHETIC-FIELDS',['Missing provenance']).mfnRate,null);
});
test('only the exact known precision loss is reconciled, never arbitrary conflicts or extra terms',()=>{
 for(const changed of [{...row,specific:'0.02'},{...row,other:'0.14'},{...row,adValorem:'0.07'},{...row,textRate:row.textRate+' if qualified'},{...row,quantityCodes:['NO','NA'] as [string,string]},{...row,other:'0.13',rateType:'4'}])assert.equal(reconcile([evidence],{...annual,row:changed}).mfnRate,null);
 assert.equal(reconcile([{...evidence,rate:{...rate,general:rate.general+' + 1%'}}]).mfnRate,null);assert.equal(reconcile([{...evidence,rate:{...rate,hts:'6505000899'}}]).mfnRate,null);
});
test('annual dated rows provide applicability, never the later publication or another year',()=>{
 const early={date:'2016-01-15',hts:entry.hts};assert(reconcile([evidence],annual,early).mfnComputation,'Independent dated annual text remains the date basis.');
 assert.equal(reconcile([evidence],{...annual,year:2015}).mfnRate,null);assert.equal(reconcile([evidence],annual,{...entry,date:'2017-01-15'}).mfnRate,null);assert.equal(reconcile([{...evidence,identity:{...identity,year:2017}}]).mfnRate,null);
 assert.equal(reconcile([evidence],{...annual,row:{...row,through:'2016-04-30'}}).mfnRate,null,'A later original outside the annual record cannot corroborate that record.');
 for(const invalid of [{...entry,date:'2016-02-30'},{...entry,date:'2016-6-15'},{...entry,hts:entry.hts.slice(0,8)},{...entry,hts:entry.hts+'0'}])assert.equal(reconcile([evidence],annual,invalid).mfnRate,null);
 for(const invalid of [{...row,from:'2016-07-01'},{...row,through:'2016-05-31'},{...row,from:'2016-02-30'}])assert.equal(reconcile([evidence],{...annual,row:invalid}).mfnRate,null);
});
test('plain percentage precision uses the same exact sum and keeps quantity inputs unnecessary',()=>{
 const r={...row,rateType:'7',specific:'0',other:'0',adValorem:'0.02',textRate:'2.5%',quantityCodes:['',''] as [string,string]},a=annualForEntry([r],2016,'SYNTHETIC-ANNUAL',entry,{id:'SYNTHETIC-KEY',valid:true,quantityUnits:units,fieldsSourceId:'SYNTHETIC-FIELDS'}),resolved=reconcile([{...evidence,rate:{...rate,general:'2.5%'}}],a);assert.equal(resolved.mfnRate,'2.5%');assert.equal(resolved.mfnComputation?.terms[0].unit,null);assert.equal(resolved.scheduleCorroboration?.reconciledFields[0].exact,'0.025');
});
test('small immutable originals can use existing object storage with both hashes verified',async()=>{
 const original=Buffer.from('SYNTHETIC immutable public-source storage test. '.repeat(3000)),pack=referencePackage({kind:'legal_document',url:'https://www.usitc.gov/SYNTHETIC-OBJECT',title:'SYNTHETIC',bytes:original,external:'always'});assert(pack.storageBytes);assert.equal(pack.body,'');assert(pack.storageBytes.length<1000000);
 const db={from(){return{select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:'SYNTHETIC',...pack},error:null})};},storage:{from(bucket:string){assert.equal(bucket,'official-tariff-references');return{download:async()=>({data:new Blob([new Uint8Array(pack.storageBytes!)]),error:null})};}}};assert.deepEqual((await readReferenceBytes(db as never,'SYNTHETIC')).bytes,original);
 const bad={...db,storage:{from(){return{download:async()=>({data:new Blob([new Uint8Array(Buffer.alloc(pack.storageBytes!.length))]),error:null})};}}};await assert.rejects(readReferenceBytes(bad as never,'SYNTHETIC'),/integrity/);
});

test('actual printed endnote page headers retain contiguous chapter identity without dropping their notes',()=>{
 const cells:PdfCell[]=[{text:'Harmonized Tariff Schedule of the United States (2017)',x:170.314,y:757.39},{text:'Annotated for Statistical Reporting Purposes',x:243.654,y:747.613},{text:'VI',x:45.72,y:739.214},{text:'Endnotes--page 29 - 146',x:45.72,y:730.815},{text:'1/ See heading 9902.02.93.',x:46.8,y:719.55}];
 assert.equal(annualChapterPageNumber(cells,'29'),146);assert.equal(annualChapterPageNumber(cells,'28'),null);assert.equal(annualChapterPageNumber([...cells,{text:'29 - 146',x:45,y:740}],'29'),null);assert.equal(annualChapterPageNumber(cells.map(c=>({...c,text:c.text.replace('Endnotes--page','Appendix page')})),'29'),null);assert.equal(annualChapterPageNumber(cells.map(c=>({...c,text:c.text.replace('146','0')})),'29'),null);
});

test('actual 1.8-point rate baselines remain in their own rows rather than merging the next tariff',()=>{
 for(const [fixture,codes,general,column2]of [['wood',['4412316100','4412319200'],['8%','8%'],['40%','40%']],['tile',['6907213000','6907214000'],['10%','8.5%'],['55%','55%']]] as const){const excerpt=JSON.parse(readFileSync('scripts/test-fixtures/historical-audits/annual-'+fixture+'-boundary-cells.json','utf8')),rates=ratesOnPdfPage(excerpt.cells,'SYNTHETIC',new Set(codes),excerpt.page,true);assert.deepEqual(rates.map(r=>r.hts),[...codes]);assert.deepEqual(rates.map(r=>r.general),[...general]);assert.deepEqual(rates.map(r=>r.column2),[...column2]);}
 const excerpt=JSON.parse(readFileSync('scripts/test-fixtures/historical-audits/annual-wood-boundary-cells.json','utf8')),marked=[...excerpt.cells,{text:'7/',x:400,y:507.8}],rates=ratesOnPdfPage(marked,'SYNTHETIC',new Set(['4412316100','4412319200']),excerpt.page,true);assert(!rates[0].footnotes.some((f:any)=>f.marker==='7'));assert(rates[1].footnotes.some((f:any)=>f.marker==='7'),'The superscript marker above the legal-label baseline cannot disappear.');
});

test('a close next-row superscript belongs to its nearest column anchor only',()=>{
 const cells:PdfCell[]=[{text:'General',x:385,y:700},{text:'Special',x:450,y:700},{text:'Rates of Duty',x:380,y:730},{text:'4412.31.61',x:47,y:600},{text:'00',x:95,y:600},{text:'SYNTHETIC first',x:150,y:600},{text:'10%',x:385,y:591.8},{text:'30%',x:525,y:591.8},{text:'4412.31.92',x:47,y:580},{text:'00',x:95,y:580},{text:'SYNTHETIC second',x:150,y:580},{text:'20%',x:385,y:581.8},{text:'40%',x:525,y:581.8},{text:'7/',x:400,y:585},{text:'4412.32',x:47,y:560}];
 const rates=ratesOnPdfPage(cells,'SYNTHETIC',new Set(['4412316100','4412319200']),1,true);assert.equal(rates.length,2);assert.deepEqual(rates.map(r=>r.column2),['30%','40%']);assert.equal(rates[0].footnotes.length,0);assert(rates[1].footnotes.some((f:any)=>f.marker==='7'));
});

test('printed square/cubic unit exponents rejoin only their unique measured rate anchor',()=>{
 const excerpt=JSON.parse(readFileSync('scripts/test-fixtures/historical-audits/annual-wood-unit-cells.json','utf8')),wanted=new Set(['4409220515','4409221000','4409229000']),read=(cells:PdfCell[])=>ratesOnPdfPage(cells,'SYNTHETIC',wanted,excerpt.page,true);
 const rates=read(excerpt.cells);assert.deepEqual(rates.map(r=>[r.hts,r.column2]),[['4409220515','33 1/3%'],['4409221000','4.3¢/m2'],['4409229000','$1.70/m3']]);
 const square=excerpt.cells.find((c:PdfCell)=>c.text==='2'&&c.x>540&&c.y<400),anchor=excerpt.cells.find((c:PdfCell)=>c.text==='4.3¢/m');assert(square&&anchor);
 // No width, distant digit or conflicting exponents cannot establish a unit.
 for(const changed of [excerpt.cells.map((c:PdfCell)=>c===anchor?{...c,width:undefined}:c),excerpt.cells.map((c:PdfCell)=>c===square?{...c,x:c.x+10}:c),[...excerpt.cells,{...square,text:'3'}],[...excerpt.cells,{...anchor}]])assert.notEqual(read(changed).find(r=>r.hts==='4409221000')?.column2,'4.3¢/m2');
 assert.equal(excerpt.cells.find((c:PdfCell)=>c===anchor).text,'4.3¢/m','Original source cells remain unchanged.');
});

test('an original inline General marker retains its own column and measured text without removing the note',()=>{
 const f=JSON.parse(readFileSync('scripts/test-fixtures/historical-audits/annual-general-note-cells.json','utf8')),read=(cells:PdfCell[])=>ratesOnPdfPage(cells,'SYNTHETIC',new Set(['2904991500']),f.page,true)[0],r=read(f.cells),note=r.footnotes[0] as {marker:string;scope?:string;scopeEvidence?:{x:number;y:number;text:string}};
 assert.equal(r.general,'5.5%');assert.equal(r.column2,'15.4¢/kg +51%');assert.equal(note.marker,'7');assert.equal(note.scope,'general_rate');assert.deepEqual(note.scopeEvidence,{x:380.72,y:501.153,text:'5.5% 7/'});
 for(const duplicate of [{text:'7/',x:170,y:501.153},{text:'7/',x:535,y:501.153}])assert.equal((read([...f.cells,duplicate]).footnotes.find((n:any)=>n.marker==='7') as {scope?:string}).scope,undefined,'A mark shared outside General cannot establish General-only scope.');
 const standalone=(cells:PdfCell[])=>ratesOnPdfPage(cells,'SYNTHETIC',new Set(['2904994700']),f.page,true)[0].footnotes[0] as {scope?:string;scopeEvidence?:{markerCell?:{text:string}}};assert.equal(standalone(f.cells).scope,'general_rate');assert.equal(standalone(f.cells).scopeEvidence?.markerCell?.text,'10/');
 for(const cells of [f.cells.map((c:PdfCell)=>c.text==='5.5%'&&c.y===174.153?{...c,width:undefined}:c),f.cells.map((c:PdfCell)=>c.text==='10/'&&c.x<444?{...c,x:430}:c),[...f.cells,{text:'10/',x:170,y:174.153}]])assert.equal(standalone(cells).scope,undefined);
});

test('published left-edge descriptions and bottom-edge rates remain within their own table columns',()=>{
 for(const [name,code,column2]of [['photo','3705000000','25%'],['paddle','4421918800','35%']] as const){
  const f=JSON.parse(readFileSync('scripts/test-fixtures/historical-audits/annual-'+name+'-edge-cells.json','utf8')),rates=ratesOnPdfPage(f.cells,'SYNTHETIC',new Set([code]),f.page,true);assert.equal(rates.length,1);assert.equal(rates[0].hts,code);assert.equal(rates[0].general,'Free');assert.equal(rates[0].column2,column2);assert(rates[0].description.length>5);assert.deepEqual(rates[0].footnotes,[]);
  if(name==='photo'){assert.equal(ratesOnPdfPage(f.cells.map((c:PdfCell)=>c.x===110.72?{...c,x:100}:c),'SYNTHETIC',new Set([code]),f.page,true).length,0,'Suffix-column prose does not become a description.');}
  else assert.equal(ratesOnPdfPage([...f.cells,{text:'9%',x:380.72,y:25}],'SYNTHETIC',new Set([code]),f.page,true)[0].general,'Free','Footer material below the bounded table remains excluded.');
 }
});
