"""Fictional shipments, explicit qualifications and independent Decimal oracle.
Rates correspond to separately retained public rules, never legal qualification."""
import csv,json,sys
from pathlib import Path
from decimal import Decimal,ROUND_HALF_UP
root=Path(__file__).parent/'test-fixtures/historical-audits'
assert all(a=='--china20g' for a in sys.argv[1:])
china20g='--china20g' in sys.argv
prefix='china20g' if china20g else 'wood'
# country/date/code/wood rate/independent China301/fentanyl/border/AD/CVD/time/cabinet
profiles=[
 ('CA','2025-10-15','4407110001','10','0','0','0','35.47','12.12','',''),
 ('CN','2025-10-15','4407110001','10','25','20','0','0','0','',''),
 ('JP','2025-10-15','9401614011','15','0','0','0','0','0','',''),
 ('DE','2025-10-15','9401614011','15','0','0','0','0','0','',''),
 ('GB','2026-01-15','9401614011','10','0','0','0','0','0','',''),
 ('KR','2026-01-15','9401614011','15','0','0','0','0','0','',''),
 ('TW','2026-08-01','9401614011','15','0','0','0','0','0','',''),
 ('IN','2025-10-15','9401614011','25','0','0','0','0','0','',''),
 ('MX','2025-10-15','9403409060','25','0','0','0','0','0','','true'),
 ('CA','2025-10-15','9403409060','0','0','0','35','0','0','','false'),
 ('CA','2025-10-14','4407110001','0','0','0','35','35.47','12.12','2025-10-14T00:00:59-04:00',''),
 ('CA','2025-10-14','4407110001','10','0','0','0','35.47','12.12','2025-10-14T04:01:00Z',''),
 ('KR','2025-11-14','9401614011','25','0','0','0','0','0','2025-11-14T00:00:59-05:00',''),
 ('KR','2025-11-14','9401614011','15','0','0','0','0','0','2025-11-14T05:01:00Z',''),
 ('TW','2026-05-01','9401614011','25','0','0','0','0','0','2026-05-01T00:00:59-04:00',''),
 ('TW','2026-05-01','9401614011','15','0','0','0','0','0','2026-05-01T04:01:00Z',''),
 ('CA','2026-03-01','4407110001','10','0','0','0','35.47','12.12','',''),
 ('CN','2026-03-01','4407110001','10','25','0','0','0','0','',''),
 ('FR','2026-08-01','9401614031','15','0','0','0','0','0','',''),
 ('JP','2026-03-01','9403409060','15','0','0','0','0','0','','true'),
 ('GB','2025-10-15','9403409060','10','0','0','0','0','0','','true'),
 ('KR','2026-03-01','9403409060','15','0','0','0','0','0','','true'),
 ('TW','2026-08-01','9403409060','15','0','0','0','0','0','','true'),
 ('CA','2026-10-20','4407110001','10','0','0','0','17.00','14.11','',''),
 ('AU','2026-01-15','9401614011','25','0','0','0','0','0','',''),
 ('MX','2026-03-01','4407110001','10','0','0','0','0','0','',''),
 ('DE','2025-10-15','9403409060','0','0','0','15','0','0','','false'),
 ('CA','2025-10-13','4407110001','0','0','0','35','35.47','12.12','',''),
]
if china20g:
 profiles[1]=('CN','2025-10-15','9401614011','25','25','20','0','0','0','','')
 profiles[17]=('CN','2026-03-01','9401614031','25','25','0','0','0','0','','')
