import {getDocumentProxy} from 'unpdf';
import type {PdfCell} from './pdf-rates';
import type {ReferenceRate} from './store';
const clean=(s:string)=>s.replace(/\s+/g,' ').trim();
const table=(cells:PdfCell[])=>cells.some(c=>c.text==='General'&&c.x>=380&&c.x<440)&&cells.some(c=>c.text==='Special'&&c.x>=445&&c.x<520)&&cells.some(c=>c.text==='Rates of Duty');
/** Read the actual General column, never the first percentage in flattened PDF
 * text (which may belong to Special or Column 2). Unknown/split rows stay absent. */
export function chapter99Rows(cells:PdfCell[],sourceId:string,page:number):ReferenceRate[]{
 if(!table(cells))return [];
 const rows=cells.filter(c=>c.x>=40&&c.x<90&&/^9903\.\d{2}\.\d{2}$/.test(c.text)).sort((a,b)=>b.y-a.y);
 return rows.flatMap((row,i)=>{
  const band=cells.filter(c=>c.y<=row.y+1&&c.y>(rows[i+1]?.y??85)+1);
  const join=(from:number,before:number)=>clean(band.filter(c=>c.x>=from&&c.x<before&&!/^\d+\/(?:\d+\/)*$/.test(c.text)).sort((a,b)=>b.y-a.y||a.x-b.x).map(c=>c.text).join(' '));
  const general=join(380,444),description=join(110,336).replace(/\.{2,}/g,'').trim();
  if(!description||!general||general.length>1000)return [];
  return [{source_id:sourceId,hts:row.text.replaceAll('.',''),description,general,special:join(445,523),column2:join(523,610),additional_duties:'',units:[],footnotes:[],pdfPage:page,projection:'official-chapter99-pdf-v1'}];
 });
}
/** Request-local projection only: never publishes a partial Chapter 99 as a
 * complete HTS edition. Original hashes, edition identity and pages stay pinned. */
export async function historicalChapter99Rows(bytes:Buffer,sourceId:string):Promise<ReferenceRate[]>{
 if(bytes.length>25000000||bytes.subarray(0,5).toString()!=='%PDF-')throw Error('Invalid historical Chapter 99 original.');
 const doc=await getDocumentProxy(new Uint8Array(bytes));if(doc.numPages>700)throw Error('Historical Chapter 99 exceeds its page budget.');
 const cache=new Map<number,PdfCell[]>();let reads=0;
 const cells=async(p:number)=>{if(cache.has(p))return cache.get(p)!;if(++reads>250)throw Error('Historical Chapter 99 table exceeds its 250-page budget.');const content=await(await doc.getPage(p)).getTextContent();if(content.items.length>12000)throw Error('Chapter 99 page exceeds its item budget.');const items=content.items.flatMap(i=>'str'in i?[{text:clean(i.str),x:i.transform[4],y:i.transform[5]}]:[]).filter(c=>c.text);cache.set(p,items);return items;};
 let lower=1,upper=0;
 for(const p of [...new Set([1,25,50,100,200,400,doc.numPages].filter(p=>p<=doc.numPages))].sort((a,b)=>a-b)){if(table(await cells(p))){upper=p;break;}lower=p;}
 if(!upper)return [];
 while(lower+1<upper){const mid=Math.floor((lower+upper)/2);if(table(await cells(mid)))upper=mid;else lower=mid;}
 const result:ReferenceRate[]=[];for(let p=upper;p<=doc.numPages;p++){result.push(...chapter99Rows(await cells(p),sourceId,p));if(result.length>3000)throw Error('Historical Chapter 99 rows exceed their bounded limit.');}
 // Ambiguity never selects an arbitrary duplicate.
 const counts=new Map<string,number>();for(const r of result)counts.set(r.hts,(counts.get(r.hts)??0)+1);
 return result.filter(r=>counts.get(r.hts)===1);
}
