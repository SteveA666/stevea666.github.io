import {routeMode} from './modes.mjs';
export const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export function activeServices(feed, date) {
  const key = date.replaceAll('-', ''), day = dayNames[new Date(date + 'T12:00:00Z').getUTCDay()].toLowerCase();
  const ids = new Set(feed.calendar.filter(c => c.start_date <= key && c.end_date >= key && c[day] === '1').map(c => c.service_id));
  for (const e of feed.exceptions) if (e.date === key) { if (e.exception_type === '1') ids.add(e.service_id); else if (e.exception_type === '2') ids.delete(e.service_id); }
  return ids;
}
export function seconds(time) { if (!/^\d{1,3}:\d{2}:\d{2}$/.test(time || '')) return Infinity; const [h,m,s] = time.split(':').map(Number); return m < 60 && s < 60 ? h*3600+m*60+s : Infinity; }
export function clock(time, twelve = false, serviceHours = false) {
  if (!Number.isFinite(seconds(time))) return '';
  const [h,m] = time.split(':').map(Number);
  const offset = h >= 24 && !serviceHours ? `+${Math.floor(h/24)}` : '';
  return twelve ? `${h%12 || 12}:${String(m).padStart(2,'0')}${h%24 < 12 ? 'a' : 'p'}${offset}` : `${String(serviceHours ? h : h%24).padStart(2,'0')}:${String(m).padStart(2,'0')}${offset}`;
}
export const trainLabel = trip => trip.train_number || trip.trip_short_name || trip.trip_id;
export function initialDate(feed, selected) {
  const key = (selected || '').replaceAll('-', '');
  if (key && (!feed.firstDate || key >= feed.firstDate) && (!feed.lastDate || key <= feed.lastDate)) return selected;
  const d = key && feed.lastDate && key > feed.lastDate ? feed.lastDate : feed.firstDate;
  return d ? `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` : selected;
}
function tripSignature(t) {
  // Compare public service, not internal trip/service IDs that can change every date.
  return JSON.stringify([t.direction_id || 'unknown', t.train_number || t.trip_short_name || '', t.trip_headsign || '', t.route_variant || '',t.service_variant || '',
    t.times.map(s => [s.station,s.arrival_time || '',s.departure_time || '',s.pickup_type || '0',s.drop_off_type || '0',s.timepoint || '1'])]);
}
function subsequence(a,b) { let i=0; for (const s of b) if (s===a[i]) i++; return i===a.length; }
export function hasPassengerJourney(t) {return new Set(t.times.filter(s=>!(s.pickup_type==='1'&&s.drop_off_type==='1')).map(s=>s.station)).size>=2;}
function stationSequence(t) {return t.times.map(s=>s.station).filter((s,i,a)=>i===0 || s!==a[i-1]);}
function isRail(feed,routeId) {return feed.mode==='train'||routeMode(feed.routes?.find(r=>r.route_id===routeId))==='train';}
function tripPath(feed,trip) {
  const path=feed.paths?.[trip.route_id]?.[trip.shape_id],ids=stationSequence(trip);
  if(!path||!subsequence(ids,path))return null;
  return path.slice(path.indexOf(ids[0]),path.lastIndexOf(ids.at(-1))+1);
}
function completePath(ids,patterns) {
  const complete=ids.length?[ids[0]]:[];
  for(let i=1;i<ids.length;i++) {
    const a=ids[i-1],b=ids[i],segments=[];
    for(const p of patterns)for(let start=0;start<p.length;start++)if(p[start]===a){const end=p.indexOf(b,start+1);if(end>=0)segments.push(p.slice(start,end+1));}
    const unique=[...new Map(segments.map(p=>[JSON.stringify(p),p])).values()];
    const maximal=unique.filter(p=>!unique.some(q=>q.length>p.length&&subsequence(p,q)));
    const reference=[...maximal].sort((a,b)=>b.length-a.length)[0];
    // Only common intermediate stations are safe when the gap has alternative paths.
    const via=reference?reference.slice(1,-1).filter(id=>maximal.every(p=>p.includes(id))):[];
    complete.push(...via,b);
  }
  return complete;
}
function busCorridorPath(feed,trip,allTrips) {
  const ids=stationSequence(trip);
  // An express can use a highway between common calls. Compare the entire
  // calling pattern, rather than requiring it to pass each local stop's curb.
  // Incompatible branches cannot supply stops, and alternative maximal
  // corridors contribute only their common stops.
  let compatible=allTrips.filter(t=>t.route_id===trip.route_id&&t.direction_id===trip.direction_id&&subsequence(ids,stationSequence(t)));
  const sameShape=trip.shape_id?compatible.filter(t=>t.shape_id===trip.shape_id):[];
  if(sameShape.some(t=>stationSequence(t).length>ids.length))compatible=sameShape;
  const candidates=compatible.map(stationSequence);
  const corridor=completePath(ids,candidates);
  const physical=tripPath(feed,trip);
  let result=physical?mergeSequence(corridor,physical):corridor;
  // A highway express can have its own access stops, so its whole calling
  // pattern need not be a subset of the local. Match shared anchors instead.
  // Require an established shared corridor and a substantially denser local
  // segment; two alternative branches alone are not evidence of an express.
  if(new Set(ids).size!==ids.length||sameShape.some(t=>stationSequence(t).length>ids.length))return result;
  const gaps=new Map();
  for(const reference of allTrips){
    if(reference.route_id!==trip.route_id||reference.direction_id!==trip.direction_id)continue;
    const local=stationSequence(reference);
    if(new Set(local).size!==local.length)continue;
    const shared=ids.filter(id=>local.includes(id));
    if(shared.length<3||!subsequence(shared,local))continue;
    for(let i=1;i<shared.length;i++){
      const a=shared[i-1],b=shared[i],start=local.indexOf(a),end=local.indexOf(b);
      const skipped=end-start-1,access=ids.indexOf(b)-ids.indexOf(a)-1;
      if(skipped<3||skipped<2*(access+1))continue;
      const key=JSON.stringify([a,b]);
      if(!gaps.has(key))gaps.set(key,{a,b,paths:[]});
      const paths=gaps.get(key).paths,segment=local.slice(start,end+1);
      if(!paths.some(p=>JSON.stringify(p)===JSON.stringify(segment)))paths.push(segment);
    }
  }
  for(const {a,b,paths}of gaps.values())result=mergeSequence(result,completePath([a,b],paths));
  return result;
}
function mergeSequence(a,b) {
  // A shortest common supersequence preserves both paths, including repeated stops on loops.
  const lengths=Array.from({length:a.length+1},()=>new Uint32Array(b.length+1));
  for(let i=a.length-1;i>=0;i--) for(let j=b.length-1;j>=0;j--) lengths[i][j]=a[i]===b[j]?1+lengths[i+1][j+1]:Math.max(lengths[i+1][j],lengths[i][j+1]);
  const merged=[];let i=0,j=0;
  while(i<a.length && j<b.length) {
    if(a[i]===b[j]) {merged.push(a[i]);i++;j++;}
    else if(lengths[i+1][j]>lengths[i][j+1]||(lengths[i+1][j]===lengths[i][j+1]&&a.length-i<=b.length-j)) merged.push(a[i++]); else merged.push(b[j++]);
  }
  return merged.concat(a.slice(i),b.slice(j));
}
function align(ids,ordered) {let cursor=0;return ids.map(id=>{const index=ordered.indexOf(id,cursor);cursor=index+1;return index;});}
export function pruneTable(t,columns=t.columns,keepPassing=false) {
  const keep=t.stations.map((_,i)=>i).filter(i=>columns.some(c=>c.cells[i].kind!=='blank'&&(keepPassing||c.cells[i].kind!=='pass')));
  return {...t,stations:keep.map(i=>t.stations[i]),columns:columns.map(c=>({...c,cells:keep.map(i=>c.cells[i])}))};
}
export function tablePanels(t) {
  const panels=[];
  for(let i=0;i<t.columns.length;i+=10) panels.push(pruneTable(t,t.columns.slice(i,i+10)));
  return panels;
}
export function table(feed, trips, allTrips = trips) {
  const names = new Map(feed.stops.map(s => [s.stop_id,s.stop_name]));
  const patterns = [...new Map(allTrips.map(t => {const p={ids:tripPath(feed,t)||stationSequence(t),shape:t.shape_id,direction:t.direction_id,variant:t.route_variant};return [JSON.stringify([p.shape,p.direction,p.variant,p.ids]),p];})).values()];
  const completed=new Map(trips.map(t=>[t,isRail(feed,t.route_id)?tripPath(feed,t)||completePath(stationSequence(t),patterns.map(p=>p.ids)):busCorridorPath(feed,t,allTrips)]));
  const references = patterns.filter(p=>trips.some(t=>subsequence(stationSequence(t),p.ids)));
  let ordered=[];
  for(const p of [...references].sort((a,b)=>b.ids.length-a.ids.length)) ordered=mergeSequence(ordered,p.ids);
  for(const t of trips) if(!subsequence(completed.get(t),ordered)) ordered=mergeSequence(ordered,completed.get(t));
  const sortStation = ordered.find(id => trips.every(t => t.times.some(s => s.station === id && Number.isFinite(seconds(s.departure_time || s.arrival_time)))));
  const sortTime = t => {const stop=t.times.find(s => s.station === sortStation) || t.times[0]; return seconds(stop?.departure_time || stop?.arrival_time);};
  const sorted=[...trips].sort((a,b)=>sortTime(a)-sortTime(b) || a.trip_id.localeCompare(b.trip_id));
  const columns=sorted.map(t=> {
    const ids=stationSequence(t), positions=align(ids,ordered), calls=new Map();let visit=-1,previous;
    for(const stop of t.times) {if(stop.station!==previous) visit++;calls.set(positions[visit],stop);previous=stop.station;}
    const passingRows=new Set(align(completed.get(t),ordered));
    return { trip:t, cells:ordered.map((id,row)=> {
      if(calls.has(row)) { const s=calls.get(row); return s.pickup_type==='1' && s.drop_off_type==='1' ? {kind:'pass'} : {kind:'time',time:row === positions.at(-1) ? s.arrival_time || s.departure_time : s.departure_time || s.arrival_time,estimated:s.timepoint==='0'}; }
      const passes=ids.length>1 && row>positions[0] && row<positions.at(-1) && passingRows.has(row);
      return {kind:passes?'pass':'blank'};
    })};
  });
  const profile=trips[0]&&isRail(feed,trips[0].route_id)?railProfile(feed,trips[0].route_id):null;
  return pruneTable({ stations:ordered.map(id=>({id,name:names.get(id)||id,...(profile?.stationBranches.get(id)||{})})), columns, sortStation:sortStation ? names.get(sortStation) || sortStation : '' },columns,true);
}
export function branchTag(trip,route={}) {
  const short=String(route.route_short_name||'').trim(),base=short.replace(/\s+/g,'').toUpperCase();
  const compact=value=>/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/i.test(value)&&value.length<=12;
  const fits=code=>{
    const text=code.toUpperCase();if(!base||!compact(base))return false;
    if(text===base)return true;
    const suffix=text.startsWith(base)?text.slice(base.length):'';
    return !!suffix&&(/^(?:[A-Z]{1,3}|[-/][A-Z0-9]{1,5})$/.test(suffix)||/[A-Z]$/.test(base)&&/^\d{1,3}[A-Z]{0,2}$/.test(suffix));
  };
  const explicit=String(trip.route_variant||'').trim();
  // Only structured codes may be used as header annotations. Destinations,
  // directions and free-form variant descriptions belong in tooltips.
  if(compact(explicit)&&(fits(explicit)||/\d/.test(explicit)||/^[A-Z]{1,3}$/.test(explicit)))return explicit;
  for(const text of [explicit,trip.trip_headsign||'']){
    const codes=text.match(/[a-z0-9]+(?:[-/][a-z0-9]+)*/gi)||[];
    const found=codes.find(code=>fits(code)&&compact(code));if(found)return found;
  }
  const variant=String(trip.service_variant||'').trim();
  if(/^[a-z]{1,3}$/i.test(variant))return base&&compact(base+variant)?base+variant:variant;
  return '';
}
export function branchInfo(trip) {
  if(trip.route_variant?.trim()) return {key:trip.route_variant.trim(),label:trip.route_variant.trim()};
  const ids=stationSequence(trip),forward=JSON.stringify(ids),reverse=JSON.stringify([...ids].reverse());
  return {key:'pattern:'+(forward<reverse?forward:reverse),label:trip.trip_headsign || 'Branch'};
}
function railTopology(feed,trips) {
  const stops=new Map(feed.stops.map(s=>[s.stop_id,s])),used=new Set(trips.flatMap(t=>stationSequence(t))),aliases=new Map(),groups=new Map();
  const distance=(a,b)=>{
    if(!a||!b||[a.stop_lat,a.stop_lon,b.stop_lat,b.stop_lon].some(v=>v==null||v===''||!Number.isFinite(Number(v))))return Infinity;
    return Math.hypot((Number(a.stop_lat)-Number(b.stop_lat))*111320,(Number(a.stop_lon)-Number(b.stop_lon))*111320*Math.cos(Number(a.stop_lat)*Math.PI/180));
  };
  const stationKey=name=>String(name||'').toLowerCase().replace(/\s+(north|south|east|west)\s+side\b/g,'').replace(/\blower\s+/g,'').trim().split(/\s+at\s+/).sort().join(' at ');
  for(const id of used){
    const stop=stops.get(id),key=stationKey(stop?.stop_name),candidates=groups.get(key)||[];
    const match=candidates.find(other=>distance(stop,stops.get(other))<=150);
    aliases.set(id,match||id);if(!match){candidates.push(id);groups.set(key,candidates);}
  }
  const mapped=ids=>ids.map(id=>aliases.get(id)||id).filter((id,i,a)=>!i||id!==a[i-1]);
  const sequences=[...new Map(trips.map(t=>{const ids=mapped(stationSequence(t));return [JSON.stringify(ids),ids];})).values()];
  for(const id of used){
    if(!/\b(loop|turnback|turnaround)\b/i.test(stops.get(id)?.stop_name||''))continue;
    if(trips.some(t=>stationSequence(t).slice(1,-1).includes(id)))continue;
    const neighbors=new Set(trips.flatMap(t=>{const ids=stationSequence(t);return [ids[0]===id?ids[1]:null,ids.at(-1)===id?ids.at(-2):null].filter(Boolean);}));
    const matches=[...neighbors].filter(n=>distance(stops.get(id),stops.get(n))<=300&&sequences.some(ids=>ids.slice(1,-1).includes(aliases.get(n)||n)));
    const targets=[...new Set(matches.map(n=>aliases.get(n)||n))];
    // Only a terminal-only loop next to a through stop is a short-turn facility.
    if(targets.length===1)aliases.set(id,targets[0]);
  }
  return {ids:mapped,aliases};
}
const railProfiles=new WeakMap();
function railProfile(feed,routeId) {
  if(!railProfiles.has(feed))railProfiles.set(feed,new Map());
  const cache=railProfiles.get(feed);if(cache.has(routeId))return cache.get(routeId);
  const trips=feed.trips.filter(t=>t.route_id===routeId&&hasPassengerJourney(t)),names=new Map(feed.stops.map(s=>[s.stop_id,s.stop_name]));
  const topology=railTopology(feed,trips);
  const base=[...new Map(trips.map(t=>{const path=tripPath(feed,t),ids=topology.ids(path||stationSequence(t));return [JSON.stringify(ids),{ids,physical:!!path,shape:t.shape_id}];})).values()];
  const sequences=base.map(p=>p.ids);
  const expanded=base.map(p=>p.physical?p.ids:completePath(p.ids,sequences.concat(sequences.map(p=>[...p].reverse()))));
  const canonical=p=>{const r=[...p].reverse();return JSON.stringify(p)<JSON.stringify(r)?p:r;};
  const unique=[...new Map(expanded.map(p=>{p=canonical(p);return [JSON.stringify(p),p];})).values()];
  // Terminal loops, platform order and short turns can change sequence without
  // creating a new geographic branch. A branch needs its own station territory.
  const territories=unique.map(ids=>new Set(ids));
  const maximal=unique.filter((p,i)=>!territories.some((other,j)=>j!==i&&
    [...territories[i]].every(id=>other.has(id))&&
    (other.size>territories[i].size||other.size===territories[i].size&&j<i)));
  const route=feed.routes.find(r=>r.route_id===routeId),surface=[0,5].includes(Number(route?.route_type))||(Number(route?.route_type)>=900&&Number(route?.route_type)<1000);
  const tolerance=surface?80:200,geometry=feed.shapeGeometry||{},checks=new Map();
  const containsShape=(a,b)=>{
    const key=JSON.stringify([a,b]);if(checks.has(key))return checks.get(key);
    const source=geometry[a],target=geometry[b];if(!source?.length||!target?.length)return false;
    const within=source.every(([lat,lon])=>{
      const scale=Math.cos(lat*Math.PI/180)*111320;
      for(let i=1;i<target.length;i++){
        const ax=(target[i-1][1]-lon)*scale,ay=(target[i-1][0]-lat)*111320;
        const dx=(target[i][1]-target[i-1][1])*scale,dy=(target[i][0]-target[i-1][0])*111320;
        const denominator=dx*dx+dy*dy,t=denominator?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/denominator)):0;
        if((ax+t*dx)**2+(ay+t*dy)**2<=tolerance*tolerance)return true;
      }
      return false;
    });checks.set(key,within);return within;
  };
  const shapesByPath=new Map();
  expanded.forEach((ids,i)=>{const key=JSON.stringify(canonical(ids));if(!shapesByPath.has(key))shapesByPath.set(key,new Set());if(base[i].shape)shapesByPath.get(key).add(base[i].shape);});
  const candidates=maximal.map(ids=>({ids,shapes:[...(shapesByPath.get(JSON.stringify(ids))||[])]}));
  const merged=[];
  for(const candidate of candidates){
    const same=merged.find(other=>candidate.shapes.some(a=>other.shapes.some(b=>containsShape(a,b)&&containsShape(b,a))));
    if(same){same.ids=mergeSequence(same.ids,candidate.ids);same.shapes.push(...candidate.shapes);}else merged.push(candidate);
  }
  const corridors=merged.filter((c,i)=>!merged.some((other,j)=>i!==j&&other.ids.length>c.ids.length&&
    (c.ids.every(id=>other.ids.includes(id))||c.shapes.some(a=>other.shapes.some(b=>containsShape(a,b)&&!containsShape(b,a))))))
    .map(c=>({...c,key:'rail:'+JSON.stringify(c.ids)}));
  const common=corridors.length?corridors[0].ids.filter(id=>corridors.every(c=>c.ids.includes(id))):[];
  const shared=[...topology.aliases].filter(([id,key])=>common.includes(key)).map(([id])=>id);
  const stationBranches=new Map();
  for(const c of corridors) {
    let uniqueIds=c.ids.filter(id=>!corridors.some(other=>other!==c&&other.ids.includes(id)));
    if(common.includes(c.ids.at(-1)))uniqueIds.reverse();
    c.label=[uniqueIds[0],uniqueIds.at(-1)].filter((id,i,a)=>id&&a.indexOf(id)===i).map(id=>names.get(id)||id).join(' / ')||'Shared corridor';
    if(corridors.length>1)for(const [id,key]of topology.aliases)if(uniqueIds.includes(key))stationBranches.set(id,{branch:c.key,branchLabel:c.label});
  }
  const keyForTrip=t=>{
    const path=topology.ids(tripPath(feed,t)||stationSequence(t)),matches=corridors.filter(c=>path.every(id=>c.ids.includes(id))||c.shapes.some(shape=>containsShape(t.shape_id,shape)));
    return matches.length===1?matches[0].key:'rail:shared';
  };
  const present=new Set(trips.map(keyForTrip));
  const options=corridors.length>1?corridors.filter(c=>present.has(c.key)).map(c=>({key:c.key,label:c.label})):[];
  if(options.length&&shared.length)options.push({key:'rail:shared',label:'Shared trunk'});
  options.sort((a,b)=>a.label.localeCompare(b.label));
  const result={corridors,shared,stationBranches,options,keyForTrip};cache.set(routeId,result);return result;
}
function tripBranchKey(feed,routeId,t) {return isRail(feed,routeId)?railProfile(feed,routeId).keyForTrip(t):branchInfo(t).key;}
function matchesBranch(feed,routeId,trip,key) {
  if(!key)return true;
  if(isRail(feed,routeId)&&key==='rail:shared') {
    const territory=new Set(railProfile(feed,routeId).shared);
    return (tripPath(feed,trip)||stationSequence(trip)).some(id=>territory.has(id));
  }
  return tripBranchKey(feed,routeId,trip)===key;
}
function territoryTable(t,ids) {
  const allowed=new Set(ids),keep=t.stations.map((s,i)=>allowed.has(s.id)?i:-1).filter(i=>i>=0);
  const stations=keep.map(i=>t.stations[i]),columns=t.columns.map(c=>({...c,cells:keep.map(i=>c.cells[i])}));
  const anchor=stations.findIndex((_,i)=>columns.every(c=>c.cells[i].kind==='time'&&Number.isFinite(seconds(c.cells[i].time))));
  const sortTime=c=>anchor>=0?seconds(c.cells[anchor].time):Math.min(...c.cells.filter(s=>s.kind==='time').map(s=>seconds(s.time)));
  columns.sort((a,b)=>sortTime(a)-sortTime(b)||a.trip.trip_id.localeCompare(b.trip.trip_id));
  return pruneTable({stations,columns,sortStation:anchor>=0?stations[anchor].name:''},columns,true);
}
export function branchOptions(feed,routeId) {
  if(isRail(feed,routeId))return railProfile(feed,routeId).options;
  const trips=feed.trips.filter(t=>t.route_id===routeId&&hasPassengerJourney(t)),names=new Map(feed.stops.map(s=>[s.stop_id,s.stop_name]));
  const options=[...new Map(trips.map(t=>{const info=branchInfo(t);const endpoints=[names.get(t.times[0]?.station)||t.times[0]?.station,names.get(t.times.at(-1)?.station)||t.times.at(-1)?.station].filter(Boolean).sort();return [info.key,{key:info.key,label:t.route_variant?.trim() || endpoints.join(' ↔ ')}];})).values()];
  const counts=new Map();for(const o of options)counts.set(o.label,(counts.get(o.label)||0)+1);
  options.forEach((o,i)=>{if(counts.get(o.label)>1)o.label+=` · Pattern ${i+1}`;});
  return options.sort((a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true}));
}
export function directionChoices(feed,routeId) {
  const trips=feed.trips.filter(t=>t.route_id===routeId&&hasPassengerJourney(t)),stops=new Map(feed.stops.map(s=>[s.stop_id,s]));
  const trunk=isRail(feed,routeId)?railProfile(feed,routeId).shared:[];
  const vectors=trips.map(t=>{
    const ids=stationSequence(t),common=trunk.length>1?ids.filter(id=>trunk.includes(id)):ids;
    // Use the shared corridor rather than curved or divergent outer branches.
    if(common.length<2)return null;
    const a=stops.get(common[0]),b=stops.get(common.at(-1));
    if(!a||!b||[a.stop_lat,a.stop_lon,b.stop_lat,b.stop_lon].some(v=>v==null||v===''||!Number.isFinite(Number(v))))return null;
    return {trip:t,dx:(Number(b.stop_lon)-Number(a.stop_lon))*Math.cos((Number(a.stop_lat)+Number(b.stop_lat))*Math.PI/360),dy:Number(b.stop_lat)-Number(a.stop_lat)};
  }).filter(Boolean);
  const eastWest=vectors.reduce((s,v)=>s+Math.abs(v.dx),0)>vectors.reduce((s,v)=>s+Math.abs(v.dy),0);
  return [...new Set(trips.map(t=>t.direction_id||'unknown'))].sort().map(id=>{
    const selected=trips.filter(t=>(t.direction_id||'unknown')===id);
    const explicit=selected.map(t=>t.trip_headsign?.match(/\b(northbound|southbound|eastbound|westbound|inbound|outbound)\b/i)?.[1]?.toLowerCase()).filter(Boolean);
    const unique=[...new Set(explicit)];let label;
    if(unique.length===1)label=unique[0][0].toUpperCase()+unique[0].slice(1);
    if(!label){const vector=vectors.filter(v=>(v.trip.direction_id||'unknown')===id).reduce((s,v)=>s+(eastWest?v.dx:v.dy),0);if(Math.abs(vector)>.00001)label=eastWest?(vector>0?'Eastbound':'Westbound'):(vector>0?'Northbound':'Southbound');}
    if(!label){const destinations=[...new Set(selected.map(t=>stops.get(t.times.at(-1).station)?.stop_name||t.trip_headsign).filter(Boolean))];label=destinations.length===1?`Toward ${destinations[0]}`:id==='unknown'?'Direction unspecified':`Direction ${id}`;}
    return {id,label};
  });
}
function sections(feed,routeId,trips,options) {
  const frequencies=new Set(feed.frequencies.map(f=>f.trip_id));
  return [...new Set(trips.map(t=>t.direction_id||'unknown'))].sort().flatMap(dir=> {
    const selected=trips.filter(t=>(t.direction_id||'unknown')===dir);
    const pool=feed.trips.filter(t=>t.route_id===routeId && hasPassengerJourney(t) && (t.direction_id||'unknown')===dir && !frequencies.has(t.trip_id) && matchesBranch(feed,routeId,t,options.branchKey));
    const branches=options.branches==='separate'?[...new Set(selected.map(t=>branchInfo(t).key))]:[null];
    return branches.map((branch,index)=> {
      const calls=branch===null?selected:selected.filter(t=>branchInfo(t).key===branch);
      const all=branch===null?pool:pool.filter(t=>branchInfo(t).key===branch);
      const headsigns=[...new Set(calls.map(t=>t.trip_headsign).filter(Boolean))];
      const label=headsigns.length===1?headsigns[0]:dir==='unknown'?'Direction unspecified':`Direction ${dir}`;
      const info=branchInfo(calls[0]);
      const full=table(feed,calls,all);
      const timetable=isRail(feed,routeId)&&options.branchKey==='rail:shared'?territoryTable(full,railProfile(feed,routeId).shared):full;
      return {direction:dir,branch,branchLabel:branch===null?'':calls[0].route_variant || `${info.label} · Pattern ${index+1}`,label,table:timetable};
    });
  });
}
export function groups(feed, routeId, date, week=false, direction='all',options={}) {
  const base=new Date(date+'T12:00:00Z');
  if (week) base.setUTCDate(base.getUTCDate()-((base.getUTCDay()+6)%7));
  const buckets=new Map(), frequencyIds=new Set(feed.frequencies.map(f=>f.trip_id));
  for(let i=0;i<(week?7:1);i++) {
    const d=new Date(base); d.setUTCDate(d.getUTCDate()+i); const iso=d.toISOString().slice(0,10), active=activeServices(feed,iso);
    const trips=feed.trips.filter(t=>t.route_id===routeId && active.has(t.service_id) && !frequencyIds.has(t.trip_id) && hasPassengerJourney(t) && (direction==='all' || (t.direction_id||'unknown')===direction) && matchesBranch(feed,routeId,t,options.branchKey));
    const key=JSON.stringify(trips.map(tripSignature).sort());
    if(!buckets.has(key)) buckets.set(key,{dates:[],trips}); buckets.get(key).dates.push(iso);
  }
  return [...buckets.values()].map(b=>({...b,sections:sections(feed,routeId,b.trips,options)}));
}

