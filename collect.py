"""Build the static event index from independently refreshable public feeds."""
import concurrent.futures
import datetime as dt
import html
import json
import math
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from pathlib import Path

UTC = dt.timezone.utc
WMO = 'https://severeweather.wmo.int'
NHC = 'https://www.nhc.noaa.gov/CurrentStorms.json'
GDACS = 'https://www.gdacs.org/xml/rss_7d.xml'
CENTRES = {1:'Hong Kong Observatory',2:'Beijing',3:'RSMC Honolulu',4:'RSMC Miami',5:'RSMC Tokyo',6:'RSMC New Delhi',7:'RSMC La Réunion',8:'Australian TCWC',9:'Australian TCWC',10:'Australian TCWC',11:'RSMC Nadi',12:'TCWC Wellington',13:'JTWC',14:'Manila',15:'Macao'}

def read(url):
    req = urllib.request.Request(url, headers={'User-Agent':'Storm-Chaser/2 (github.com/jaychtw/storm-chaser)'})
    with urllib.request.urlopen(req, timeout=35) as response:
        return response.read()

def stamp(value):
    try:
        moment = dt.datetime.fromisoformat(value.replace('Z','+00:00'))
    except ValueError:
        moment = parsedate_to_datetime(value)
    return int(moment.replace(tzinfo=moment.tzinfo or UTC).timestamp())

def point(lat,lon):
    if lat in (None,'') or lon in (None,''): return None
    a,b = float(lat),float(lon)
    if abs(a)<=90 and -180<=b<=360: return [a,(b+180)%360-180]

def category(label):
    label = label.lower()
    if 'typhoon' in label or label in ('ty','sty'): return 'TY'
    if 'hurricane' in label or label=='hu': return 'HU'
    if 'storm' in label or label in ('ts','sts'): return 'TS'
    return 'TC'

def gdacs(now):
    root = ET.fromstring(read(GDACS))
    if root.find('channel') is None: raise ValueError('Missing RSS channel')
    events = {}
    for item in root.findall('./channel/item'):
        def field(key): return item.findtext('{http://www.gdacs.org}'+key) or ''
        kind = field('eventtype')
        if kind not in ('TC','FL','EQ','WF','VO','DR') or field('iscurrent')=='false': continue
        end = stamp(field('todate')); issued = stamp(field('datemodified'))
        window = {'EQ':86400,'TC':43200,'DR':604800}.get(kind,172800)
        if now > end + window: continue
        pos = item.findtext('{http://www.georss.org/georss}point','').split()
        desc = item.findtext('description') or ''
        if kind=='TC' and re.search(r'was active|dissipated',desc,re.I) and end<now: continue
        eid = 'gd-'+kind+field('eventid')
        e = dict(id=eid,kind=kind,name=field('eventname'),place=field('country'),codes=field('iso3').split(','),
                 pos=point(*pos) if len(pos)==2 else None, issued=issued,expires=end+window,
                 detail=desc, intensity=field('severity'), level=field('alertlevel'),products={},
                 report='https://www.gdacs.org/report.aspx?eventtype='+kind+'&eventid='+field('eventid'))
        if kind=='TC': e['kind']=category(field('severity'))
        if eid not in events or issued>events[eid]['issued']: events[eid]=e
    return list(events.values())

def wmo(now):
    rows=json.loads(read(WMO+'/json/tc_inforce.json'))['inforce']
    events=[]
    for sid,name,code,strength,start,latest,same,centre,*rest in rows:
        sid=str(int(sid)); url=WMO+'/json/tc_'+sid+'.json'
        data=json.loads(read(url))
        row=max(data['track'],key=lambda x:x['analysis_time'])
        issued=stamp(row['analysis_time'])
        if now-issued>36*3600: continue
        issuer=CENTRES.get(int(centre),'WMO member centre')
        product=dict(issuer=issuer,url=url,issued=issued,intensity=row.get('intensity') or strength,
                     wind=row.get('max_wind_speed'),pressure=row.get('pressure'))
        forecasts=[point(x['lat'],x['lng']) for x in data.get('forecast',[]) if x.get('lat') and x.get('lng')]
        events.append(dict(id='wmo-'+sid,kind=category(product['intensity']),name=name or code,issued=issued,
            expires=issued+36*3600,pos=point(row['lat'],row['lng']),forecast=[p for p in forecasts if p],
            place='',codes=[],products={'wmo':product},aliases=['wmo-'+i for i in re.findall(r'\d+',str(same))]))
    return events

