'use strict';
const app=document.querySelector('#app'), langButton=document.querySelector('#language');
let zh=localStorage.getItem('sc-language')==='zh', snapshot, authorities={}, failed=false;
let filter='', query='', cameraOnly=false, limit=12, source='local', jurisdiction='', playing='', current='';
const t=(en,tw)=>zh?tw:en;
const brandName=()=>t('World Disaster Information Center','全球災害資訊站');
const names={TY:['Typhoon','颱風'],HU:['Hurricane','颶風'],TS:['Tropical storm','熱帶風暴'],TC:['Tropical cyclone','熱帶氣旋'],EQ:['Earthquake','地震'],FL:['Flood','洪水'],WF:['Wildfire','野火'],DR:['Drought','乾旱'],VO:['Volcanic activity','火山活動']};
const cameras=[
 ['aaKOV4qkDHw','Liyu Lake','花蓮鯉魚潭',23.929,121.508],['AKl3F6cAY2Q','Jialulan Coast','臺東加路蘭',22.797,121.198],
 ['rvc1klNIgQc','Luye Highland','鹿野高台',22.914,121.121],['6kUEK3LVrro','Chishang','池上天堂路',23.099,121.219],
 ['nLiYOxh6bGE','Fulong Beach','福隆海水浴場',25.021,121.945],['ZjuY4qKaj40','Yehliu Geopark','野柳地質公園',25.206,121.69],
 ['Z4x4aQsmT2M','Nanfang’ao Harbor','南方澳漁港',24.581,121.867],['jUnFuJSj0OU','Nanwan Bay','墾丁南灣',21.96,120.765],
 ['fjhg3gAnMFg','Gaomei Wetlands','高美濕地',24.312,120.55],['xwAWSh35uuw','Tamsui Fisherman’s Wharf','淡水漁人碼頭',25.183,121.411],
 ['nDxJ7sWfG_E','Kaohsiung Harbor','高雄港',22.62,120.284],['GUCaVR88ZFU','Shihmen Reservoir','石門水庫',24.812,121.247]
];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=s=>s?new Date(s*1000).toLocaleString(zh?'zh-TW':'en-GB',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}):t('Never','尚無紀錄');
const kind=e=>t(...names[e.kind]);
const coords=p=>p?p.map((v,i)=>Math.abs(v).toFixed(2)+'°'+(i?(v<0?'W':'E'):(v<0?'S':'N'))).join(' · '):'';
function place(e){return e.place||coords(e.pos)||t('Location unavailable','無位置資料')}
function title(e){return e.name||((e.kind==='EQ'&&e.intensity?.match(/Magnitude ([\d.]+)/i))?'M'+RegExp.$1+' '+kind(e):kind(e))}
function dist(a,b){
 if(!a||!b)return Infinity;
 const rad=Math.PI/180, s=Math.sin;
 return 12742*Math.asin(Math.min(1,Math.sqrt(s((b[0]-a[0])*rad/2)**2+Math.cos(a[0]*rad)*Math.cos(b[0]*rad)*s((b[1]-a[1])*rad/2)**2)));
}
function matches(e){
 const radius={EQ:75,FL:20,WF:15,VO:30,DR:0}[e.kind]??120;
 return cameras.map(c=>{
  const pos=c.slice(3),km=dist(pos,e.pos);
  const forecast=Math.min(Infinity,...(e.forecast||[]).map(p=>dist(pos,p)));
  if(km<=radius)return {c,km,forecast:false};
  if(forecast<=100)return {c,km:forecast,forecast:true};
 }).filter(Boolean).sort((a,b)=>Number(a.forecast)-Number(b.forecast)||a.km-b.km);
}
function link(url,label){
 try{const u=new URL(url);if(['http:','https:'].includes(u.protocol))return '<a class="action" target="_blank" rel="noopener noreferrer" href="'+esc(u.href)+'">'+esc(label)+' ↗</a>'}catch{}
 return '';
}
function map(events,detail=false){
 return '<div class="map" role="img" aria-label="'+t('World map of reported locations','事件位置世界地圖')+'">'+events.filter(e=>e.pos).map(e=>'<i class="dot '+(detail?'detaildot':'')+'" style="left:'+((180+e.pos[1])/3.6)+'%;top:'+((90-e.pos[0])/1.8)+'%"></i>').join('')+'</div>';
}
function status(){
 const problems=Object.entries(snapshot.feeds).filter(([,v])=>!v.ok||Date.now()/1000-v.checked>7200);
 return '<details class="status"><summary>'+esc(t('Feed check','資料檢查')+' · '+fmt(snapshot.generated))+'</summary>'+Object.entries(snapshot.feeds).map(([k,v])=>'<p>'+k.toUpperCase()+' · '+t('Last successful check','最近成功檢查')+' '+fmt(v.checked)+'</p>').join('')+'</details>'+
 (problems.length||failed?'<p class="warning" role="status">'+esc(t('Coverage may be incomplete. Last available reports are shown.','資料可能不完整，目前顯示最近取得的通報。'))+' '+problems.map(([k])=>k.toUpperCase()).join(' · ')+'</p>':'');
}
function card(e){return '<a class="card" href="#'+esc(e.id)+'"><span class="kind">'+kind(e)+'</span><strong>'+esc(title(e))+'</strong><span>'+esc(place(e))+'</span><span class="tail"><small>'+fmt(e.issued)+'</small><b aria-hidden="true">↗</b></span></a>'}
function list(){
 const events=snapshot.events.filter(e=>e.expires>Date.now()/1000);
 const visible=events.filter(e=>(!filter||e.kind===filter)&&(!cameraOnly||matches(e).length)&&(!query||[e.name,e.place,coords(e.pos),...names[e.kind]].join(' ').toLowerCase().includes(query.toLowerCase())));
 const groups=[['TY'],['HU'],['TS','TC'],['EQ','FL','WF','DR','VO']];
 let seen=0,html='';
 for(const g of groups){
  const subset=visible.filter(e=>g.includes(e.kind));
  const rows=subset.slice(0,Math.max(0,limit-seen));seen+=rows.length;
  if(rows.length)html+='<h3 class="group">'+(g.length>2?t('Other natural disasters','其他天然災害'):g.length===2?t('Tropical storms & cyclones','熱帶風暴與氣旋'):t(...names[g[0]]))+' · '+subset.length+'</h3><div class="events">'+rows.map(card).join('')+'</div>';
 }
 document.querySelector('#results').innerHTML=html||'<p class="noshow">'+(query||filter||cameraOnly?t('No matching reports.','找不到相符通報。'):t('No unexpired reports from the available feeds.','目前可用來源沒有有效期內的通報。'))+'</p>';
 if(visible.length>seen)document.querySelector('#results').insertAdjacentHTML('beforeend','<button class="more" data-more>'+t('Show more reports','顯示更多通報')+' ↓</button>');
}
function overview(){
 const events=snapshot.events.filter(e=>e.expires>Date.now()/1000);
 app.innerHTML='<section class="hero"><div class="intro"><div class="kicker">◎ '+t('Global hazard monitor','全球災害監測')+'</div><h1 class="site-title">'+brandName()+'</h1><p>'+t('Follow a storm or disaster. Read the latest reports and explore cameras near the event.','追蹤風暴與天然災害，閱讀最新通報，查看事件附近的攝影機。')+'</p></div>'+map(events)+'</section>'+status()+'<div class="sectionhead"><h2>'+t('Event watch','事件觀測')+'</h2><div class="controls"><label><input type="checkbox" id="cameraOnly" ' +(cameraOnly?'checked':'')+ '> '+t('With cameras','有攝影機')+'</label><input type="search" id="search" placeholder="'+t('Search locations or events','搜尋地區或事件')+'" aria-label="'+t('Search reports','搜尋通報')+'" value="'+esc(query)+'"><select id="filter" aria-label="'+t('Hazard type','災害類別')+'"><option value="">'+t('All hazards','所有災害')+'</option>'+Object.keys(names).filter(k=>events.some(e=>e.kind===k)).map(k=>'<option value="'+k+'" '+(filter===k?'selected':'')+'>'+t(...names[k])+'</option>').join('')+'</select></div></div><div id="results"></div>';list();
}
const geoAgency={
 TWN:['Central Weather Administration','https://www.cwa.gov.tw/V8/E/E/index.html','Taiwan'],
 JPN:['Japan Meteorological Agency','https://www.jma.go.jp/bosai/map.html#contents=earthquake_map','Japan'],
 USA:['U.S. Geological Survey','https://earthquake.usgs.gov/earthquakes/map/','United States'],
 IDN:['BMKG','https://www.bmkg.go.id/gempabumi','Indonesia'],
 PHL:['PHIVOLCS','https://earthquake.phivolcs.dost.gov.ph/','Philippines'],
 PER:['Instituto Geofísico del Perú','https://ultimosismo.igp.gob.pe/','Peru']
};
function locals(e){
 const entries={};
 for(const raw of e.codes||[]){
  const k=raw.trim(),a=e.kind==='EQ'?geoAgency[k]:['TY','HU','TS','TC','FL','DR'].includes(e.kind)?authorities[k]:null;
  if(a)entries[k]={issuer:a[0],url:a[1],place:a[2],directory:true};
 }
 if(e.products.cwa)entries.TWN={...e.products.cwa,place:'Taiwan'};
 if(e.products.noaa&&(e.codes||[]).includes('USA'))entries.USA={...e.products.noaa,place:'United States'};
 if(!Object.keys(entries).length && e.products.wmo)entries.region={...e.products.wmo,regional:true};
 return entries;
}
function agency(e){
 const choices=locals(e),keys=Object.keys(choices);
 if(!keys.includes(jurisdiction))jurisdiction=keys[0]||'';
 const p=source==='local'?choices[jurisdiction]:e.products[source];
 let html='<div class="tabs">'+[['local',t('Local authority','當地主管機關')],['noaa','NOAA'],['wmo','WMO']].map(([k,n])=>'<button data-source="'+k+'" aria-pressed="'+(source===k)+'">'+n+'</button>').join('')+'</div>';
 if(source==='local'&&keys.length>1)html+='<select id="region" aria-label="'+t('Jurisdiction','管轄地區')+'">'+keys.map(k=>'<option value="'+esc(k)+'" '+(jurisdiction===k?'selected':'')+'>'+esc(choices[k].place||choices[k].issuer)+'</option>').join('')+'</select>';
 if(!p)return html+'<p>'+t('No event-specific product matched for this source.','此來源沒有與本事件相符的資料。')+'</p>'+(source==='wmo'?link('https://severeweather.wmo.int/'+(['TY','HU','TC','TS'].includes(e.kind)?'tclist.html':'list.html'),t('Browse WMO listings','瀏覽 WMO 資料')):'');
 html+='<h3>'+esc(p.issuer)+'</h3>';
 if(p.directory)html+='<p>'+t('Agency directory. An event-specific bulletin has not been matched.','主管機關目錄。目前尚未比對到本事件的專屬通報。')+'</p>';
 else html+=(p.regional?'<p>'+t('Regional issuing centre via WMO','由 WMO 提供的區域發布中心通報')+'</p>':'')+'<p>'+esc([p.intensity,p.wind&&p.wind+' kt',p.pressure&&p.pressure+' hPa'].filter(Boolean).join(' · '))+'</p>'+(p.summary?'<p>'+esc(p.summary)+'</p>':'')+'<p class="stamp">'+fmt(p.issued)+'</p>';
 return html+link(p.url,p.directory?t('Open agency website','開啟機關網站'):t('Open source product','開啟來源資料'));
}
function streams(e){
 const cams=matches(e);
 if(!cams.length)return '<p class="noshow">'+t('No known public camera near this event.','本事件附近沒有已知的公開攝影機。')+'</p><small>'+t('Camera coverage currently includes Taiwan.','目前攝影機收錄範圍為臺灣。')+'</small>';
 return cams.map(({c,km,forecast})=>'<div class="cam">'+link('https://www.youtube.com/watch?v='+c[0],t('Provider','來源'))+'<h3>'+esc(t(c[1],c[2]))+'</h3><p>'+Math.round(km)+' km · '+(forecast?t('near a forecast position','鄰近預測位置'):t('from the reported location','距通報位置'))+'</p><button data-cam="'+c[0]+'">'+(playing===c[0]?t('Close player','關閉播放器'):t('Watch camera','觀看攝影機'))+'</button>'+(playing===c[0]?'<iframe allowfullscreen allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" title="'+esc(t(c[1],c[2]))+'" src="https://www.youtube-nocookie.com/embed/'+c[0]+'?autoplay=1"></iframe>':'')+'</div>').join('');
}
function render(){
 document.title=brandName();document.querySelectorAll('[data-brand]').forEach(node=>{node.textContent=brandName()});
 document.documentElement.lang=zh?'zh-Hant':'en';langButton.textContent=zh?'English':'繁體中文';
 if(!snapshot){app.textContent=t('Loading reports…','正在載入通報…');return}
 const id=location.hash.slice(1);
 if(current!==id){current=id;source='local';jurisdiction='';playing='';window.scrollTo(0,0)}
 if(!id){overview();return}
 const e=snapshot.events.find(x=>x.id===id||x.aliases?.includes(id));
 const back='<a class="back" href="#">← '+t('All events','所有事件')+'</a>';
 if(!e){app.innerHTML=back+'<p>'+t('This event has left the current feed.','此事件已離開目前的資料清單。')+'</p>';return}
 app.innerHTML=back+'<section class="hero detail"><div class="intro"><div class="kicker">'+kind(e)+'</div><h1>'+esc(title(e))+'</h1><p>'+esc(place(e))+'</p></div>'+map([e],true)+'</section>'+status()+(e.expires*1000<Date.now()?'<p class="warning">'+t('Report expired','通報已過期')+'</p>':'')+'<div class="columns"><section class="panel"><h2>'+t('Official sources','官方資料來源')+'</h2><div id="agency">'+agency(e)+'</div></section><section class="panel"><h2>'+t('Area cameras','周邊攝影機')+'</h2><div id="cams">'+streams(e)+'</div></section></div><section class="panel"><h2>'+t('Event report','事件通報')+'</h2><small>'+fmt(e.issued)+' · '+esc(coords(e.pos))+'</small><p>'+esc(e.detail||e.products.cwa?.summary||Object.values(e.products)[0]?.intensity||'')+'</p>'+ (e.report?link(e.report,'GDACS'): '')+'</section>';
}
function selected(){return snapshot.events.find(e=>e.id===current||e.aliases?.includes(current))}
app.addEventListener('input',e=>{if(e.target.id==='search'){query=e.target.value;limit=12;list()}});
app.addEventListener('change',e=>{if(e.target.id==='cameraOnly'){cameraOnly=e.target.checked;limit=12;list()}if(e.target.id==='filter'){filter=e.target.value;limit=12;list()}if(e.target.id==='region'){jurisdiction=e.target.value;document.querySelector('#agency').innerHTML=agency(selected());document.querySelector('#region')?.focus()}});
app.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.hasAttribute('data-more')){limit+=24;list()}
 if(b.dataset.source){source=b.dataset.source;document.querySelector('#agency').innerHTML=agency(selected());document.querySelector('[data-source="'+source+'"]').focus()}
 if(b.dataset.cam){playing=playing===b.dataset.cam?'':b.dataset.cam;document.querySelector('#cams').innerHTML=streams(selected());document.querySelector('[data-cam="'+b.dataset.cam+'"]').focus()}
 if(b.dataset.retry)load();
});
langButton.onclick=()=>{zh=!zh;localStorage.setItem('sc-language',zh?'zh':'en');render()};
window.addEventListener('hashchange',render);
async function load(){
 try{
  const r=await fetch('events.json',{cache:'no-store'});if(!r.ok)throw Error();
  const data=await r.json();if(!Array.isArray(data.events)||!data.feeds)throw Error();
  const changed=failed||snapshot?.generated!==data.generated;
  snapshot=data;failed=false;if(changed)render();
 }catch{
  failed=true;if(snapshot)render();else app.innerHTML='<p role="alert">'+t('The event feed could not be loaded.','無法載入事件資料。')+'</p><button data-retry="1">'+t('Retry','重新載入')+'</button>';
 }
}
fetch('authorities.json').then(r=>r.json()).then(data=>{authorities=data;if(current)render()}).catch(()=>{});
render();load();setInterval(load,60000);
