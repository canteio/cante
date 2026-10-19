#!/usr/bin/env python3
"""Extract explicitly labelled BOM parts/supplier fields; never classify goods."""
import csv,json,re,collections,hashlib
from pathlib import Path
BASE=Path(__file__).resolve().parents[1];OUT=BASE/'scripts/test-fixtures/lulzbot-public-research'
def norm(value):return re.sub('[^a-z0-9]','',value.lower())
def write(name,rows,fields):
 with (OUT/name).open('w',newline='',encoding='utf8') as f:
  w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');w.writeheader()
  for row in rows:
   w.writerow({k:("'"+v if isinstance(v,str) and re.match(r'^[=+@\-\t\r]',v) else v) for k,v in row.items()})
headers={};parts=[];links=[];potential_customs=[];origin_notes=[]
for line in (BASE/'raw/lulzbot-public-research/bom-source-rows.jsonl').open():
 r=json.loads(line);cells=r['cells'];key=(r['source_url'],r['sheet']); labels=[norm(c.strip()) for c in cells]
 if any(re.search(r'\b(?:hts|hs.?code|harmonized|customs|country.of.origin|tariff.code)\b',c,re.I) for c in cells):
  potential_customs.append({'source_url':r['source_url'],'sheet':r['sheet'],'source_row':r['source_row'],'cells':cells})
 own = next((labels.index(k) for k in ('productreference','aopart','aopartnumber','defaultcode','sku') if k in labels),None)
 name = next((labels.index(k) for k in ('productname','description','item') if k in labels),None)
 if own is None and 'partnumber' in labels and 'vendorpartnumber' in labels:own=labels.index('partnumber')
 seller_header=any('sellerids' in k for k in labels)
 if own is not None and (name is not None or seller_header):
  headers[key]={'labels':labels,'own':own,'name':name,'supplier_only':seller_header};continue
 for cell in cells:
  if re.search(r'Country of Origin\s*[–—-]\s*Germany',cell,re.I):
   origin_notes.append({'source_url':r['source_url'],'sheet':r['sheet'],'source_row':r['source_row'],'reported_note':cell,'evidence_kind':'historic engineering/purchasing note; NOT verified entry origin'})
 h=headers.get(key)
 if not h:continue
 def pick(*aliases):
  for alias in aliases:
   if alias in h['labels']:
    i=h['labels'].index(alias)
    if i<len(cells):return cells[i].strip()
  return ''
 sku=cells[h['own']].strip() if h['own']<len(cells) else ''
 if not sku or norm(sku) in ('aopart','productreference','defaultcode'):continue
 provenance={'source_url':r['source_url'],'source_sha256':r['source_sha256'],'sheet':r['sheet'],'source_row':r['source_row'],'retrieved_at':r['retrieved_at']}
 if h['supplier_only']:
  supplier=pick('selleridsnamename','selleridsname','sellername')
  if supplier:links.append({'sku':sku,'supplier':supplier,'supplier_part_number':pick('selleridsproductcode'),**provenance})
  continue
 description=cells[h['name']].strip() if h['name'] is not None and h['name']<len(cells) else ''
 if not description:continue
 parts.append({'sku':sku,'name':description,'bom_quantity_text':pick('quantity','qtyper','sumquantity','qty','qtyrequired'),'bom_unit':pick('unitofmeasure','uom'),'bom_level':pick('level'),'bom_name':pick('bomname'),'manufacturer':pick('manufacturer'),'manufacturer_part_number':pick('manufacturerref','manufacturerpn','manufacturerpartnumber'),'distributor':pick('distributor','vendor','supplier'),'distributor_part_number':pick('distributorref','distributorsku','vendorpartnumber'),'published_unit_price_text':pick('priceperunit','priceeach'),'published_price_basis':'BOM purchasing price, NOT customs value','hts_code':'','country_of_origin':'','import_date':'','customs_value_usd':'','paid_duty_usd':'',**provenance})
by_sku={}
for part in parts:
 p=by_sku.setdefault(part['sku'],{'names':set(),'sources':set(),'manufacturers':set(),'distributors':set()})
 p['names'].add(part['name']);p['sources'].add(part['source_url'])
 if part['manufacturer']:p['manufacturers'].add(part['manufacturer'])
 if part['distributor']:p['distributors'].add(part['distributor'])
unique=[{'sku':sku,'names_json':json.dumps(sorted(p['names']),ensure_ascii=False),'manufacturers_json':json.dumps(sorted(p['manufacturers']),ensure_ascii=False),'distributors_json':json.dumps(sorted(p['distributors']),ensure_ascii=False),'source_urls_json':json.dumps(sorted(p['sources'])),'hts_code':'','country_of_origin':'','import_date':'','customs_value_usd':'','paid_duty_usd':''} for sku,p in sorted(by_sku.items())]
write('bom-lines.csv',parts,list(parts[0]) if parts else ['sku','name','source_url'])
write('bom-parts.csv',unique,list(unique[0]) if unique else ['sku'])
write('bom-supplier-links.csv',links,list(links[0]) if links else ['sku','supplier','source_url'])
write('historic-origin-notes.csv',origin_notes,list(origin_notes[0]) if origin_notes else ['source_url','reported_note'])
(OUT/'potential-customs-mentions.json').write_text(json.dumps(potential_customs,ensure_ascii=False,indent=2))

# Minimal files for the real calculator intake, split at its 500-row limit.
# They deliberately cannot calculate: no code or origin was invented.
inputs=[]
for sku,p in sorted(by_sku.items()):
 inputs.append({'sku':sku,'name':sorted(p['names'])[0],'hts_code':'','country_of_origin':'','import_date':'','source_url':sorted(p['sources'])[0],'evidence_kind':'public_archived_bom_part; unclassified'})
for offset in range(0,len(inputs),500):write(f'calculator-intake-{offset//500+1:02}.csv',inputs[offset:offset+500],list(inputs[0]))
report=json.loads((OUT/'crawl-report.json').read_text())
manifest=json.loads((OUT/'manifest-source-report.json').read_text())
summary={'products':report['products'],'variants':report['variants'],'bom_files_requested':report['bom_files_selected'],'bom_files_fetched':sum(r['status']==200 for r in json.loads((OUT/'bom-sources.json').read_text())),'unique_workbooks_extracted':report['unique_workbooks_extracted'],'raw_bom_source_rows':report['bom_nonempty_source_rows'],'normalized_bom_lines':len(parts),'distinct_published_part_identifiers':len(unique),'supplier_links':len(links),'public_manifest_rows':manifest['public_rows'],'public_manifest_total_reported':manifest['reported_total_shipments'],'source_customs_mentions':len(potential_customs),'historic_origin_notes':len(origin_notes),'verified_company_hts_codes':0,'verified_company_customs_entries':0,'paid_duty_records':0,'origin_qualification_records':0,'calculator_intake_batches':(len(inputs)+499)//500,'coverage_limits':['Public catalogue pagination completed, not an internal inventory export','Archive crawl covers selected model/production-document paths only, not all internet sources','Historic BOM quantities, prices, vendors and region suffixes are not shipment/entry/origin facts','Visible manifest sample only; paid/private rows were not accessed','Blank customs fields are missing, not zero','Cached formula results in source workbooks were read without recalculation','Sparse cells beyond column 256 remain in raw JSONL separately']}
(OUT/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))
