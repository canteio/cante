import {getDocumentProxy} from 'unpdf';
import {isStrictIsoDate} from '@/lib/tariff/date';

export const SECTION301_CHART_URL='https://content.govdelivery.com/attachments/USDHSCBP/2025/08/29/file_attachments/3372134/Section%20301%20Tranches%20and%20Rounds%20chart%2008282025.pdf';
export type ChartCell={text:string;x:number;y:number};
export type ExclusionWindow={heading:string;part:string;from:string;before:string;sourceIds:string[];publication:string};
function iso(s:string){const m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);if(!m)return null;const d=`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;return isStrictIsoDate(d)?d:null;}

/** CBP's implementation chart supplies initial windows, not blanket extensions.
 * Same-heading extensions can cover only some product definitions: their later
 * dates are deliberately not substituted for the initial whole-heading window. */
export function chartWindows(pages:ChartCell[][],sourceId:string):ExclusionWindow[]{
 const windows=new Map<string,ExclusionWindow>();
 for(const cells of pages){
  const codes=cells.filter(c=>/^9903\.88\.\d{2}$/.test(c.text)&&c.x>420&&c.x<510).sort((a,b)=>b.y-a.y);
  for(const code of codes){
   if(windows.has(code.text))continue;
   const note=cells.filter(c=>c.x>520&&c.x<595&&Math.abs(c.y-code.y)<17&&/^20\([a-z]+\)(?:\([iv]+\))?$/.test(c.text)).sort((a,b)=>Math.abs(a.y-code.y)-Math.abs(b.y-code.y))[0];
   const expiry=cells.filter(c=>c.x>=595&&c.x<670&&Math.abs(c.y-code.y)<9&&iso(c.text)).sort((a,b)=>Math.abs(a.y-code.y)-Math.abs(b.y-code.y))[0];
   const publication=cells.filter(c=>c.x>=270&&c.x<340&&Math.abs(c.y-code.y)<9&&iso(c.text)).sort((a,b)=>Math.abs(a.y-code.y)-Math.abs(b.y-code.y))[0];
   const start=cells.filter(c=>c.x>=345&&c.x<425&&c.y<=code.y+9&&c.y>=code.y-30&&iso(c.text)).sort((a,b)=>Math.abs(a.y-code.y)-Math.abs(b.y-code.y))[0];
   if(!note||!expiry||!publication||!start)continue;
   const from=iso(start.text)!,before=iso(expiry.text)!,published=iso(publication.text)!;
   if(from>=before||published>before)continue;
   windows.set(code.text,{heading:code.text,part:/^20\(([a-z]+)\)/.exec(note.text)![1],from,before,sourceIds:[sourceId],publication:published});
  }
 }
 return [...windows.values()];
}
export async function readSection301Chart(bytes:Buffer,sourceId:string){
 if(bytes.length>3000000||!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('Invalid CBP chart original.');
 const doc=await getDocumentProxy(new Uint8Array(bytes));if(doc.numPages>12)throw Error('CBP chart exceeds its page budget.');
 const pages:ChartCell[][]=[];let title='';
 for(let page=1;page<=doc.numPages;page++){const content=await(await doc.getPage(page)).getTextContent();if(content.items.length>12000)throw Error('CBP chart page exceeds its item budget.');const cells=content.items.flatMap(i=>'str'in i?[{text:i.str.replace(/\s+/g,' ').trim(),x:i.transform[4],y:i.transform[5]}]:[]).filter(c=>c.text);pages.push(cells);if(page===1)title=cells.map(c=>c.text).join(' ');}
 if(!title.includes('SUMMARY OF SECTION 301 DUTIES ON PRODUCTS OF CHINA'))throw Error('CBP chart identity changed.');
 const windows=chartWindows(pages,sourceId);
 if(windows.length<35||!windows.some(w=>w.heading==='9903.88.05'&&w.part==='h'&&w.from==='2018-07-06'))throw Error('CBP chart layout/initial windows need verification.');
 return windows;
}
