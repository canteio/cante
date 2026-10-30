import{createHash}from'node:crypto';
import {getDocumentProxy,getResolvedPDFJS} from 'unpdf';
import {computeExactDuty,parseDutyRate} from '@/lib/tariff/duty-expression';
import type {ReferenceRate,ReferenceRelease} from './store';
export type PdfCell={text:string;x:number;y:number;width?:number};
const DESCRIPTION_LEFT=110;
const clean=(s:string)=>s.replace(/\s+/g,' ').trim();
/** Printer baseline noise must not reorder parallel table columns. Group only
 * cells within one PDF point of the row's highest baseline, then read left
 * to right. Separate printed lines and superscript markers remain separate. */
function pdfReadingOrder(cells:PdfCell[]){const rows:{y:number;cells:PdfCell[]}[]=[];for(const cell of [...cells].sort((a,b)=>b.y-a.y)){const row=rows.at(-1);if(row&&row.y-cell.y<=1)row.cells.push(cell);else rows.push({y:cell.y,cells:[cell]});}return rows.flatMap(row=>row.cells.sort((a,b)=>a.x-b.x));}
const inlineMarker=(text:string)=>/^(.+?)\s+(\d+\/(?:\d+\/)*)$/.exec(text);
/** Text extraction alone cannot prove a page blank: an unextractable scanned
 * table also has little text. Require the complete bounded drawing program to
 * contain only text/state operations and the exact known header/blank words. */
export async function verifiedBlankChapterPage(page:{getOperatorList:()=>Promise<{fnArray:number[]}>},cells:PdfCell[],year:number){
 const text=cells.map(c=>c.text).join(' '),headerOnly=cells.length===2&&cells.every(c=>c.y>=740)&&cells.some(c=>c.text==='Harmonized Tariff Schedule of the United States ('+year+')')&&cells.some(c=>c.text==='Annotated for Statistical Reporting Purposes'),explicit=/^This page intentionally left blank[.]?$/i.test(text);
 if(!headerOnly&&!explicit)return null;const ops=await page.getOperatorList();if(ops.fnArray.length>200)return null;const{OPS}=await getResolvedPDFJS(),allowed=new Set([OPS.beginText,OPS.dependency,OPS.setFont,OPS.setTextMatrix,OPS.setFillRGBColor,OPS.setCharSpacing,OPS.setWordSpacing,OPS.showText,OPS.endText,OPS.save,OPS.restore,OPS.transform,OPS.moveText,OPS.setLeading,OPS.setTextRenderingMode]);
 return ops.fnArray.every(op=>allowed.has(op))?(headerOnly?'header_only' as const:'explicit_blank' as const):null;
}
/** Reattach an explicitly printed square/cubic unit exponent to its own rate
 * baseline. Width and position must place it immediately after a trailing /m;
 * unrelated digits, footnote markers and ambiguous placements remain untouched. */
