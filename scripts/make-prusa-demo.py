"""User-requested estimates for calculator testing. Never customer customs evidence."""
import csv,json
from decimal import Decimal
from pathlib import Path
base=Path(__file__).resolve().parents[1]
source=base/'scripts/test-fixtures/prusa-public/catalogue-products.csv'
with source.open() as f: products=list(csv.DictReader(f))
printer_names=['Prusa CORE One L+','Prusa CORE One+ (Gen 2)','Original Prusa MK4S 3D Printer','Original Prusa MINI+ Semi-assembled 3D Printer - Enclosure Bundle','Prusa Pro HT90','Original Prusa i3 MK3S+ 10th Anniversary Edition 3D printer']
printers=[next(p for p in products if p['name']==name) for name in printer_names]
filaments=[p for p in products if p['name'].startswith(('Prusament PLA ','Prusament PETG ')) and Decimal('15')<Decimal(p['retail_reference_price'])<Decimal('65') and not any(s in p['name'].lower() for s in ['pack','bundle','discontinued','sample','carbon','magnetite'])][:14]
assert len(filaments)==14
rows=[]
for i,p in enumerate(printers+filaments,1):
 printer=i<=len(printers)
 price=Decimal(p['retail_reference_price']);assert p['retail_currency']=='USD'
 code='8485.20.00.00' if printer else '3916.90.30.00'
 rows.append({'sku':f'DEMO-PRUSA-{i:02d}','name':'DEMO ESTIMATE — '+p['name'],'hts_code':code,'country_of_origin':'CZ','import_date':'2026-10-11','value':str((price*10).quantize(Decimal('0.01'))),'quantity':10 if printer else 3000,'unit':'No.' if printer else 'm','retail_unit_price_from_source':str(price),'estimated_shipment_units':10,'classification_status':'ESTIMATED_NOT_REVIEWED','origin_status':'ASSUMED_FOR_TEST_ONLY','value_status':'RETAIL_PRICE_X_10_TEST_PROXY_NOT_ACTUAL_CUSTOMS_VALUE','quantity_status':'ASSUMED_TEST_QUANTITY','scenario_note':'SYNTHETIC DEMO: real public product name/retail price; estimated HTS; assumed Czech origin, date and shipment quantity/value. No actual entry or duty-paid evidence.','source_url':p['source_url'],'source_retrieved_at':p['retrieved_at'],'hts_schedule_source':f'https://hts.usitc.gov/reststop/search?keyword={code}'})
assert len(rows)==20
for target in [base/'testsomething.csv',base/'scripts/test-fixtures/prusa-public/testsomething.csv']:
 with target.open('w',newline='',encoding='utf-8') as f:
  writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
print(json.dumps({'file':str(base/'testsomething.csv'),'rows':len(rows),'printers':len(printers),'filament_products':len(filaments),'all_rows_explicitly_synthetic':True,'tenant_writes':0},indent=2))