def cwa(now):
    url='https://www.cwa.gov.tw/Data/js/typhoon/TY_NEWS-Data.js'
    raw=read(url).decode('utf-8-sig')
    issue=re.search(r"var TY_DataTime = '(\d{12})'",raw)
    if not issue: raise ValueError('Unrecognized CWA product')
    issued=int(dt.datetime.strptime(issue[1],'%Y%m%d%H%M').replace(tzinfo=UTC).timestamp())
    if now-issued>18*3600:return []
    english=raw.split("TY_LIST_1['E'] =",1)[1].split("TY_LIST_2['E']",1)[0]
    events=[]
    for name,section in re.findall(r'id="([A-Z0-9-]+)">(.+?)(?=<div class="panel panel-default"|$)',english,re.S):
        description=re.search(r'<p>(.*?)</p>',section)
        classification=re.search(r'class="fa-red">([^<]+)',section)
        if not description or not classification:continue
        summary=html.unescape(re.sub('<[^>]+>','',description[1]))
        match=re.search(r'at ([\d.]+)([NS]) ([\d.]+)([EW])',summary)
        number=re.search(r'\((\d{6})\)',section)
        if not match or not number:continue
        pos=point(float(match[1])*(1 if match[2]=='N' else -1),float(match[3])*(1 if match[4]=='E' else -1))
        product=dict(issuer='CWA · 交通部中央氣象署',issued=issued,intensity=classification[1],summary=summary,
                     url='https://www.cwa.gov.tw/V8/E/P/Typhoon/TY_NEWS.html')
        events.append(dict(id='cwa-'+number[1],name=name,pos=pos,kind=category(classification[1]),issued=issued,
                           expires=issued+18*3600,place='',codes=[],products={'cwa':product}))
    if not events and re.search(r'<p>Position',english):raise ValueError('Unrecognized CWA storm')
    return events

def taiwan_quakes(now):
    page=read('https://www.cwa.gov.tw/V8/E/E/MOD/EQ_ROW.html').decode('utf-8-sig')
    rows=re.findall(r'<tr[^>]*class="eq-row".*?</tr>',page,re.S)
    if not rows:raise ValueError('Unrecognized CWA earthquake index')
    events=[]
    for row in rows:
        href=re.search(r'href="(/V8/E/E/EQ/EQ(\d{3})\d+-(\d{4})-(\d{6}).html)"',row)
        lat=re.search(r'data-lat="([\d.-]+)"',row)
        lon=re.search(r'data-lon="([\d.-]+)"',row)
        magnitude=re.search(r'M<sub>L</sub></span>([\d.]+)',row)
        where=re.search(r'Location</span><br>([^<]+)',row)
        if not all((href,lat,lon,magnitude,where)):continue
        date=str(int(href[2])+1911)+href[3]+href[4]
        issued=int(dt.datetime.strptime(date,'%Y%m%d%H%M%S').replace(tzinfo=dt.timezone(dt.timedelta(hours=8))).timestamp())
        if not now-172800<=issued<=now:continue
        product=dict(issuer='CWA · 交通部中央氣象署',issued=issued,intensity='ML '+magnitude[1],
                     url='https://www.cwa.gov.tw'+href[1])
        events.append(dict(id='tw-eq-'+date,kind='EQ',name='ML '+magnitude[1],place=html.unescape(where[1]),
                      pos=point(lat[1],lon[1]),issued=issued,expires=issued+172800,codes=['TWN'],products={'cwa':product}))
    return events

