import test from'node:test';import assert from'node:assert/strict';import{ADCVD_PUBLIC_API,adcvdCase,adcvdPublicUrl,adcvdIndex,adcvdHeader,adcvdBody,cbpMessageDate}from'../app/api/tariff/references/adcvd-source';import{officialReferenceUrl}from'../app/api/tariff/references/ingestion';
const row={imn:'123',messageNumber:'5171401',messageDate:'06/20/2025',caseNumber:'A570001',type:'CD-Cash Deposit',status:'Active',publicIndicator:'Y',messageTitle:'SYNTHETIC instruction index'},index={returningLimitedResults:false,totalRecords:1,currentLimit:500,resultData:[row]},header={imn:'123',messageNumber:row.messageNumber,caseNumberList:['A570001'],messageDate:row.messageDate,effectiveDate:'06/16/2025',type:row.type,statusDesc:'Active',statusCode:'AC',accessType:'Public',correctionMessage:false,originalImn:'',inactiveDate:'',frCite:'SYNTHETIC',frDate:'06/16/2025',messageTitle:row.messageTitle};
test('public source URL allowlist admits exact read GET paths and rejects write, private, query and credential variants',()=>{
 for(const path of ['quickSearchMessage-MemorySide/A570001','getMessageHeaderDetails/123','getMsgBody/123']){assert(adcvdPublicUrl(ADCVD_PUBLIC_API+path));assert.equal(officialReferenceUrl(ADCVD_PUBLIC_API+path),ADCVD_PUBLIC_API+path);}
 for(const url of [ADCVD_PUBLIC_API+'updateMessage',ADCVD_PUBLIC_API+'getMsgBody/123?access=private',ADCVD_PUBLIC_API+'getMsgBody/123#x',ADCVD_PUBLIC_API.replace('/public/','/private/')+'getMsgBody/123',ADCVD_PUBLIC_API.replace('https://','http://')+'getMsgBody/123',ADCVD_PUBLIC_API.replace('https://','https://user:secret@')+'getMsgBody/123',ADCVD_PUBLIC_API.replace('trade.cbp.dhs.gov','other.example')+'getMsgBody/123']){assert.equal(adcvdPublicUrl(url),false);assert.throws(()=>officialReferenceUrl(url));}
});
test('case identity and legal dates remain exact; no HTS-to-case inference or date fabrication',()=>{
 assert.equal(adcvdCase('a-570-001'),'A570001');assert.equal(adcvdCase('C-570-001-123'),'C570001123');for(const invalid of ['570001','B-570-001','A-570-*','A-570-001/x'])assert.throws(()=>adcvdCase(invalid));assert.equal(cbpMessageDate('02/29/2024'),'2024-02-29');assert.equal(cbpMessageDate('02/29/2025'),null);assert.equal(cbpMessageDate('2025-06-16'),null);
});
test('bounded complete public index rejects truncation, missing/duplicate rows, foreign cases and private disclosure',()=>{
 assert.equal(adcvdIndex(index,'A-570-001').rows.length,1);
 for(const invalid of [{...index,returningLimitedResults:true},{...index,totalRecords:2},{...index,totalRecords:501},{...index,resultData:[row,row],totalRecords:2},{...index,resultData:[{...row,caseNumber:'A570999'}]},{...index,resultData:[{...row,publicIndicator:'N'}]},{...index,resultData:[{...row,messageDate:'02/30/2025'}]}])assert.throws(()=>adcvdIndex(invalid,'A-570-001'));
});
test('instruction original must match the case index and header; publication and effective dates stay distinct',()=>{
 const h=adcvdHeader(header,row,'A-570-001');assert.equal(cbpMessageDate(h.effectiveDate),'2025-06-16');assert.equal(cbpMessageDate(h.messageDate),'2025-06-20');
 for(const invalid of [{...header,accessType:'Private'},{...header,imn:'124'},{...header,messageNumber:'0000000'},{...header,effectiveDate:'02/30/2025'},{...header,statusDesc:'Inactive'},{...header,caseNumberList:['A570999']}])assert.throws(()=>adcvdHeader(invalid,row,'A-570-001'));
 assert.equal(adcvdBody({text:'SYNTHETIC body'}),'SYNTHETIC body');assert.throws(()=>adcvdBody({text:''}));assert.throws(()=>adcvdBody({text:'x'.repeat(500001)}));
});
