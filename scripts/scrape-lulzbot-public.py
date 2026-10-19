#!/usr/bin/env python3
"""Collect public catalogue/BOM evidence, without inventing customs facts.
Uses bounded, read-only XLSX/ODS extraction with the Python standard library.
No account, paid endpoint, browser challenge, or customer database is used.
"""
import csv, datetime, hashlib, io, json, re, threading, time, urllib.request, urllib.parse, zipfile
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from pathlib import Path
import xml.etree.ElementTree as ET

BASE = Path(__file__).resolve().parents[1]
OUT = BASE / 'scripts/test-fixtures/lulzbot-public-research'
RAW = BASE / 'raw/lulzbot-public-research'
OUT.mkdir(parents=True, exist_ok=True); RAW.mkdir(parents=True, exist_ok=True)
NOW = datetime.datetime.now(datetime.timezone.utc).isoformat()
ALLOWED = {'download.lulzbot.com', 'buy.lulzbot.com', 'ohai.lulzbot.com', 'www.importgenius.com', 'www.volza.com', 'www.importyeti.com'}
LOG = []; LOCK = threading.Lock()
previous = OUT / 'crawl-report.json'
PRIOR_ERRORS = [entry for entry in json.loads(previous.read_text()).get('sources',[]) if entry.get('status') == 'failed'] if previous.exists() else []
CACHE = {entry['url']: entry for entry in json.loads(previous.read_text()).get('sources',[]) if entry.get('status') == 200} if previous.exists() else {}
class HTML(HTMLParser):
    def __init__(self): super().__init__(); self.links=[]; self.text=[]; self.skip=0
    def handle_starttag(self, tag, attrs):
        attrs=dict(attrs)
        if tag in ('script','style'): self.skip+=1
        if tag=='a' and attrs.get('href'): self.links.append(attrs['href'])
    def handle_endtag(self, tag):
        if tag in ('script','style') and self.skip: self.skip-=1
    def handle_data(self, data):
        if not self.skip: self.text.append(data)
def html(data):
    p=HTML();p.feed(data.decode('utf8',errors='replace'));return p

def get(url, cap=5_000_000):
    key=hashlib.sha256(url.encode()).hexdigest(); entry={'url':url,'retrieved_at':NOW}
    try:
        cached = CACHE.get(url)
        if cached and (BASE / cached.get('raw_file','missing')).is_file():
            data = (BASE / cached['raw_file']).read_bytes()
            if len(data) > cap or hashlib.sha256(data).hexdigest() != cached['sha256']: raise ValueError('Captured source failed integrity/size check')
            entry.update(cached); entry['reused_captured_snapshot'] = True
            return data, entry
        if urllib.parse.urlparse(url).hostname not in ALLOWED: raise ValueError('URL outside allowed public hosts')
        request=urllib.request.Request(url,headers={'User-Agent':'CantePublicResearch/1.0 (public product and manifest intake testing)'})
        with urllib.request.urlopen(request,timeout=25) as response:
            if urllib.parse.urlparse(response.url).hostname not in ALLOWED: raise ValueError('Redirect left approved public sources')
            data=response.read(cap+1)
            if len(data)>cap: raise ValueError('Source exceeds bounded download limit')
            entry.update(status=response.status,final_url=response.url,content_type=response.headers.get('Content-Type'),last_modified=response.headers.get('Last-Modified'),bytes=len(data),sha256=hashlib.sha256(data).hexdigest())
        (RAW/(key+'.bin')).write_bytes(data)
        entry['raw_file']=str((RAW/(key+'.bin')).relative_to(BASE));return data,entry
    except Exception as error:
        entry.update(status='failed',error=str(error));return None,entry
    finally:
        with LOCK: LOG.append(entry)
        time.sleep(.12)

def write_csv(name, rows, fields):
    # Values stay true to source; neutralise spreadsheet formula injection.
    with (OUT/name).open('w',newline='',encoding='utf-8') as f:
        writer=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');writer.writeheader()
        for row in rows:
            safe={k: ("'"+v if isinstance(v,str) and re.match(r'^[=+@\-\t\r]',v) else v) for k,v in row.items()}
            writer.writerow(safe)

products=[]; product_sources={}; catalogue_complete=False
for page in range(1,21):
    url=f'https://buy.lulzbot.com/products.json?limit=250&page={page}'
    data,entry=get(url)
    if data is None:break
    payload=json.loads(data)
    batch=payload.get('products')
    if not isinstance(batch,list):raise ValueError('Public catalogue returned an unexpected shape')
    products.extend(batch)
    for item in batch: product_sources[item['id']]={'url':url,'retrieved_at':entry['retrieved_at']}
    print(f'Catalogue page {page}: {len(batch)} products',flush=True)
    if len(batch)<250:catalogue_complete=True;break