function rateUnitExponents(cells:PdfCell[],knownFootnotes?:ReadonlySet<string>):PdfCell[]{
 const suffixes=new Map<PdfCell,string>(),consumed=new Set<PdfCell>(),placements=new Map<PdfCell,{cell:PdfCell;value:string}[]>();
 for(const cell of cells.filter(c=>/^[23](?:\d+\/(?:\d+\/)*)?$/.test(c.text)&&c.x>=336&&c.x<610)){
  const combined=/^([23])(\d+\/(?:\d+\/)*)$/.exec(cell.text);
  // A merged "32/" can be exponent 3 + footnote 2, or footnote 32.
  // Split only when the complete chapter establishes every remainder marker
  // and excludes the unsplit marker. Unknown/conflicting definitions cannot help.
  if(combined&&(!knownFootnotes||knownFootnotes.has(cell.text.slice(0,-1))||combined[2].split('/').filter(Boolean).some(m=>!knownFootnotes.has(m))))continue;
  const left=cell.x>=522?522:cell.x>=444?444:cell.x>=380?380:336,right=cell.x>=522?610:cell.x>=444?522:cell.x>=380?444:380;
  const anchors=cells.filter(c=>c.x>=left&&c.x<right&&(left===336?/^m$/:/\/m$/).test(c.text)&&typeof c.width==='number'&&Number.isFinite(c.width)&&c.width>0&&cell.x-(c.x+c.width)>=-1&&cell.x-(c.x+c.width)<=2&&cell.y-c.y>0.5&&cell.y-c.y<=8);
  if(anchors.length!==1)continue;const existing=placements.get(anchors[0])??[];existing.push({cell,value:combined?combined[1]+' '+combined[2]:cell.text});placements.set(anchors[0],existing);
 }
 for(const [anchor,exponents]of placements)if(exponents.length===1){suffixes.set(anchor,exponents[0].value);consumed.add(exponents[0].cell);}
 return cells.filter(c=>!consumed.has(c)).map(c=>suffixes.has(c)?{...c,text:c.text+suffixes.get(c)}:c);
}
/** One strict coordinate contract shared by statistical and printed-suffix rows. */
function legalBands(rawCells:PdfCell[],knownFootnotes?:ReadonlySet<string>){
 const cells=rateUnitExponents(rawCells,knownFootnotes);
 if(cells.filter(c=>c.text.replace(/\s+/g,'')==='General'&&c.x>=380&&c.x<440).length!==1||cells.filter(c=>c.text.replace(/\s+/g,'')==='Special'&&c.x>=445&&c.x<520).length!==1||!cells.some(c=>c.text.replace(/\s+/g,'')==='RatesofDuty'))return [];
 const isMarker=(c:PdfCell)=>/^\d+\/(?:\d+\/)*$/.test(c.text);
 // Associate a superscript with its nearest same-column text anchor, rather
 // than attaching a nearby next-row qualifier to both tariff rows.
 const markerAnchors=cells.filter(c=>c.x<444&&isMarker(c)).map(marker=>{const left=marker.x>=380?380:marker.x>=336?336:marker.x>=DESCRIPTION_LEFT?DESCRIPTION_LEFT:40,right=marker.x>=380?444:marker.x>=336?380:marker.x>=DESCRIPTION_LEFT?336:DESCRIPTION_LEFT,anchors=cells.filter(c=>c.x>=left&&c.x<right&&!isMarker(c)&&!/^[:.\s]+$/.test(c.text)&&Math.abs(c.y-marker.y)<=8),distance=Math.min(...anchors.map(c=>Math.abs(c.y-marker.y)));return{marker,anchors:anchors.filter(c=>Math.abs(c.y-marker.y)-distance<=0.1)};});
 const headings=cells.filter(c=>c.x>=40&&c.x<90&&/^\d{4}(?:\.\d{2}(?:\.\d{2})?)?$/.test(inlineMarker(c.text)?.[1]??c.text)).map(c=>({...c,text:inlineMarker(c.text)?.[1]??c.text,headingMarkers:inlineMarker(c.text)?.[2]??''})).sort((a,b)=>b.y-a.y),result=[];
 for(let i=0;i<headings.length;i++){
  const heading=headings[i];if(!/^\d{4}\.\d{2}\.\d{2}$/.test(heading.text))continue;
  // The published body-rate font can sit 1.8 pt above its HTS label.
  // Use the same 2 pt boundary on both sides; never merge the next row.
  const bottom=headings[i+1]?.y??30,band=cells.filter(c=>c.y<=heading.y+2&&c.y>bottom+2),generalCells=band.filter(c=>c.x>=380&&c.x<444&&!/^\d+\/(?:\d+\/)*$/.test(c.text)),rate=clean(pdfReadingOrder(generalCells).map(c=>inlineMarker(c.text)?.[1]??c.text).join(' '));
  const members=new Set(band),footnotes:{marker:string;value:string;scope?:'general_rate';scopeEvidence?:{x:number;y:number;text:string;width?:number;markerCell?:{x:number;y:number;text:string}}}[]=markerAnchors.filter(m=>m.anchors.some(a=>members.has(a))).flatMap(({marker:c})=>c.text.split('/').filter(Boolean).map(marker=>({marker,value:''})));
  for(const marker of heading.headingMarkers.split('/').filter(Boolean))if(!footnotes.some(f=>f.marker===marker))footnotes.push({marker,value:''});
  for(const cell of generalCells){const inline=inlineMarker(cell.text);if(inline)for(const marker of inline[2].split('/').filter(Boolean))if(!footnotes.some(f=>f.marker===marker)){
   // Only an inline mark directly on the General rate can establish this
   // position. A repeated mark elsewhere in the row keeps unknown/shared scope.
   const elsewhere=band.some(c=>(c.x<380||c.x>=444)&&(isMarker(c)?c.text:inlineMarker(c.text)?.[2]??'').split('/').includes(marker));
   footnotes.push({marker,value:'',...(!elsewhere?{scope:'general_rate' as const,scopeEvidence:{x:cell.x,y:cell.y,text:cell.text}}:{})});
  }}
  if(generalCells.length===1)for(const note of footnotes){
   const anchor=generalCells[0],marks=markerAnchors.filter(m=>m.marker.x>=380&&m.marker.x<444&&m.marker.text.split('/').includes(note.marker)&&m.anchors.length===1&&m.anchors[0]===anchor),shared=heading.headingMarkers.split('/').includes(note.marker)||band.some(c=>(c.x<380||c.x>=444)&&(isMarker(c)?c.text:inlineMarker(c.text)?.[2]??'').split('/').includes(note.marker))||markerAnchors.some(m=>m.marker.x<380&&m.marker.text.split('/').includes(note.marker)&&m.anchors.some(a=>members.has(a)));
   if(note.scope||shared||marks.length!==1||typeof anchor.width!=='number'||!Number.isFinite(anchor.width)||anchor.width<=0)continue;const marker=marks[0].marker,gap=marker.x-(anchor.x+anchor.width);
   if(Math.abs(marker.y-anchor.y)>1||gap< -1||gap>15)continue;
   note.scope='general_rate';note.scopeEvidence={x:anchor.x,y:anchor.y,text:anchor.text,width:anchor.width,markerCell:{x:marker.x,y:marker.y,text:marker.text}};
  }
  const column=(left:number,right:number)=>{const text=clean(pdfReadingOrder(band.filter(c=>c.x>=left&&c.x<right)).map(c=>c.text).join(' '));const ambiguous=rawCells.some(c=>c.x>=left&&c.x<right&&/^[23]\d+\/(?:\d+\/)*$/.test(c.text)&&c.y>heading.y+2&&c.y<=heading.y+10&&band.some(a=>a.x>=left&&a.x<right&&/\/m$/.test(a.text)&&typeof a.width==='number'&&c.x-a.x-a.width>=-1&&c.x-a.x-a.width<=2));return ambiguous?text+' [unresolved unit exponent / footnote]':text;};
  result.push({heading,bottom,band,rate,footnotes,special:column(444,522),column2:column(522,610)});
 }
 return result;
}
/** Strict coordinate contract for the publisher's standard six-column table.
 * Unknown layouts, incomplete split rows and prose rates produce no rate. */
