import {createLocalClient} from './local-client.mjs?v=20261030-route21fix';
import {tableSize,splitPanel} from './table-layout.mjs?v=20261030-route21fix';
import {inferInbound,boundDirections} from './directions.mjs';
import {importFileFrom,installFileDrop} from './upload.mjs';
import {groups,clock,dayNames,trainLabel,initialDate,pruneTable,branchTag,branchInfo,branchOptions,directionChoices,tablePanels,genericGroups} from './schedule.mjs?v=20261030-route21fix';
const $=id=>document.getElementById(id);
const local=createLocalClient(text=>message(text));
let feed,current=[],busy=false,branchRouteKey="";
const inboundOverrides=new Map();
const routeIdentity=()=>[feed?.feedId||'demo',feed?.mode||'train',$('route').value].join(':');
const today=new Date();$('date').value=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const human=d=>new Date(d+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
function message(text,error=false){$('message').textContent=text;$('message').className=error?'error':'';}
function setBusy(value){busy=value;for(const el of document.querySelectorAll('.filters select,.filters input,#branches,#inbound,#mode button,#demo,#file,#csv,#print'))el.disabled=value;if(!value&&feed)syncModes();}
function selectedRoute(){return feed?.routes.find(r=>r.route_id===$('route').value);}
function routeName(){const r=selectedRoute();return r?.route_long_name||r?.route_short_name||r?.route_id||'Route';}
function syncModes(){for(const b of $('mode').querySelectorAll('button')){b.setAttribute('aria-pressed',String(b.dataset.mode===(feed.mode||'train')));b.disabled=!(feed.availableModes||['train']).includes(b.dataset.mode);}}
function directions(){
  const key=routeIdentity(),manual=inboundOverrides.get(key)||'',auto=inferInbound(feed,$('route').value),compass=directionChoices(feed,$('route').value);
  const autoLabel=compass.find(d=>d.id===auto.id)?.label||'Undetermined';
  $('inbound').innerHTML=`<option value="">Auto — ${esc(autoLabel)}</option>`+compass.map(d=>`<option value="${esc(d.id)}">${esc(d.label)} is inbound</option>`).join('');
  $('inbound').value=manual;$('inbound').title=`Auto: ${auto.reason}. Choose a direction to override.`;$('inbound-field').hidden=compass.length<2;
  const prior=$('direction').value,choices=boundDirections(feed,$('route').value,manual);
  $('direction').innerHTML='<option value="all">Both directions</option>'+choices.map(d=>`<option value="${d.role.toLowerCase()}">${esc(d.label)}</option>`).join('');
  if(choices.some(d=>d.role.toLowerCase()===prior))$('direction').value=prior;
}
function branches(){const routeKey=[feed.feedId||'demo',feed.mode,$('route').value].join(':');const prior=routeKey===branchRouteKey?$('branches').value:'';branchRouteKey=routeKey;const choices=branchOptions(feed,$('route').value);$('branch-field').hidden=choices.length<2;$('branches').innerHTML='<option value="">Consolidated Table</option>'+choices.map(b=>`<option value="${esc(b.key)}">${esc(b.label)}</option>`).join('');if(choices.some(b=>b.key===prior))$('branches').value=prior;}
function setFeed(data){const prior=$('route').value;feed=data;if(feed.mode==='bus')feed.routes=[...feed.routes].sort((a,b)=>(a.route_short_name||a.route_long_name||a.route_id).localeCompare(b.route_short_name||b.route_long_name||b.route_id,'en',{numeric:true,sensitivity:'base'}));$('agency').textContent=feed.agency;const counts=feed.modeCounts;$('source').textContent=feed.demo?'Demonstration feed · Fictional railway':counts?`${counts.train||0} rail lines · ${counts.bus||0} bus routes · Imported GTFS`:`${feed.routes.length} lines · Imported GTFS`;$('route').innerHTML=[...feed.routes].sort((a,b)=>String(a.route_short_name||a.route_long_name||a.route_id).localeCompare(String(b.route_short_name||b.route_long_name||b.route_id),'en',{numeric:true,sensitivity:'base'})||String(a.route_long_name||a.route_id).localeCompare(String(b.route_long_name||b.route_id),'en',{numeric:true,sensitivity:'base'})).map(r=>`<option value="${esc(r.route_id)}">${esc([r.route_short_name,r.route_long_name].filter(Boolean).join(' · ')||r.route_id)}</option>`).join('');if(feed.loadedRoute)$('route').value=feed.loadedRoute;else if(feed.routes.some(r=>r.route_id===prior))$('route').value=prior;$('date').value=initialDate(feed,$('date').value);directions();branches();syncModes();message(feed.warnings.join(' '));render();}
function applyTheme(){const r=selectedRoute();const color=/^[\da-f]{6}$/i.test(r?.route_color||'')?r.route_color:'285b43';const rgb=color.match(/../g).map(x=>parseInt(x,16));const luminance=rgb.map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((a,c,i)=>a+c*[.2126,.7152,.0722][i],0);const contrastWhite=1.05/(luminance+.05),contrastBlack=(luminance+.05)/.05;let ink=contrastWhite>=contrastBlack?'ffffff':'000000';if(/^[\da-f]{6}$/i.test(r?.route_text_color||'')){const text=r.route_text_color.match(/../g).map(x=>parseInt(x,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((a,c,i)=>a+c*[.2126,.7152,.0722][i],0);if((Math.max(text,luminance)+.05)/(Math.min(text,luminance)+.05)>=4.5)ink=r.route_text_color;}const tint=amount=>'#'+rgb.map(v=>Math.round(v+(255-v)*amount).toString(16).padStart(2,'0')).join('');for(const [key,value]of Object.entries({'--line-color':'#'+color,'--line-ink':'#'+ink,'--line-tint':tint(.87),'--line-stripe':tint(.96)}))$('schedule').style.setProperty(key,value);}
function dayLabel(dates){const days=dates.map(d=>dayNames[new Date(d+'T12:00:00Z').getUTCDay()]);return days.length===5&&days.join()==='Monday,Tuesday,Wednesday,Thursday,Friday'?'Monday – Friday':days.join(' · ');}
function timeText(cell){return cell.kind==='pass'?'↓':cell.kind==='time'?(clock(cell.time,$('format').value==='12',$('format').value==='service')||'—'):'';}
function panelData(t){
  const showBranch=feed.mode==='bus'&&$('branches').value===''&&new Set(t.columns.map(c=>branchInfo(c.trip).key)).size>1;
  return {trips:t.columns.map(c=>({number:trainLabel(c.trip),marker:c.trip.dayMarker||'',branch:showBranch?branchTag(c.trip,selectedRoute()):c.trip.service_variant||''})),
    rows:t.stations.map((st,row)=>({name:st.name,cells:t.columns.map(c=>timeText(c.cells[row]))}))};
}
function availableTableWidth(){
  const schedule=$('schedule'),style=getComputedStyle(schedule);
  // Reserve borders, deck padding, and the table's vertical scrollbar gutter.
  return Math.max(1,schedule.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)-(matchMedia('(max-width:580px)').matches?33:45));
}
function panelHTML(section,full,columns,panel,total,groupTitle){const t=pruneTable(full,columns);const showBranch=feed.mode==='bus'&&$('branches').value===''&&new Set(full.columns.map(c=>branchInfo(c.trip).key)).size>1;const label=[section.branchLabel,section.label].filter(Boolean).join(' · ');return `<div class="direction-title">${section.branchLabel?`<strong>${esc(section.branchLabel)}</strong>`:''}<span title="${esc(t.sortStation?`Ordered at ${t.sortStation}`:'Ordered by departure')}">Panel ${panel+1} of ${total}</span></div><div class="table-scroll"><table aria-label="${esc(groupTitle+' '+label)}"><thead><tr><th class="station" scope="col">${feed.mode==='bus'?'STOP / TRIP':'STATION / TRIP'} NUMBER →</th>${t.columns.map(c=>`<th scope="col" title="${esc(c.trip.trip_id+(c.trip.source_service_date?' · Service date '+c.trip.source_service_date:''))}"><span class="trip-label"><span class="trip-number">${esc(trainLabel(c.trip))}</span>${c.trip.dayMarker?`<sub class="day-marker" title="Runs on ${esc(c.trip.dayDescription)}" aria-label="Runs on ${esc(c.trip.dayDescription)}">${esc(c.trip.dayMarker)}</sub>`:''}</span>${showBranch||c.trip.service_variant?`<small class="branch-label" title="${esc(c.trip.trip_headsign||branchInfo(c.trip).label)}">${esc(showBranch?branchTag(c.trip,selectedRoute()):c.trip.service_variant)}</small>`:''}</th>`).join('')}</tr></thead><tbody>${t.stations.map((st,row)=>`<tr class="${st.branch?'branch-stop':''}"><th class="station" scope="row">${esc(st.name)}${st.branch&&(row===0||t.stations[row-1].branch!==st.branch)?`<small class="station-branch">${esc(st.branchLabel)} branch</small>`:''}</th>${t.columns.map(c=>{const cell=c.cells[row];const title=cell.kind==='blank'?'Not served':cell.kind==='pass'?'Passing stop':cell.time?`${cell.time}${cell.estimated?' · Approximate time':''}`:'Time not published';return `<td class="${cell.kind}${cell.estimated?' estimated':''}" title="${esc(title)}" aria-label="${esc(title)}">${esc(timeText(cell))}</td>`;}).join('')}</tr>`).join('')}</tbody></table></div>`;}
function render(){
  if(!feed||!$('date').value)return;
  const branchKey=$('branch-field').hidden?'':$('branches').value;
  const choices=boundDirections(feed,$('route').value,$('inbound').value).filter(d=>$('direction').value==='all'||d.role.toLowerCase()===$('direction').value);
  const generic=$('group').value==='generic';
  $('generic-days-field').hidden=!generic;
  const selectedDays=$('generic-days').value;
  current=choices.map(d=>({...d,groups:(generic?genericGroups(feed,$('route').value,$('date').value,d.id,{branchKey}):groups(feed,$('route').value,$('date').value,false,d.id,{branchKey})).filter(g=>g.trips.length&&(!generic||selectedDays==='all'||g.title.toLowerCase()===selectedDays))})).filter(d=>d.groups.length);
  $('day-key').hidden=!generic||!current.some(d=>d.groups.some(g=>g.trips.some(t=>t.dayMarker)));
  const jumpLinks=skip=>current.map((d,i)=>i===skip?'':`<a href="#direction-${i}">${esc(d.label)} ${i<skip?'↑':'↓'}</a>`).join('');
  $('direction-jumps').innerHTML=jumpLinks(-1);$('direction-jumps').hidden=current.length<2;
  let count=0,groupCount=0;applyTheme();
  $('schedule').innerHTML=current.map((d,index)=>{
    const links=jumpLinks(index)+'<a href="#timetable-top">Back to top ↑</a>';
    return d.groups.map((g,groupIndex)=>{
      const title=g.generic?g.title:human($('date').value);groupCount++;
      const subtitle=g.generic?routeName()+' / Typical service':routeName();
      const panels=g.sections.flatMap(section=>{
        count+=section.table.columns.length;
        let offset=0;
        const tables=splitPanel(panelData(section.table),availableTableWidth()).map(part=>{
          const t=pruneTable(section.table,section.table.columns.slice(offset,offset+part.trips.length));offset+=part.trips.length;return t;
        });
        return tables.map((t,p)=>{
          const size=tableSize(panelData(t));
          return {width:size.width+19,html:'<section class="trip-panel" style="--table-width:'+size.width+'px;--station-width:'+size.stationWidth+'px">'+panelHTML({...section,label:d.label},t,t.columns,p,tables.length,title)+'</section>'};
        });
      });
      const width=Math.max(...panels.map(p=>p.width+26),400);
      return '<section class="day-group'+(panels.length>1?' multi-panel':'')+'" '+(groupIndex===0?'id="direction-'+index+'" tabindex="-1"':'')+' style="--group-width:'+width+'px"><div class="group-title"><strong>'+esc(d.label)+' · '+esc(title)+'</strong><span>'+esc(subtitle)+'</span></div><div class="panel-deck">'+panels.map(p=>p.html).join('')+'</div><nav class="group-links" aria-label="Jump from '+esc(d.label)+'">'+links+'</nav></section>';
    }).join('');
  }).join('')||'<div class="empty">No scheduled trips for this selection. Try another date, direction or branch.</div>';
  $('preview-label').textContent=routeName();$('stats').textContent=`${groupCount} service groups · ${count} trips`;$('csv').disabled=!count||busy;$('print').disabled=!count||busy;
}
async function loadSelection(mode,route){if(busy||!feed?.feedId)return;setBusy(true);message('Loading schedule…');try{setFeed(await local.request('select',{id:feed.feedId,mode,route}));}catch(e){if(feed.loadedRoute)$('route').value=feed.loadedRoute;message(e.message,true);}finally{setBusy(false);render();}}
async function importGTFS(file){
  if(busy){message('Please wait for the current import to finish.');return;}
  try{file=importFileFrom([file]);}catch(e){message(e.message,true);return;}
  setBusy(true);message('Reading and validating your GTFS feed…');
  try{const buffer=await file.arrayBuffer();setFeed(await local.request('import',{mode:feed?.mode||'train',buffer},[buffer]));}catch(err){message(err.message,true);}finally{$('file').value='';setBusy(false);if(feed)render();}
}
$('file').addEventListener('change',e=>{if(e.target.files[0])importGTFS(e.target.files[0]);});
installFileDrop(window,{onFile:file=>importGTFS(file),onDragChange:active=>{$('drop-overlay').hidden=!active;document.body.classList.toggle('file-drag',active);},onError:text=>message(text,true)});
$('demo').onclick=async()=>{if(busy)return;setBusy(true);try{setFeed(await local.request('demo'));}catch(e){message(e.message,true);}finally{setBusy(false);if(feed)render();}};
for(const b of $('mode').querySelectorAll('button'))b.onclick=()=>loadSelection(b.dataset.mode);
$('route').onchange=()=>{if(feed.mode==='bus'&&feed.loadedRoute!==$('route').value)loadSelection('bus',$('route').value);else{directions();branches();render();}};
$('inbound').onchange=()=>{inboundOverrides.set(routeIdentity(),$('inbound').value);directions();render();};
for(const id of ['date','group','generic-days','direction','format','branches'])$(id).onchange=render;
let layoutWidth=0,layoutFrame;
new ResizeObserver(entries=>{
  const width=entries[0].contentRect.width;
  if(Math.abs(width-layoutWidth)<1)return;
  layoutWidth=width;cancelAnimationFrame(layoutFrame);layoutFrame=requestAnimationFrame(render);
}).observe($('schedule'));
let previewURL;
$('pdf-close').onclick=()=>$('pdf-preview').close();
$('print').onclick=async()=>{
  if(busy)return;
  const panels=[];
  for(const d of current)for(const g of d.groups)for(const section of g.sections){
    panels.push({...panelData(section.table),heading:d.label+' · '+(g.generic?g.title:human($('date').value)),branch:section.branchLabel||'',number:1,total:1});
  }
  setBusy(true);message('Rendering PDF preview…');
  try{
    const bytes=await local.request('pdf',{title:routeName(),color:selectedRoute()?.route_color,stationLabel:feed.mode==='bus'?'STOP':'STATION',panels});
    const blob=new Blob([bytes],{type:'application/pdf'});if(previewURL)URL.revokeObjectURL(previewURL);previewURL=URL.createObjectURL(blob);
    $('pdf-frame').src=previewURL;$('pdf-open').href=previewURL;$('pdf-preview').showModal();message('');
  }catch(error){message(error.message,true);}finally{setBusy(false);render();}
};
$('csv').onclick=()=>{
  const rows=[];
  for(const d of current)for(const g of d.groups)for(const section of g.sections)for(const t of tablePanels(section.table)){
    rows.push([routeName(),g.generic?g.title:g.dates.join(' / '),d.label,$('branch-field').hidden?'':$('branches').selectedOptions[0].textContent]);
    rows.push(['Stop',...t.columns.map(c=>trainLabel(c.trip))]);
    if(t.columns.some(c=>c.trip.service_variant))rows.push(['Variant',...t.columns.map(c=>c.trip.service_variant||'')]);
    if(g.generic)rows.push(['Operating days',...t.columns.map(c=>c.trip.dayDescription||'')]);
    if(feed.mode==='bus'&&$('branches').value==='')rows.push(['Branch',...t.columns.map(c=>branchTag(c.trip,selectedRoute()))]);
    t.stations.forEach((st,i)=>rows.push([st.name,...t.columns.map(c=>timeText(c.cells[i]))]));rows.push([]);
  }
  const safe=v=>{v=String(v??'');return /^[=+@\-\t\r]/.test(v)?"'"+v:v;};const text='\uFEFF'+rows.map(r=>r.map(v=>'"'+safe(v).replaceAll('"','""')+'"').join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`timetable-${$('date').value}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('demo').click();
