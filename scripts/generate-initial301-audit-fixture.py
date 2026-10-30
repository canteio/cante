"""Fictional declarations and Decimal goldens; separately retained real rules.
No legal origin, classification, transit qualification or refund is approved."""
import csv,json
from pathlib import Path
from decimal import Decimal,ROUND_HALF_UP
from datetime import date,timedelta
root=Path(__file__).parent/'test-fixtures/historical-audits'
profiles=[('2018-10-15','9401614011','10'),('2018-10-15','9401614001','0'),('2019-04-15','9401614011','10'),('2019-04-15','9401614001','0'),('2019-06-15','9401614011','25'),('2019-06-15','9401614001','0')]
headers=['entry_number','entry_line','sku','description','entry_date','hts','origin','customs_value','total_duty_paid','currency','entry_type','document_references','evidence_hts','evidence_origin','adcvd_cases','exporter','duty_stage','preference','exclusion']
def money(v):return str(v.quantize(Decimal('.01'),rounding=ROUND_HALF_UP))
rows=[];gold=[];decisions=[];under=over=0
for i in range(1,101):
 day,hts,rate=profiles[(i-1)%6];value=Decimal('1000.50')+Decimal(i-1)/100;expected=money(value*Decimal(rate)/100)
 delta=-1 if i<=81 and rate!='0' and under<27 else 1 if i<=81 and rate=='0' and over<27 else 0
 if delta<0:under+=1
 if delta>0:over+=1
 row={k:'' for k in headers};row.update(entry_number=f'SYN-INITIAL301-{i}',entry_line='001',sku=f'SYN-INITIAL301-SKU-{i}',description='FICTIONAL seats with separately reviewed classification and shipping evidence',entry_date=day,hts=hts,origin='CN',customs_value=str(value),total_duty_paid=money(Decimal(expected)+delta),currency='USD',entry_type='01',document_references=f'SYN-INITIAL301-{i}-DOC')
 needs_transit=day=='2019-06-15' and rate!='0'
 if needs_transit and i<=81:decisions.append(dict(row=i,kind='confirm_facts',validFrom=day,validBefore=str(date.fromisoformat(day)+timedelta(days=1)),facts=dict(section301_transit_clear=True),evidence=[f'SYN-INITIAL301-{i}-SHIPPING'],note='FICTIONAL dated shipping evidence establishes that no reduced 2019 in-transit treatment applies.'))
 if i==82:row['hts']=''
 if i==83:row['entry_date']=''
 if i==84:row['hts']='9401619999'
 if i==85:
  row.update(entry_date='2019-06-15',hts='9401614001',evidence_hts='9401614011',total_duty_paid=money(Decimal(money(value*Decimal('.25')))+1))
 if i==86:row['evidence_origin']='VN'
 if i==87:row['customs_value']=''
 if i==88:row['total_duty_paid']=''
 if i==89:row['currency']='EUR'
 if i==90:row.update(adcvd_cases='A-570-999-001',duty_stage='cash_deposit',entry_type='03')
 if i==91:row['preference']='S'
 if i==92:row['entry_type']='21'
 if i==93:row['exclusion']='9903.88.69'
 if i==94:row['origin']=''
 if i==95:row['entry_line']=''
 if i==96:row['sku']=''
 if i==97:row.update(entry_date='2018-10-15',hts='9403708031')
 if i==98:row.update(entry_date='2019-05-10',hts='9401614011')
 if i==99:row.update(entry_date='2019-06-15',hts='9401614011')
 if i==100:row['hts']='9401614999'
 normal=i<=81;initial=expected if normal and not needs_transit else None;old=expected if normal and day!='2019-06-15' and rate!='0' else None
 gold.append(dict(row=i,oldExpected=old,oldDifference=money(Decimal(delta)) if old is not None else None,initialExpected=initial,initialDifference=money(Decimal(delta)) if initial is not None else None,reviewedExpected=expected if normal else None,reviewedDifference=money(Decimal(delta)) if normal else None,additional301=expected if normal else None))
 rows.append(row)
def summary(key):
 resolved=[r for r in gold if r[key+'Expected'] is not None];diffs=[Decimal(r[key+'Difference']) for r in resolved];return dict(lines=100,calculated=len(resolved),unresolved=100-len(resolved),discrepancies=sum(d!=0 for d in diffs),overpayment=money(sum((d for d in diffs if d>0),Decimal(0))),underpayment=money(sum((-d for d in diffs if d<0),Decimal(0))))
expected=dict(label='100 fictional entries; actual dated publication evidence is separate from explicit synthetic qualifications. Independent Decimal monetary oracle; no customer savings or legal approval claimed.',engineVersion='historical-audit-v37',rows=gold,decisions=decisions,oldSummary=summary('old'),summary=summary('initial'),reviewedSummary=summary('reviewed'),browserDecision=dict(row=85,kind='confirm_facts',hts='9401614011',facts=dict(classification_verified=True,section301_transit_clear=True),validFrom='2019-06-15',validBefore='2019-06-16',evidence=['SYN-INITIAL301-85-CLASSIFICATION','SYN-INITIAL301-85-SHIPPING'],note='FICTIONAL dated specifications establish other upholstered wooden seats rather than the declared chairs for children. Shipping records establish no reduced 2019 transit treatment. The original declaration remains unchanged.',expected=money(Decimal(rows[84]['customs_value'])*Decimal('.25')),difference='1.00'))
assert under==over==27 and expected['reviewedSummary']['calculated']==81
with(root/'initial301-workflow-entries.csv').open('w',newline='')as f:w=csv.DictWriter(f,fieldnames=headers);w.writeheader();w.writerows(rows)
(root/'initial301-workflow-expected.json').write_text(json.dumps(expected,indent=2)+'\n')
print(json.dumps({k:expected[k] for k in ['oldSummary','summary','reviewedSummary']}))