export function ratesOnPdfPage(cells:PdfCell[],sourceId:string,wanted:Set<string>,page:number,retainExpressionEvidence=false,knownFootnotes?:ReadonlySet<string>):ReferenceRate[]{
 const rates:ReferenceRate[]=[];
 for(const {heading:h,bottom,band,rate,footnotes,special,column2}of legalBands(cells,knownFootnotes)){
  const prefix=h.text.replaceAll('.',''),parsed=parseDutyRate(rate);if(!rate||rate.length>100||!retainExpressionEvidence&&!parsed.parsed)continue;
  if(!retainExpressionEvidence&&computeExactDuty(rate,{value:'100.00',quantity:parsed.specificUnit?'1':null,unit:parsed.specificUnit})===null)continue;
  for(const suffix of cells.filter(c=>c.x>=90&&c.x<DESCRIPTION_LEFT&&/^\d{2}$/.test(c.text)&&c.y<=h.y+1&&c.y>bottom+1)){
   const hts=prefix+suffix.text;if(!wanted.has(hts))continue;
   const description=clean(pdfReadingOrder(band.filter(c=>c.x>=DESCRIPTION_LEFT&&c.x<336&&c.y<=suffix.y+1&&c.y>suffix.y-26&&!/^\d+\/(?:\d+\/)*$/.test(c.text))).map(c=>c.text).join(' ')).replace(/\.{2,}/g,'').trim();if(!description)continue;
   const units=band.filter(c=>c.x>=336&&c.x<380&&Math.abs(c.y-suffix.y)<20).map(c=>c.text.replace(/\.+$/,'').trim()).filter(Boolean);
   rates.push({source_id:sourceId,hts,description,general:rate,special,column2,additional_duties:'',units:[...new Set(units)],footnotes:footnotes.map(f=>({...f})),pdfPage:page,projection:'official-pdf-table-v1'});
  }
 }
 return rates;
}
const WATCH_STATISTICAL_INTRO="statisticalnotes1thecalculationofdutiesonvariouswatchesclockswatchmovementsandclockmovementsrequiresthatthesearticlesbeconstructivelyseparatedintotheircomponentpartsandeachcomponentseparatelyvaluedtheindividualcomponentsshallbeseparatelyreportedunderthestatisticalsuffixesshowbelowineachinstancethesumofthevaluesoftheindividualcomponentsshallbeequaltothetotalvalueofthearticleinthoseinstanceswherethecomponentsofanarticlearetobeseparatelyreportedunderthefollowingreportingschemetheentryshouldincludealltheindividuallynamedcomponentsevenifnotincludedintheshipmentinsuchinstancetheenteredquantityandvaluewouldbezeroforexampleentryofabatterypoweredwatchimportedwithoutabatteryclassifiableundersubheading91011140wouldincludealineforthestatisticalreportingnumberforthebattery(9101114040)withthequantityandvalueshownaszerotodeterminetheproperstatisticalreportingnumber(s)forthesubheadingsenumeratedbelowtheimportershallcombinetheapplicable8-digitsubheadingnumberwiththeapplicablestatisticalsuffixfoundbelow";
const WATCH_STATISTICAL_TABLES:Record<string,string>={
 "a": "statarticledescriptionunitofsuffixquantity10movementno20caseno30strapbandorbraceletno40batteryno",
 "b": "statarticledescriptionunitofsuffixquantity10movementandcasenoofmovements20batteryno",
 "c": "statarticledescriptionunitofsuffixquantity10movementno20caseno",
 "d": "statarticledescriptionunitofsuffixquantity10movementno20caseno30strapbandorbraceletno",
 "e": "statarticledescriptionunitofsuffixquantity10movementno20caseno30batteryno",
 "f": "statarticledescriptionunitofsuffixquantitytravelclocks10movementandcasenoofmovements20batterynootherclocks30movementandcasenoofmovements40batteryno",
 "g": "statarticledescriptionunitofsuffixquantitytravelclocks10movementno20caseno30batterynootherclocks40movementno50caseno60batteryno",
 "h": "statarticledescriptionunitofsuffixquantitytravelclocks10movementno20casenootherclocks30movementno40caseno",
 "ij": "statarticledescriptionunitofsuffixquantity10clockscapableofoperatingonlyonacpowernoothertravelclocks20movementandcasenoofmovements30batterynootherclocks40movementandcasenoofmovements50batteryno",
 "k": "statarticledescriptionunitofsuffixquantityclockscapableofoperatingonlyonacpower05movementno15casenoothertravelclocks20movementno30caseno40batterynootherclocks50movementno60caseno70batteryno",
 "l": "statarticledescriptionunitofsuffixquantitytravelclocks10movementnodutiablejwls20casenootherclocks30movementnodutiablejwls40caseno",
 "m": "statarticledescriptionunitofsuffixquantity10clockscapableofoperatingonlyonacpowernootherclocks20movementandcasenoofmovements30batteryno",
 "n": "statarticledescriptionunitofsuffixquantityclockscapableofoperatingonlyonacpower10movementno20casenootherclocks30movementno40caseno50batteryno",
 "o": "statarticledescriptionunitofsuffixquantity10apparatusno20batteryno",
 "p": "statarticledescriptionunitofsuffixquantity10movementnodutiablejwls20caseno",
 "q": "statarticledescriptionunitofsuffixquantity10movementno20batteryno",
 "r": "statarticledescriptionunitofsuffixquantity10clocksmovementscapableofoperatingonlyonacpowernootherclockmovements20movementno30batteryno"
};
export type StatisticalComponentRole='movement'|'case'|'strap'|'battery'|'movement_case'|'apparatus'|'ac_article';
export type StatisticalComponentEvidence={note:'91:1';group:string;notePage:number;role:StatisticalComponentRole;suffix:string;branch:string;required:{suffix:string;role:StatisticalComponentRole;dutiableJewels?:boolean}[];instruction:string;table:string};
const compactNote=(s:string)=>s.toLowerCase().replace(/[\s.,:]+/g,'');
/** Complete published reporting-table grammars. Prefix membership comes from
 * each pinned original, never from a guessed statistical suffix or parent row. */