def nhc(now):
    events=[]
    for row in json.loads(read(NHC))['activeStorms']:
        advisory=row.get('publicAdvisory') or row.get('forecastAdvisory') or {}
        url=advisory.get('url') or NHC
        issued=stamp(row.get('lastUpdate') or advisory['issuance'])
        if now-issued>36*3600: continue
        product=dict(issuer='NOAA / NHC' if not row['id'].lower().startswith('cp') else 'NOAA / CPHC',
                     url=url,issued=issued,intensity=row['classification'],wind=row.get('intensity'),pressure=row.get('pressure'))
        events.append(dict(id='nhc-'+row['id'],kind=category(row['classification']),name=row.get('name') or row['id'],
            issued=issued,expires=issued+36*3600,pos=point(row.get('latitudeNumeric'),row.get('longitudeNumeric')),
            place='',codes=[],products={'noaa':product}))
    return events

def distance(a,b):
    if not a or not b:return math.inf
    lat,lon=map(math.radians,a); y,x=map(math.radians,b)
    return 6371*2*math.asin(min(1,math.sqrt(math.sin((lat-y)/2)**2+math.cos(lat)*math.cos(y)*math.sin((lon-x)/2)**2)))

def merge(groups,now):
    result=[]
    for key in ('noaa','wmo','cwa','cwa-eq','gdacs'):
        for e in groups[key]['events']:
            if e['expires']<now: continue
            match=None
            if e['kind'] in ('TY','HU','TS','TC'):
                def normalized(v):return re.sub(r'-\d{2}$','',''.join(v.upper().split()))
                for existing in result:
                    if existing['kind'] not in ('TY','HU','TS','TC'): continue
                    same_id=e['id'] in existing.get('aliases',[]) or existing['id'] in e.get('aliases',[])
                    same_name=normalized(e['name'])==normalized(existing['name']) and e['name'] and distance(e['pos'],existing['pos'])<700
                    if same_id or same_name:match=existing;break
            if e['kind']=='EQ' and key=='gdacs':
                origin=e['expires']-86400
                match=next((x for x in result if x['kind']=='EQ' and abs(x['issued']-origin)<90 and distance(x['pos'],e['pos'])<45),None)
            if match is None:
                result.append(dict(e,products=dict(e['products']),aliases=list(e.get('aliases',[]))))
            else:
                match['aliases'] += [e['id']]+e.get('aliases',[])
                for source,p in e['products'].items():
                    if p['issued']>=match['products'].get(source,{}).get('issued',0):match['products'][source]=p
                for field in ('place','codes','report','detail','forecast'):
                    if e.get(field) and not match.get(field):match[field]=e[field]
    rank={'TY':0,'HU':1,'TS':2,'TC':2}
    return sorted(result,key=lambda e:(rank.get(e['kind'],3),-e['issued']))

def run(path):
    now=int(dt.datetime.now(UTC).timestamp())
    previous=json.loads(path.read_text()) if path.exists() else {}
    feeds={}
    with concurrent.futures.ThreadPoolExecutor() as pool:
        jobs={k:pool.submit(f,now) for k,f in [('gdacs',gdacs),('wmo',wmo),('noaa',nhc),('cwa',cwa),('cwa-eq',taiwan_quakes)]}
        for k,job in jobs.items():
            try:
                feeds[k]=dict(ok=True,checked=now,events=job.result())
            except Exception as exc:
                print(k,exc,file=sys.stderr)
                feeds[k]=dict(previous.get('feeds',{}).get(k,{'checked':0,'events':[]}),ok=False)
    out=dict(generated=now,feeds=feeds,events=merge(feeds,now))
    path.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':')))
    print('Events:',len(out['events']),{k:v['ok'] for k,v in feeds.items()})
    if not any(f['checked'] for f in feeds.values()):raise SystemExit('No usable source')

if __name__=='__main__':run(Path('site/events.json'))
