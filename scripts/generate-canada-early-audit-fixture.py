"""Fictional entries and qualifications; independent Decimal monetary oracle.
Rates must separately match the retained CBP originals, never this fixture alone.
"""
import csv,json
from decimal import Decimal,ROUND_HALF_UP
from pathlib import Path
from datetime import date,timedelta
root=Path(__file__).parent/'test-fixtures/historical-audits'
profiles=[('2021-01-15','C-122-858-125','Independent Building Materials Dist.','7.42','0336411','2020-12-01'),('2021-12-02','C-122-858-282','Carter Forest Products Inc','6.31','2032411','2021-12-02'),('2022-01-09','C-122-858-282','Carter Forest Products Inc','6.31','2032411','2021-12-02'),('2022-01-10','C-122-858-282','Carter Forest Products Inc','6.32','2032411','2022-01-10'),('2023-08-01','A-122-857-001','Canfor Corporation','5.25','3220409','2023-08-01'),('2023-08-01','A-122-857-004','West Fraser Mills Ltd.','7.06','3257413','2023-08-01')]
facts=dict(standard_commercial=True,classification_verified=True,adcvd_scope_verified=True,adcvd_party_verified=True,adcvd_instructions_clear=True,adcvd_cases_complete=True)
headers=['entry_number','entry_line','entry_date','sku','description','hts','origin','customs_value','total_duty_paid','entry_type','adcvd_cases','exporter','duty_stage','document_references']
rows=[];gold=[];decisions=[]
def money(n):return str(n.quantize(Decimal('.01'),rounding=ROUND_HALF_UP))
for i in range(1,101):
 d,case,exporter,rate,message,effective=profiles[(i-1)%6] if i<=90 else profiles[3]
 value=Decimal('1000.50')+Decimal(i-1)/100
 expected=money(value*Decimal(rate)/100);difference=['0.00','1.00','-1.00'][((i-1)//6)%3]
 row=dict(zip(headers,[f'SYN-CAEARLY-{i}','001',d,f'SYN-CAEARLY-SKU-{i}','FICTIONAL dated softwood cash-deposit entry; qualifications require separate evidence','4407110001','CA',str(value),money(Decimal(expected)+Decimal(difference)),'03',case,exporter,'cash_deposit',f'SYN-CAEARLY-{i}-DOC']))
 fs=dict(facts)
 if i==91:row['adcvd_cases']='C-122-858'
 if i==92:row['exporter']=''
 if i==93:row['exporter']='FICTIONAL WRONG EXPORTER'
 if i==94:row['duty_stage']='final_assessment'
 if i==95:fs['adcvd_scope_verified']=False
 if i==96:row['entry_date']='2021-12-01'
 if i==97:row['hts']=''
 if i==98:row['customs_value']=''
 if i==99:row['entry_type']='21'
 if i==100:row['adcvd_cases']='C-122-858-999'
 rows.append(row);gold.append(dict(row=i,expected=expected if i<=90 else None,difference=difference if i<=90 else None,rate=rate+'%' if i<=90 else None,message=message if i<=90 else None,effective=effective if i<=90 else None))
 decisions.append(dict(row=i,kind='confirm_facts',validFrom=row['entry_date'],validBefore=str(date.fromisoformat(row['entry_date'])+timedelta(days=1)),facts=fs,evidence=[f'SYN-CAEARLY-{i}-QUALIFICATION'],note='FICTIONAL qualification decision for deterministic functionality testing; no actual company scope, party qualification or refund entitlement established.'))
with(root/'canada-early-workflow-entries.csv').open('w')as f:
 w=csv.DictWriter(f,fieldnames=headers);w.writeheader();w.writerows(rows)
(root/'canada-early-workflow-expected.json').write_text(json.dumps(dict(label='Fictional shipments, independent Decimal amounts; official evidence and human qualification remain separate.',engineVersion='historical-audit-v38',rows=gold,decisions=decisions,summary=dict(lines=100,calculated=90,unresolved=10,discrepancies=60,overpayment='30.00',underpayment='30.00')),indent=2)+'\n')