export function watchStatisticalComponents(pages:{page:number;cells:PdfCell[]}[]):Map<string,StatisticalComponentEvidence>|null{
 const map=new Map<string,StatisticalComponentEvidence>(),seen=new Set<string>();let instruction='';
 const tuple=(suffix:string,role:StatisticalComponentRole,branch='all',dutiableJewels=false)=>({suffix,role,branch,...(dutiableJewels?{dutiableJewels:true}:{})});
 const schemas:Record<string,ReturnType<typeof tuple>[]>={
  a:[tuple('10','movement'),tuple('20','case'),tuple('30','strap'),tuple('40','battery')],
  b:[tuple('10','movement_case'),tuple('20','battery')],c:[tuple('10','movement'),tuple('20','case')],
  d:[tuple('10','movement'),tuple('20','case'),tuple('30','strap')],e:[tuple('10','movement'),tuple('20','case'),tuple('30','battery')],
  f:[tuple('10','movement_case','travel'),tuple('20','battery','travel'),tuple('30','movement_case','other'),tuple('40','battery','other')],
  g:[tuple('10','movement','travel'),tuple('20','case','travel'),tuple('30','battery','travel'),tuple('40','movement','other'),tuple('50','case','other'),tuple('60','battery','other')],
  h:[tuple('10','movement','travel'),tuple('20','case','travel'),tuple('30','movement','other'),tuple('40','case','other')],
  ij:[tuple('10','ac_article','ac'),tuple('20','movement_case','travel'),tuple('30','battery','travel'),tuple('40','movement_case','other'),tuple('50','battery','other')],
  k:[tuple('05','movement','ac'),tuple('15','case','ac'),tuple('20','movement','travel'),tuple('30','case','travel'),tuple('40','battery','travel'),tuple('50','movement','other'),tuple('60','case','other'),tuple('70','battery','other')],
  l:[tuple('10','movement','travel',true),tuple('20','case','travel'),tuple('30','movement','other',true),tuple('40','case','other')],
  m:[tuple('10','ac_article','ac'),tuple('20','movement_case','other'),tuple('30','battery','other')],
  n:[tuple('10','movement','ac'),tuple('20','case','ac'),tuple('30','movement','other'),tuple('40','case','other'),tuple('50','battery','other')],
  o:[tuple('10','apparatus'),tuple('20','battery')],p:[tuple('10','movement','all',true),tuple('20','case')],q:[tuple('10','movement'),tuple('20','battery')],
  r:[tuple('10','ac_article','ac'),tuple('20','movement','other'),tuple('30','battery','other')],
 };
 for(const {page,cells}of pages){
  if(!cells.some(c=>/^Statistical Notes(?: \(con\.\))?$/.test(c.text)))continue;
  const headings=cells.filter(c=>c.x<100&&/^\([a-z]{1,2}\)$/.test(c.text)).sort((a,b)=>b.y-a.y);
  if(!headings.length)continue;
  if(headings.some(h=>h.text==='(a)')){const first=headings[0],intro=clean(pdfReadingOrder(cells.filter(c=>c.y>first.y+1&&c.y<730&&!/^(?:[IVX]+|91\s*-\s*\d+|Harmonized Tariff Schedule.*|Annotated for Statistical Reporting Purposes)$/.test(c.text))).map(c=>c.text).join(' '));if(compactNote(intro)!==WATCH_STATISTICAL_INTRO)return null;instruction=intro;}
  for(let i=0;i<headings.length;i++){
   const h=headings[i],group=h.text.slice(1,-1),schema=schemas[group];if(!schema||seen.has(group))return null;seen.add(group);
   const band=cells.filter(c=>c!==h&&c.y<=h.y+1&&c.y>(headings[i+1]?.y===undefined?40:headings[i+1].y+1)),text=clean(pdfReadingOrder(band).map(c=>c.text).join(' ')),match=/^The statistical suffixes for subheadings? (.+?) shall be: (.+)$/.exec(text);if(!match||compactNote(match[2]).replace(/^(?:statunitsuffixarticledescriptionofquantity|unitstatsuffixarticledescriptionofquantity)/,'statarticledescriptionunitofsuffixquantity')!==WATCH_STATISTICAL_TABLES[group])return null;
   const prefixes=match[1].match(/\b91\d{2}\.\d{2}\.\d{2}\b/g)??[];if(!prefixes.length||prefixes.length>100||new Set(prefixes).size!==prefixes.length||match[1].replace(/\b91\d{2}\.\d{2}\.\d{2}\b/g,'').replace(/\band\b/g,'').replace(/[,\s]/g,''))return null;
   for(const raw of prefixes)for(const row of schema){const prefix=raw.replaceAll('.',''),hts=prefix+row.suffix;if(map.has(hts))return null;map.set(hts,{note:'91:1',group,notePage:page,role:row.role,suffix:row.suffix,branch:row.branch,required:schema.filter(s=>s.branch===row.branch).map(({branch:_b,...s})=>s),instruction:'',table:match[2]});}
  }
 }
 if(!instruction||seen.size!==Object.keys(schemas).length)return null;for(const value of map.values())value.instruction=instruction;return map;
}
export function watchParentRates(cells:PdfCell[],sourceId:string,wanted:Set<string>,page:number,components:Map<string,StatisticalComponentEvidence>):ReferenceRate[]{
 const rates:ReferenceRate[]=[];
 for(const row of legalBands(cells)){
  const prefix=row.heading.text.replaceAll('.','');if(![...wanted].some(c=>c.startsWith(prefix))||!row.rate||row.rate.length>300)continue;
  // This parent is explicitly reported through Statistical Note 1, not a
  // made-up 00 suffix. Other/unresolved footnotes remain on the evidence row.
  if(!row.footnotes.some(f=>f.marker==='1'))continue;
  for(const hts of wanted){const component=components.get(hts);if(!component||!hts.startsWith(prefix))continue;
   const description=clean(pdfReadingOrder(row.band.filter(c=>c.x>=DESCRIPTION_LEFT&&c.x<336&&!/^\d+\/$/.test(c.text))).map(c=>c.text).join(' ')).replace(/\.{2,}/g,'').trim();if(!description)continue;
   rates.push({source_id:sourceId,hts,description:component.role.replaceAll('_',' ')+' · '+description,general:row.rate,special:row.special,column2:row.column2,additional_duties:'',units:['No.'],footnotes:row.footnotes.map(f=>({...f})),pdfPage:page,projection:'official-annual-statistical-v1',statisticalComponent:component});
  }
 }
 return rates;
}
/** Same-year corroboration reads the complete original chapter. Raw expressions
 * may be retained, but do not become calculations here. The annual compiler
 * must independently consume every printed amount, unit and conditional term. */