headers=['entry_number','entry_line','entry_date','sku','description','hts','origin','customs_value','total_duty_paid','entry_type','adcvd_cases','exporter','duty_stage','entry_timestamp','document_references','preference']
def money(v):return str(v.quantize(Decimal('.01'),rounding=ROUND_HALF_UP))
rows=[];gold=[];decisions=[]
for i in range(1,101):
 p=profiles[(i-1)%len(profiles)];origin,date,hts,wood,china,fentanyl,border,ad,cv,time,cabinet=p
 value=Decimal('1000.50')+Decimal(i-1)/100
 amounts={k:money(value*Decimal(v)/100) for k,v in zip(['wood','china301','fentanyl','border','ad','cv'],[wood,china,fentanyl,border,ad,cv])}
 
 if origin=='DE' and cabinet=='false':amounts['reciprocal']=amounts['border'];amounts['border']='0.00'
 total=money(sum(Decimal(v) for v in amounts.values()));diff=['1.00','-1.00','0.00'][(i-1)%3]
 row=dict(zip(headers,[f'SYN-WOOD-{i}','001',date,f'SYN-WOOD-SKU-{i}','FICTIONAL declared wood product with reviewed qualifications',hts,origin,str(value),money(Decimal(total)+Decimal(diff)),'03' if Decimal(ad) else '01','A-122-857-001;C-122-858-001' if Decimal(ad) else '', 'Canfor Corporation' if Decimal(ad) else '', 'cash_deposit' if Decimal(ad) else '',time,f'SYN-WOOD-{i}-DOC','']))
 facts=dict(classification_verified=True,wood_scope_verified=True,wood_auto_overlap_clear=True,border_exceptions_clear=True,reciprocal_exceptions_clear=True,section122_exceptions_clear=True,country301_exceptions_clear=True,ieepa_exceptions_clear=True,usmca_qualified=False,adcvd_scope_verified=True,adcvd_party_verified=True,adcvd_instructions_clear=True,adcvd_cases_complete=True)
 if cabinet:facts['wood_cabinet_use']=cabinet=='true'
 if i==82:facts.pop('wood_scope_verified')
 if i==83:facts['wood_auto_overlap_clear']=False
 if i==84:facts['adcvd_scope_verified']=False
 if i==85:
  row.update(entry_date='2025-10-15',hts='9403409060',origin='CA',adcvd_cases='',exporter='',duty_stage='',entry_timestamp='')
  facts.pop('wood_cabinet_use',None)
  corrected=money(value*Decimal('.25'));row['total_duty_paid']=money(Decimal(corrected)+1)
 if i==86:row['entry_timestamp']=''
 if i==87:row['customs_value']=''
 if i==88:row['hts']=''
 if i==89:row['preference']='S'
 if i==90:row['entry_type']='21'
 if i==91:row.update(adcvd_cases='A-122-857-001',exporter='',duty_stage='cash_deposit')
 if i==92:row.update(adcvd_cases='A-122-857-999',exporter='Canfor Corporation',duty_stage='cash_deposit')
 if i==93:row.update(adcvd_cases='A-122-857-001',exporter='Canfor Corporation',duty_stage='final_assessment')
 if i==94:facts.pop('wood_auto_overlap_clear')
 if i==95:row['entry_timestamp']=''
 if i==96:facts['wood_scope_verified']=False
 if i==97:facts['wood_auto_overlap_clear']=False
 if i==98:row['preference']='A'
 if i==99:row['entry_type']='12'
 if i==100:row['hts']='9401619999'
 # Force the missing-time controls onto actual published change days.
 if i in [86,95]:row.update(entry_date='2025-10-14',hts='4407110001',origin='CA',adcvd_cases='',exporter='',duty_stage='')
 rows.append(row)
 gold.append(dict(row=i,entry=row['entry_number'],initialExpected=None,initialDifference=None,reviewedExpected=total if i<=81 else None,reviewedDifference=diff if i<=81 else None,componentAmounts=amounts if i<=81 else {}))
 from datetime import date as day,timedelta
 decisions.append(dict(row=i,kind='confirm_facts',validFrom=row['entry_date'],validBefore=str(day.fromisoformat(row['entry_date'])+timedelta(days=1)),facts=facts,evidence=[f'SYN-WOOD-{i}-REVIEW'],note='FICTIONAL functionality evidence only; no legal classification, origin, scope, agreement qualification or refund entitlement is approved.'))
with (root/(prefix+'-workflow-entries.csv')).open('w',newline='')as f:w=csv.DictWriter(f,fieldnames=headers);w.writeheader();w.writerows(rows)
expected=dict(label='100 fictional declarations; independent Decimal per-component oracle and explicit artificial qualifications. Real dated public rules are separate evidence, not legal approval.',engineVersion='historical-audit-v37',rows=gold,decisions=decisions,summary=dict(lines=100,calculated=0,unresolved=100,discrepancies=0,overpayment='0.00',underpayment='0.00'),reviewedSummary=dict(lines=100,calculated=81,unresolved=19,discrepancies=54,overpayment='27.00',underpayment='27.00'),browserDecision=dict(row=85,kind='confirm_facts',validFrom='2025-10-15',validBefore='2025-10-16',facts=dict(wood_cabinet_use=True),evidence=['SYN-WOOD-85-CABINET-USE'],note='FICTIONAL dated product evidence confirms use as a completed kitchen cabinet; the original declaration and earlier unresolved result stay unchanged.',expected=money(Decimal(rows[84]['customs_value'])*Decimal('.25')),difference='1.00'))
(root/(prefix+'-workflow-expected.json')).write_text(json.dumps(expected,indent=2)+'\n')