const DAY_CODES=['Su','M','Tu','W','Th','F','Sa'];
export function operatingDayMarker(days,category) {
  const ordered=category.filter(d=>days.includes(d));
  if(ordered.length===category.length)return '';
  if(ordered.length>2&&ordered.every((d,i)=>!i||d===ordered[i-1]+1))return `${DAY_CODES[ordered[0]]}–${DAY_CODES[ordered.at(-1)]}`;
  return ordered.map(d=>DAY_CODES[d]).join('/');
}
function shiftDate(date,days){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function serviceBounds(feed) {
  const dates=[...feed.calendar.flatMap(c=>[c.start_date,c.end_date]),...feed.exceptions.map(e=>e.date)].filter(Boolean).sort();
  const iso=d=>`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
  return dates.length?[iso(dates[0]),iso(dates.at(-1))]:[null,null];
}
function bag(trips) {const counts=new Map();for(const t of trips){const key=tripSignature(t);counts.set(key,(counts.get(key)||0)+1);}return counts;}
function similarity(a,b) {
  let common=0,total=0;for(const key of new Set([...a.keys(),...b.keys()])){common+=Math.min(a.get(key)||0,b.get(key)||0);total+=Math.max(a.get(key)||0,b.get(key)||0);}return total?common/total:1;
}
function normalDay(samples,anchor) {
  const running=samples.filter(s=>s.trips.length);
  // Repeated running service is evidence against a full closure being the normal timetable.
  const candidates=running.length>=2?running:samples;
  if(!candidates.length)return {trips:[],ignored:[],dates:[]};
  const ranked=candidates.map(s=>({...s,score:candidates.reduce((sum,x)=>sum+similarity(s.bag,x.bag),0)})).sort((a,b)=>b.score-a.score||Math.abs(Date.parse(a.date)-Date.parse(anchor))-Math.abs(Date.parse(b.date)-Date.parse(anchor))||a.date.localeCompare(b.date));
  const center=ranked[0];
  const cohort=candidates.filter(s=>similarity(center.bag,s.bag)>=.8).sort((a,b)=>Math.abs(Date.parse(a.date)-Date.parse(anchor))-Math.abs(Date.parse(b.date)-Date.parse(anchor)));
  const keys=new Set(cohort.flatMap(s=>[...s.bag.keys()])),trips=[];
  for(const key of keys) {
    const counts=cohort.map(s=>s.bag.get(key)||0).sort((a,b)=>a-b);
    const count=counts[Math.floor((counts.length-1)/2)];
    if(!count)continue;
    const source=cohort.find(s=>(s.bag.get(key)||0)>=count);
    if(source)trips.push(...source.byKey.get(key).slice(0,count));
  }
  // A regularly running public train must not disappear when its two timing variants tie.
  const publicId=t=>{const n=t.train_number||t.trip_short_name;return n?JSON.stringify([t.direction_id||'unknown',t.route_variant||'',n]):null;};
  const selected=new Set(trips.map(publicId).filter(Boolean)),identities=new Map();
  for(const sample of cohort)for(const id of new Set(sample.trips.map(publicId).filter(Boolean)))identities.set(id,(identities.get(id)||0)+1);
  for(const [id,count]of identities)if(count>cohort.length/2&&!selected.has(id)){const trip=cohort.flatMap(s=>s.trips).find(t=>publicId(t)===id);if(trip)trips.push(trip);}
  const expected=bag(trips);
  return {trips,dates:cohort.map(s=>s.date),ignored:samples.filter(s=>similarity(expected,s.bag)<1).map(s=>s.date)};
}

export function genericGroups(feed,routeId,date,direction='all',options={}) {
  const frequencies=new Set(feed.frequencies.map(f=>f.trip_id));
  const pool=feed.trips.filter(t=>t.route_id===routeId&&hasPassengerJourney(t)&&!frequencies.has(t.trip_id)&&(direction==='all'||(t.direction_id||'unknown')===direction)&&matchesBranch(feed,routeId,t,options.branchKey));
  const [first,last]=serviceBounds(feed),start=first&&first>shiftDate(date,-28)?first:shiftDate(date,-28),end=last&&last<shiftDate(date,28)?last:shiftDate(date,28);
  const samples=Array.from({length:7},()=>[]);
  for(let day=start;day<=end;day=shiftDate(day,1)) {
    const active=activeServices(feed,day),trips=pool.filter(t=>active.has(t.service_id));
    const byKey=new Map();for(const trip of trips){const key=tripSignature(trip);if(!byKey.has(key))byKey.set(key,[]);byKey.get(key).push(trip);}
    samples[new Date(day+'T12:00:00Z').getUTCDay()].push({date:day,trips,byKey,bag:new Map([...byKey].map(([key,trips])=>[key,trips.length]))});
  }
  const normal=samples.map(s=>normalDay(s,date));
  return [{title:'Weekdays',days:[1,2,3,4,5]},{title:'Weekends',days:[6,0]}].map(category=>{
    const merged=new Map();
    for(const day of category.days) {
      const duplicate=new Map();
      for(const trip of normal[day].trips) {
        const key=tripSignature(trip),ordinal=duplicate.get(key)||0;duplicate.set(key,ordinal+1);
        const identity=JSON.stringify([key,ordinal]);
        if(!merged.has(identity))merged.set(identity,{trip,days:[]});merged.get(identity).days.push(day);
      }
    }
    const trips=[...merged.values()].map(({trip,days})=>({...trip,operatingDays:days,dayMarker:operatingDayMarker(days,category.days),dayDescription:days.map(d=>dayNames[d]).join(', ')}));
    const dates=[...new Set(category.days.flatMap(d=>normal[d].dates))].sort(),ignoredDates=[...new Set(category.days.flatMap(d=>normal[d].ignored))].sort();
    return {generic:true,title:category.title,dates,trips,sampleStart:start,sampleEnd:end,ignoredDates,sections:trips.length?sections(feed,routeId,trips,options):[]};
  }).filter(g=>g.trips.length);
}