/** Endnotes keep the chapter's printed page sequence. They are read for
 * footnote definitions, never skipped as blank pages or omitted from evidence. */
export function annualChapterPageNumber(cells:PdfCell[],chapter:string):number|null{
 const labels=cells.filter(c=>(c.x<110||c.x>450)&&c.y>600).map(c=>/^(?:Endnotes--page\s+)?(\d{1,2})\s*-\s*(\d+)$/.exec(c.text)).filter((m):m is RegExpExecArray=>!!m);
 if(labels.length!==1||Number(labels[0][1])!==Number(chapter))return null;const page=Number(labels[0][2]);return Number.isSafeInteger(page)&&page>=1&&page<=250?page:null;
}
export async function historicalAnnualChapterRates(bytes:Buffer,sourceId:string,identity:{year:number;chapter:string},codes:string[],onStatisticalCatalog?:(codes:string[]|null)=>void):Promise<ReferenceRate[]>{
 if(bytes.length>25000000||bytes.subarray(0,5).toString()!=='%PDF-'||(!Number.isInteger(identity.year)||identity.year<2000||identity.year>2017)||!/^(?:0[1-9]|[1-9][0-9])$/.test(identity.chapter)||Number(identity.chapter)>97||identity.chapter==='77'||codes.length>500||codes.some(c=>!/^\d{10}$/.test(c)||!c.startsWith(identity.chapter)))throw Error('Annual chapter lookup exceeds its scope or byte bounds.');
 const doc=await getDocumentProxy(new Uint8Array(bytes));try{
  if(doc.numPages<1||doc.numPages>250)throw Error('Annual chapter exceeds its 250-page bound.');
  const wanted=new Set(codes),rates:ReferenceRate[]=[],watchPages:{page:number;cells:PdfCell[]}[]=[],notes=new Map<string,string>(),localNotes=new Map<number,Map<string,string>>();let chapterPage=0,watchCells=0,deferredBytes=0;const deferred:{page:number;cells:PdfCell[]}[]=[];
  for(let page=1;page<=doc.numPages;page++){
   const content=await(await doc.getPage(page)).getTextContent();if(content.items.length>12000)throw Error('Annual chapter page exceeds its item bound.');
   const cells=content.items.flatMap(i=>'str'in i?[{text:clean(i.str),x:i.transform[4],y:i.transform[5],width:i.width}]:[]).filter(c=>c.text),text=cells.map(c=>c.text).join(' ');
   const blank=await verifiedBlankChapterPage(await doc.getPage(page),cells,identity.year);if(blank){if(blank==='header_only')chapterPage++;continue;}if(!text.includes('Harmonized Tariff Schedule of the United States ('+identity.year+')'))return [];
   const printedPage=annualChapterPageNumber(cells,identity.chapter);
   if(printedPage===null&&chapterPage===0&&page<=12&&cells.some(c=>/^[IVX]+\s*-\s*\d+$/.test(c.text)))continue;
   if(printedPage!==chapterPage+1)return [];chapterPage++;
   const local=new Map<string,string>();localNotes.set(page,local);
   for(const cell of cells){const m=/^(\d+)\/\s+(.+)$/.exec(cell.text);if(m)for(const map of [local,notes]){const old=map.get(m[1]);map.set(m[1],old&&old!==m[2]?'UNRESOLVED conflicting footnote definitions':m[2]);}}
   if(cells.some(c=>/^[23]\d+\/(?:\d+\/)*$/.test(c.text)&&c.x>=380)){deferredBytes+=Buffer.byteLength(JSON.stringify(cells));if(deferredBytes>4000000)throw Error('Merged-unit chapter evidence exceeds its 4 MB deferred-page bound.');deferred.push({page,cells});}else rates.push(...ratesOnPdfPage(cells,sourceId,wanted,page,true));if(identity.chapter==='91'&&(cells.some(c=>/^Statistical Notes/.test(c.text))||cells.some(c=>c.x<90&&/^91\d{2}\.\d{2}\.\d{2}$/.test(inlineMarker(c.text)?.[1]??c.text)&&codes.some(code=>code.startsWith((inlineMarker(c.text)?.[1]??c.text).replaceAll('.','')))))){watchCells+=cells.length;if(watchCells>150000)throw Error('Statistical chapter evidence exceeds its retained-cell bound.');watchPages.push({page,cells});}
  }
  if(!chapterPage)return [];
  const known=new Set([...notes].filter(([,v])=>!v.startsWith('UNRESOLVED')).map(([k])=>k));for(const p of deferred)rates.push(...ratesOnPdfPage(p.cells,sourceId,wanted,p.page,true,known));
  if(identity.chapter==='91'){const components=watchStatisticalComponents(watchPages);onStatisticalCatalog?.(components?[...components.keys()]:null);if(components){for(const p of watchPages)rates.push(...watchParentRates(p.cells,sourceId,wanted,p.page,components));
   // A complete Note 1 explicitly publishes the code/allocation even when the
   // General row is not extractable. Preserve that distinction: no invented
   // General rate. Only a complete dated annual formula may supply it later.
   for(const hts of wanted){const c=components.get(hts);if(c&&!rates.some(r=>r.hts===hts))rates.push({source_id:sourceId,hts,description:c.role.replaceAll('_',' ')+' · Statistical Note 1 reporting table; General row not extracted',general:'',special:'',column2:'',additional_duties:'',units:['No.'],footnotes:[],pdfPage:c.notePage,projection:'official-annual-statistical-note-v1',statisticalComponent:c});}
  }}
  for(const rate of rates){if(!rate.statisticalComponent)rate.projection='official-annual-chapter-v1';rate.footnotes=rate.footnotes.map(raw=>{const f=raw as {marker:string},marker=f.marker;return{...f,marker,value:localNotes.get(rate.pdfPage!)?.get(marker)??notes.get(marker)??'UNRESOLVED PDF footnote '+marker};});}
  return rates.filter(r=>rates.filter(x=>x.hts===r.hts).length===1);
 }finally{await doc.loadingTask.destroy();}
}
/** Bounded exact-code lookup in a pinned original. This does not publish a
 * partial chapter as a complete schedule or assert wider legal coverage. */