if len({p['id'] for p in products})!=len(products):raise ValueError('Catalogue pagination repeated products; do not claim completeness')
(RAW/'catalogue.json').write_text(json.dumps({'retrieved_at':NOW,'pagination_completed':catalogue_complete,'products':products},ensure_ascii=False,indent=2))
variants=[]
for p in products:
    description=' '.join(html((p.get('body_html') or '').encode()).text).strip()
    for v in p.get('variants',[]):
        variants.append({'product_id':p['id'],'variant_id':v['id'],'sku':v.get('sku') or '', 'name':p['title'],'variant':v.get('title') or '', 'vendor':p.get('vendor') or '', 'product_type':p.get('product_type') or '', 'description':description,'retail_price':v.get('price'),'listed_weight_grams':v.get('grams'),'available':v.get('available'),'published_at':p.get('published_at'),'source_url':f"https://buy.lulzbot.com/products/{p['handle']}",'retrieved_at':product_sources[p['id']]['retrieved_at'],'captured_from_url':product_sources[p['id']]['url'],'hts_code':v.get('harmonized_system_code') or '', 'country_of_origin':v.get('country_of_origin') or '', 'import_date':'','customs_value_usd':'','paid_duty_usd':'','evidence_kind':'public_storefront_variant'})
write_csv('products.csv',variants,['product_id','variant_id','sku','name','variant','vendor','product_type','description','retail_price','listed_weight_grams','available','published_at','hts_code','country_of_origin','import_date','customs_value_usd','paid_duty_usd','source_url','captured_from_url','retrieved_at','evidence_kind'])

# Explore model version indexes and production-document folders; no CAD,
# firmware, photos or binaries unrelated to published BOMs are downloaded.
roots=['TAZ/','Mini/','AO-100/','AO-101/','KITTAZ/','Budaschnozzle/','SideKick/','retail_parts/']
queue=['https://download.lulzbot.com/'+root for root in roots]; seen=set(); bom_urls=set(); skipped=[]
with ThreadPoolExecutor(max_workers=3) as pool:
    while queue and len(seen)<400:
        batch=[]
        while queue and len(batch)<3:
            url=queue.pop(0)
            if url not in seen:seen.add(url);batch.append(url)
        for url,(data,entry) in zip(batch,pool.map(get,batch)):
            if data is None:continue
            for link in html(data).links:
                if link.startswith('?') or link.startswith('/') or link.startswith('../'):continue
                target=urllib.parse.urljoin(url,link); name=urllib.parse.unquote(link).strip('/')
                if link.endswith('/'):
                    relevant=bool(re.match(r'^(?:v?\d|TAZ_|production_docs$|Documents$|documentation$|Completed_Parts$|BOM|BoM|bom|hardware$|accessories$)',name))
                    if relevant and target not in seen and target not in queue:queue.append(target)
                    elif not relevant:skipped.append(target)
                elif re.search(r'(?:bom|bill.of.material)',name,re.I) and re.search(r'\.(xlsx|ods|csv|tsv)$',name,re.I):bom_urls.add(target)
        if len(seen)%30==0:print(f'Archive: {len(seen)} indexes, {len(bom_urls)} BOM files discovered',flush=True)

