"""Explicitly fictional declarations; independent Decimal per-component oracle.
Official input rates must be checked against the separately retained CBP originals.
No company qualification or legal scope is established by this fixture."""
import csv,json
from decimal import Decimal,ROUND_HALF_UP
from pathlib import Path
root=Path(__file__).parent/'test-fixtures/historical-audits'
headers=['entry_number','entry_line','entry_date','sku','description','hts','origin','customs_value','total_duty_paid','entry_type','adcvd_cases','exporter','manufacturer','duty_stage','document_references','preference']
facts=dict(standard_commercial=True,classification_verified=True,adcvd_scope_verified=True,adcvd_party_verified=True,adcvd_instructions_clear=True,adcvd_cases_complete=True,border_exceptions_clear=True,reciprocal_exceptions_clear=True,usmca_qualified=False)
def money(v):return str(v.quantize(Decimal('.01'),rounding=ROUND_HALF_UP))
rows=[];expected=[];decisions=[]
for i in range(1,101):
 profile=(i-1)%3;value=Decimal('1000.50')+Decimal(i-1)/100
 cases,exporter,manufacturer= [('A-122-857-001;C-122-858-001','Canfor Corporation',''),('C-122-858-357','FICTIONAL REVIEWED OTHER EXPORTER','Fontaine Inc.'),('C-122-858-358','Fontaine Inc.','FICTIONAL REVIEWED OTHER PRODUCER')][profile]
 rates=['35.47','12.12'] if profile==0 else ['14.63']
 components=[money(value*Decimal(r)/100) for r in rates+['35']]
 total=money(sum(map(Decimal,components)))
 diff=['1.00','-1.00','0.00'][(i-1)%3]
 paid=money(Decimal(total)+Decimal(diff))
 row=dict(zip(headers,[f'SYN-CADEP-{i}','001','2025-09-15',f'SYN-CADEP-SKU-{i}','FICTIONAL declared softwood with reviewed company conditions','4407110001','CA',str(value),paid,'03',cases,exporter,manufacturer,'cash_deposit',f'SYN-CADEP-{i}-DOC','']))
 fs=dict(facts)
 if i==82:row.update(adcvd_cases='C-122-858-357',exporter='FICTIONAL REVIEWED OTHER EXPORTER',manufacturer='')
 if i==83:row.update(adcvd_cases='C-122-858-357',exporter='FICTIONAL REVIEWED OTHER EXPORTER',manufacturer='FICTIONAL WRONG PRODUCER')
 if i==84:row.update(adcvd_cases='C-122-858-357',exporter='Fontaine Inc.',manufacturer='Fontaine Inc.')
 if i==85:row.update(adcvd_cases='A-122-857-001;C-122-858-001',exporter='',manufacturer='')
 if i==86:row['adcvd_cases']='A-122-857'
 if i==87:row['adcvd_cases']='A-122-857-999'
 if i==88:row['exporter']='FICTIONAL WRONG EXPORTER'
 if i==89:row['duty_stage']='final_assessment'
 if i==90:row['duty_stage']=''
 if i==91:row['origin']='CN'
 if i==92:fs['adcvd_scope_verified']=False
 if i==93:fs['adcvd_instructions_clear']=False
 if i==94:fs['adcvd_party_verified']=False
 if i==95:fs['adcvd_cases_complete']=False
 if i==96:row['preference']='S'
 if i==97:row['entry_type']='21'
 if i==98:row['customs_value']=''
 if i==99:row['hts']=''
 if i==100:row.update(adcvd_cases='C-122-858-357',manufacturer='unknown',exporter='FICTIONAL REVIEWED OTHER EXPORTER')
 rows.append(row)
 expected.append(dict(row=i,entry=row['entry_number'],initialExpected=None,initialDifference=None,reviewedExpected=total if i<=81 else None,reviewedDifference=diff if i<=81 else None,componentAmounts=components if i<=81 else []))
 decisions.append(dict(row=i,kind='confirm_facts',validFrom='2025-09-15',validBefore='2025-09-16',facts=fs,evidence=[f'SYN-CADEP-{i}-REVIEW'],note='FICTIONAL functionality evidence only; no real classification, origin, company scope, court review or refund eligibility established.'))
with (root/'canada-deposit-workflow-entries.csv').open('w',newline='') as f:
 w=csv.DictWriter(f,fieldnames=headers);w.writeheader();w.writerows(rows)
v=Decimal(rows[84]['customs_value']);browserTotal=money(sum(Decimal(money(v*Decimal(r)/100)) for r in ['35.47','12.12','35']))
gold=dict(label='100 fictional entries; independent Decimal half-up oracle; actual public CBP rates, fictional scope/party evidence, no legal approval.',engineVersion='historical-audit-v37',rows=expected,decisions=decisions,summary=dict(lines=100,calculated=0,unresolved=100,discrepancies=0,overpayment='0.00',underpayment='0.00'),reviewedSummary=dict(lines=100,calculated=81,unresolved=19,discrepancies=54,overpayment='27.00',underpayment='27.00'),browserDecision=dict(row=85,kind='confirm_facts',validFrom='2025-09-15',validBefore='2025-09-16',shipment=dict(exporter='Canfor Corporation'),facts={k:True for k in ['adcvd_party_verified','adcvd_instructions_clear','adcvd_cases_complete']},evidence=['SYN-CADEP-85-EXPORTER-REVIEW'],note='FICTIONAL evidence supplies the missing exporter and renews dated party, instruction and complete-case checks. No shared law or refund entitlement is approved.',usedExporter='Canfor Corporation',expected=browserTotal))
(root/'canada-deposit-workflow-expected.json').write_text(json.dumps(gold,indent=2)+'\n')
