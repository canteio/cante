import {isStrictIsoDate} from '@/lib/tariff/date';
import {officialReferenceUrl} from './ingestion';
export function federalTariffSearch(year:number,page=1){
 if(!Number.isInteger(year)||year<1994||year>2100||!Number.isInteger(page)||page<1||page>10)throw Error('Official document search exceeds its bounds.');
 const url=new URL('https://www.federalregister.gov/api/v1/documents.json');url.searchParams.set('conditions[term]','tariff');url.searchParams.set('conditions[publication_date][gte]',`${year}-01-01`);url.searchParams.set('conditions[publication_date][lte]',`${year}-12-31`);for(const agency of ['executive-office-of-the-president','industry-and-security-bureau','u-s-customs-and-border-protection','trade-representative-office-of-united-states'])url.searchParams.append('conditions[agencies][]',agency);url.searchParams.set('per_page','100');url.searchParams.set('page',String(page));url.searchParams.set('order','oldest');return url.toString();
}
/** Search hits are discovery leads. In particular, publication/effective_on
 * metadata is never promoted into an approved rule or applied tariff interval. */
export function federalTariffPage(raw:unknown,year:number){
 const data=raw as {count?:unknown;total_pages?:unknown;results?:unknown};if(!data||!Number.isInteger(data.count)||Number(data.count)<0||!Number.isInteger(data.total_pages)||Number(data.total_pages)<0||!Array.isArray(data.results)||data.results.length>100)throw Error('Invalid Federal Register response.');
 const documents=data.results.map(item=>{if(!item||typeof item.document_number!=='string'||!/^[A-Za-z0-9-]{5,30}$/.test(item.document_number)||typeof item.title!=='string'||!isStrictIsoDate(item.publication_date)||Number(item.publication_date.slice(0,4))!==year||typeof item.pdf_url!=='string')throw Error('Invalid Federal Register document identity.');const url=new URL(officialReferenceUrl(item.pdf_url));if(url.hostname!=='www.govinfo.gov'||!url.pathname.endsWith('.pdf'))throw Error('Use the publisher-linked official GovInfo PDF.');return {documentNumber:item.document_number,title:item.title.slice(0,300),publicationDate:item.publication_date,effectiveOn:isStrictIsoDate(item.effective_on)?item.effective_on:null,url:url.toString(),htmlUrl:typeof item.html_url==='string'?officialReferenceUrl(item.html_url):null};});
 return {count:Number(data.count),pages:Number(data.total_pages),documents};
}
export function federalXmlAlternative(raw:unknown,documentNumber:string){
 const meta=raw as {document_number?:unknown;full_text_xml_url?:unknown};if(!meta||meta.document_number!==documentNumber||typeof meta.full_text_xml_url!=='string')throw Error('Document XML identity missing.');const url=new URL(officialReferenceUrl(meta.full_text_xml_url));if(url.hostname!=='www.federalregister.gov'||!url.pathname.endsWith('/'+documentNumber+'.xml'))throw Error('Unexpected document XML rendition.');return url.toString();
}