bom_files=[]; raw_rows=[]; parsed_hashes={}; limit_failures=[]
OD={'table':'urn:oasis:names:tc:opendocument:xmlns:table:1.0','text':'urn:oasis:names:tc:opendocument:xmlns:text:1.0','office':'urn:oasis:names:tc:opendocument:xmlns:office:1.0'}
def extract(data,kind):
    if kind in ('xlsx','ods'):
        z=zipfile.ZipFile(io.BytesIO(data))
        if len(z.infolist())>2000 or sum(i.file_size for i in z.infolist())>100_000_000 or any(i.file_size>25_000_000 for i in z.infolist()):raise ValueError('Workbook expansion exceeds bounded extraction limits')
    if kind=='xlsx':
        # Read sparse published cells, not formatted empty million-row ranges.
        ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        strings=[]
        if 'xl/sharedStrings.xml' in z.namelist():
            for item in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',ns):
                strings.append(''.join(item.itertext()))
        relationships={r.get('Id'):r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        for sheet in ET.fromstring(z.read('xl/workbook.xml')).findall('s:sheets/s:sheet',ns):
            target=relationships[sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')]
            path=target.lstrip('/') if target.startswith('/') else 'xl/'+target
            nonempty=0; nonempty_cells=0
            for _,node in ET.iterparse(io.BytesIO(z.read(path)),events=('end',)):
                if node.tag != '{'+ns['s']+'}row':continue
                cells={}
                for c in node.findall('s:c',ns):
                    value=c.find('s:v',ns); text=value.text or '' if value is not None else ''
                    if c.get('t')=='s' and text: text=strings[int(text)]
                    elif c.get('t')=='inlineStr':text=''.join(c.find('s:is',ns).itertext())
                    if not text:continue
                    letters=re.match(r'[A-Z]+',c.get('r','')).group();col=0
                    for char in letters:col=col*26+ord(char)-64
                    if col>16384:raise ValueError('Invalid Excel column')
                    nonempty_cells+=1
                    if nonempty_cells>500000:raise ValueError('Nonempty cell count exceeds bound')
                    cells[col-1]=text
                if cells:
                    nonempty+=1
                    if nonempty>50000:raise ValueError('Nonempty row count exceeds bound')
                    yield sheet.get('name','Sheet'),int(node.get('r','0')),[cells.get(i,'') for i in range(min(max(cells)+1,256))],{str(i+1):value for i,value in cells.items() if i>=256}
                node.clear()
    elif kind=='ods':
        root=ET.fromstring(z.read('content.xml'))
        for table in root.findall('.//table:table',OD):
            name=table.get('{'+OD['table']+'}name','Sheet');index=0
            for row in table.findall('table:table-row',OD):
                count=int(row.get('{'+OD['table']+'}number-rows-repeated','1'));cells=[];width=0
                for c in row:
                    if c.tag not in ('{'+OD['table']+'}table-cell','{'+OD['table']+'}covered-table-cell'):continue
                    value='\n'.join(''.join(p.itertext()) for p in c.findall('text:p',OD))
                    repeat=int(c.get('{'+OD['table']+'}number-columns-repeated','1'))
                    if value and width+repeat>128:raise ValueError('Nonempty repeated cells exceed bounds')
                    cells.extend([value]*max(0,min(repeat,128-width)));width+=repeat
                while cells and not cells[-1]:cells.pop()
                if any(cells):
                    if count>50000 or len(cells)>128:raise ValueError('ODS expansion exceeds bounds')
                    for _ in range(count):index+=1;yield name,index,cells
                else:index+=count
                if index>2000000:raise ValueError('ODS sheet row limit exceeded')
    else:
        reader=csv.reader(io.StringIO(data.decode('utf-8-sig')),delimiter='\t' if kind=='tsv' else ',')
        for i,cells in enumerate(reader,1):
            if i>50000 or len(cells)>128:raise ValueError('CSV structural bounds exceeded')
            if any(cells):yield 'Sheet1',i,cells

# Prefer XLSX to the equivalent ODS when the same basename has both.
oversize={entry['url'] for entry in PRIOR_ERRORS if entry.get('error')=='Source exceeds bounded download limit'}
selected=[u for u in sorted(bom_urls) if not (u.endswith('.ods') and u[:-4]+'.xlsx' in bom_urls and u[:-4]+'.xlsx' not in oversize)
          and not (u.endswith('.xlsx') and u in oversize and u[:-5]+'.ods' in bom_urls)]
with ThreadPoolExecutor(max_workers=3) as pool:
    for url,(data,entry) in zip(selected,pool.map(get,selected)):
        record={'source_url':url,'retrieved_at':entry['retrieved_at'],'status':entry['status'],'raw_file':entry.get('raw_file'),'sha256':entry.get('sha256')}
        if data is None:bom_files.append(record);continue
        digest=entry['sha256']
        if digest in parsed_hashes:record['identical_to']=parsed_hashes[digest];bom_files.append(record);continue
        parsed_hashes[digest]=url
        try:
            rows=list(extract(data,url.rsplit('.',1)[-1].lower()))
            for sheet,row_number,cells,*extra in rows:
                raw_rows.append({'source_url':url,'source_sha256':digest,'sheet':sheet,'source_row':row_number,'cells':cells,'cells_beyond_256':extra[0] if extra else {},'retrieved_at':entry['retrieved_at']})
            record['nonempty_rows']=len(rows)
        except Exception as error:record['extraction_error']=str(error);limit_failures.append(url)
        bom_files.append(record)
        print(f'BOM {len(bom_files)}/{len(selected)}: {record.get("nonempty_rows",record.get("extraction_error","duplicate"))}',flush=True)
(RAW/'bom-source-rows.jsonl').write_text(''.join(json.dumps(row,ensure_ascii=False)+'\n' for row in raw_rows))
(OUT/'bom-sources.json').write_text(json.dumps(bom_files,indent=2))
(OUT/'crawl-report.json').write_text(json.dumps({'retrieved_at':NOW,'catalogue_pagination_completed':catalogue_complete,'products':len(products),'variants':len(variants),'archive_indexes':len(seen),'archive_queue_remaining':queue,'archive_directory_filters_exclude':sorted(set(skipped)),'bom_files_discovered':len(bom_urls),'bom_files_selected':len(selected),'unique_workbooks_extracted':len(parsed_hashes)-len(limit_failures),'bom_nonempty_source_rows':len(raw_rows),'extraction_failures':limit_failures,'previous_fetch_failures':PRIOR_ERRORS,'sources':LOG},indent=2))
print(json.dumps({'products':len(products),'variants':len(variants),'bom_files':len(bom_files),'raw_bom_rows':len(raw_rows),'archive_queue_remaining':len(queue)}),flush=True)