/** Publication identity only. This original's cover renders English but has a
 * malformed ToUnicode map; its body rate tables remain ordinary English text.
 * Match the whole retained original AND observed cover/edition. Never repair
 * legal-rate text by transliteration or accept a member-provided content hash. */
export function historicalEncodedCoverIdentity(originalSha256:string,cover:string,release:ReferenceRelease){
 return originalSha256==='3395dc092051824ca265235363d60e9e26b325f33bf132f33028e16a0a9a5da6'&&release.name==='2019HTSAREV7C'&&release.description==='2019 Revision 7'&&release.published_on==='2019-06-13'&&release.available_from==='2019-06-13'&&release.available_until==='2019-06-28'&&createHash('sha256').update(cover.replace(/\s+/g,' ').trim()).digest('hex')==='a5af429b794528a979f01934f69049e926757427a143971d21ef9dc027c33ef3';
}
export async function historicalPdfRates(bytes:Buffer,sourceId:string,release:ReferenceRelease,codes:string[]):Promise<ReferenceRate[]>{
 if(bytes.length>25000000||codes.length>500||codes.some(c=>!/^\d{10}$/.test(c)))throw Error('Historical PDF lookup exceeds its input bounds.');
 const doc=await getDocumentProxy(new Uint8Array(bytes));try{if(doc.numPages>6000)throw Error('Historical schedule exceeds page limit.');
 const cache=new Map<number,PdfCell[]>();let reads=0;
 async function cells(page:number){const retained=cache.get(page);if(retained)return retained;if(++reads>300)throw Error('Historical PDF lookup exceeds 300 pages; split the audit by chapter.');const p=await doc.getPage(page),text=await p.getTextContent();if(text.items.length>12000)throw Error('Historical table page exceeds its item limit.');const items=text.items.flatMap(item=>'str'in item?[{text:clean(item.str),x:item.transform[4],y:item.transform[5],width:item.width}]:[]).filter(c=>c.text);cache.set(page,items);return items;}
 function chapter(items:PdfCell[]){const labels=items.filter(c=>/^\d{1,2}\s*-\s*(?:[IVX]+\s*-\s*)?\d+$/.test(c.text)&&(c.x<110||c.x>450)&&c.y>600).map(c=>Number(c.text.match(/^\d+/)![0]));return labels.length===1?labels[0]:null;}
 async function lower(target:number){let lo=1,hi=doc.numPages+1;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(mid>doc.numPages)return mid;const ch=chapter(await cells(mid));if(ch===null){
   // Blank divider pages have no chapter label. Search a bounded neighbour;
   // the resulting range may include dividers, which are never parsed as rows.
   let next:{page:number;chapter:number}|null=null;for(let offset=1;offset<=12&&mid+offset<=doc.numPages;offset++){const n=chapter(await cells(mid+offset));if(n!==null){next={page:mid+offset,chapter:n};break;}}
   if(next){if(next.chapter<target)lo=next.page+1;else hi=mid;continue;}
   if(mid<250){lo=mid+1;continue;}return null;
  }if(ch<target)lo=mid+1;else hi=mid;}return lo;}
 const wanted=new Set(codes),result:ReferenceRate[]=[];
 const cover=(await cells(1)).map(c=>c.text).join(' '),year=release.name.slice(0,4),revision=/Revision\s+(\d+[a-z]?)/i.exec(release.description)?.[1];
 const encodedCover=historicalEncodedCoverIdentity(createHash('sha256').update(bytes).digest('hex'),cover,release);
 if(!encodedCover&&(!cover.includes(`(${year})`)||!cover.includes('Harmonized Tariff Schedule')))return [];
 const exactRevision=revision?new RegExp(`Revision\\s+${revision}(?![\\da-z])`,'i'):null;
 const coverVerified=encodedCover||(exactRevision?exactRevision.test(cover):!/Revision\s+\d/i.test(cover));
 // Some publisher consolidated PDFs retain a Basic Edition cover while
 // individual revised chapters identify the requested edition. Such rows must
 // establish that exact revision themselves; an old header cannot pass.
 if(!coverVerified&&!/Basic Edition/i.test(cover))return [];
 for(const ch of [...new Set(codes.map(c=>Number(c.slice(0,2))))]){
  if(ch<1||ch>97||ch===77)continue;
  let start=await lower(ch),end=await lower(ch===76?78:ch+1);if(start===null||end===null)continue;
  // The bound may land in an unnumbered footnote appendix. Advance to the
  // actual next chapter so those scope/exception references are retained.
  for(let offset=0;offset<12&&start<=doc.numPages&&chapter(await cells(start))!==ch;offset++)start++;
  for(let offset=0;offset<12&&end<=doc.numPages;offset++){const n=chapter(await cells(end));if(n!==null&&n>ch)break;end++;}
  if(end<=start||end-start>250)continue;
  const projected:ReferenceRate[]=[],footnoteMap=new Map<string,string>(),pageFootnotes=new Map<number,Map<string,string>>();
  for(let p=start;p<end;p++){
   const items=await cells(p);
   const local=new Map<string,string>();pageFootnotes.set(p,local);
   for(const cell of items){const match=/^(\d+)\/\s+(.+)$/.exec(cell.text);if(match){for(const map of [local,footnoteMap]){const prior=map.get(match[1]);if(prior&&prior!==match[2])map.set(match[1],'UNRESOLVED conflicting footnote definitions');else map.set(match[1],match[2]);}}}
   if(chapter(items)!==ch)continue;
   // Unchanged chapters retain an earlier revision in their footer. The full
   // edition identity was verified from its cover, not inferred from that footer.
   const pageText=items.map(c=>c.text).join(' ');if(!pageText.includes(year)||(!coverVerified&&exactRevision&&!exactRevision.test(pageText)))continue;
  }
  const known=new Set([...footnoteMap].filter(([,v])=>!v.startsWith('UNRESOLVED')).map(([k])=>k));
  for(let p=start;p<end;p++){const items=await cells(p);if(chapter(items)!==ch)continue;const pageText=items.map(c=>c.text).join(' ');if(!pageText.includes(year)||(!coverVerified&&exactRevision&&!exactRevision.test(pageText)))continue;projected.push(...ratesOnPdfPage(items,sourceId,wanted,p,false,known));}
  for(const rate of projected){rate.footnotes=rate.footnotes.map(raw=>{const marker=(raw as {marker:string}).marker;return {marker,value:pageFootnotes.get(rate.pdfPage!)?.get(marker)??footnoteMap.get(marker)??`UNRESOLVED PDF footnote ${marker}`};});result.push(rate);}
 }
 // Repeated/ambiguous rows do not select an arbitrary first candidate.
 return result.filter(r=>result.filter(x=>x.hts===r.hts).length===1);
 }finally{await doc.loadingTask.destroy();}
}
