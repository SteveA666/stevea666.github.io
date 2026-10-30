import {routeMode} from './modes.mjs';
import {goStopHints} from './stop-hints.mjs?v=20261030-station-resolution';

const caches=new WeakMap();
const platform=/\s*(?:[-–]\s*)?(?:(?:north|south|east|west)bound\s+)?(?:(?:subway|lrt|train)\s+)?platform(?:\s+(?!towards?\b)\w+)?(?:\s+towards?\s+.+)?\s*$/i;
const facility=/\b(go|station|terminal|interchange|transit cent(?:re|er)|platform)\b/i;
const clean=name=>String(name||'').normalize('NFKC').toLowerCase().replace(/[.,]/g,'').replace(/\s+/g,' ').trim();
function stationName(name){return String(name||'').replace(platform,'').replace(/\s+(?:bus terminal|bus|rail|train)\s*$/i,'').replace(/\s+GO\s*$/i,'').trim();}
function identityName(stop){
  const name=stop.stop_name||'',reference=name.match(/\(([^()]*(?:GO|station|terminal))\)\s*$/i)?.[1];
  return {key:clean(stationName(reference||name)),reference:!!reference,facility:facility.test(name)};
}
export function stopDistance(a,b){
  if(!a||!b||[a.stop_lat,a.stop_lon,b.stop_lat,b.stop_lon].some(v=>v==null||v===''||!Number.isFinite(Number(v))))return Infinity;
  if([a,b].some(s=>Math.abs(Number(s.stop_lat))>90||Math.abs(Number(s.stop_lon))>180))return Infinity;
  const rad=n=>Number(n)*Math.PI/180,lat=rad(b.stop_lat)-rad(a.stop_lat),lon=rad(b.stop_lon)-rad(a.stop_lon);
  return 12742000*Math.asin(Math.min(1,Math.sqrt(Math.sin(lat/2)**2+Math.cos(rad(a.stop_lat))*Math.cos(rad(b.stop_lat))*Math.sin(lon/2)**2)));
}

// Resolve the complete feed once. Source boarding locations are never rewritten.
export function resolveStations(files,{hints}={}){
  const builtIn=hints===undefined;
  if(builtIn&&caches.has(files))return caches.get(files);
  hints??=files['agency.txt']?.some(a=>a.agency_id==='GO')?goStopHints:[];
  const source=new Map(files['stops.txt'].map(s=>[s.stop_id,{...s}])),unresolved=[],decisions=[];
  const railRoutes=new Set(files['routes.txt'].filter(r=>routeMode(r)==='train').map(r=>r.route_id));
  const railTrips=new Set(files['trips.txt'].filter(t=>railRoutes.has(t.route_id)).map(t=>t.trip_id));
  const railStops=new Set(files['stop_times.txt'].filter(s=>railTrips.has(s.trip_id)).map(s=>s.stop_id));
  const declared=new Set([...source.values()].map(s=>s.parent_station).filter(id=>source.has(id)));
  const roots=new Map();
  for(const id of [...source.keys()].sort()){
    let root=id;const visited=new Set();
    while(source.get(root)?.parent_station){
      const parent=source.get(root).parent_station;
      if(!source.has(parent)){unresolved.push({stopId:id,target:parent,reason:'missing-parent'});break;}
      if(visited.has(parent)||parent===root){unresolved.push({stopId:id,target:parent,reason:'parent-cycle'});root=id;break;}
      const type=source.get(parent).location_type;
      if(type&&type!=='1'&&!(source.get(root).location_type==='4'&&(type==='0'||type===''))){unresolved.push({stopId:id,target:parent,reason:'invalid-parent-type'});break;}
      visited.add(root);root=parent;
    }
    roots.set(id,root);
  }
  const targets=new Set(hints.flatMap(g=>Object.values(g)));
  const rank=id=>source.get(id).location_type==='1'||declared.has(id)?0:railStops.has(id)?1:targets.has(id)?2:3;
  const groups=new Map(),owner=new Map();
  for(const [id,root]of roots){
    if(!groups.has(root))groups.set(root,{id:root,members:[],declared:declared.has(root),reasons:[]});
    groups.get(root).members.push(id);owner.set(id,root);
    if(id!==root){groups.get(root).reasons=['parent-station'];decisions.push({stopId:id,stationId:root,reason:'parent-station'});}
  }
  const merge=(a,b,limit,reason)=>{
    a=groups.get(owner.get(a));b=groups.get(owner.get(b));if(a===b)return true;
    if(a.declared&&b.declared)return false;
    // Complete-link validation prevents A-B-C proximity chains joining distant facilities.
    if(!a.members.every(x=>b.members.every(y=>stopDistance(source.get(x),source.get(y))<=limit)))return false;
    const winner=[a,b].sort((x,y)=>rank(x.id)-rank(y.id)||x.id.localeCompare(y.id))[0],other=winner===a?b:a;
    winner.members.push(...other.members);winner.declared||=other.declared;winner.reasons.push(...other.reasons,reason);
    for(const id of other.members){owner.set(id,winner.id);decisions.push({stopId:id,stationId:winner.id,reason});}
    groups.delete(other.id);return true;
  };
  // Match names in buckets, rather than comparing every pair of stops.
  const buckets=new Map();
  for(const g of [...groups.values()].sort((a,b)=>rank(a.id)-rank(b.id)||a.id.localeCompare(b.id))){
    const info=identityName(source.get(g.id));if(!info.key)continue;
    const candidates=buckets.get(info.key)||[];
    for(const id of candidates){
      const other=identityName(source.get(id));
      const limit=info.reference||other.reference?300:info.facility&&other.facility?300:50;
      if(merge(g.id,id,limit,info.reference||other.reference?'station-reference':'nearby-matching-name'))break;
    }
    candidates.push(g.id);buckets.set(info.key,candidates);
  }
  for(const [index,mapping]of hints.entries())for(const [id,target]of Object.entries(mapping)){
    if(!source.has(id)||!source.has(target)){unresolved.push({stopId:id,target,group:index,reason:'missing-hint-stop'});continue;}
    if(owner.get(id)===owner.get(target))continue;
    if(identityName(source.get(id)).key!==identityName(source.get(target)).key){unresolved.push({stopId:id,target,group:index,reason:'hint-name-conflict'});continue;}
    if(!merge(id,target,600,'validated-station-hint'))unresolved.push({stopId:id,target,group:index,reason:'hint-distance-or-parent-conflict',distance:stopDistance(source.get(id),source.get(target))});
  }
  const aliases=new Map([...owner].filter(([id,root])=>id!==root));
  const result={aliases,source,groups:[...groups.values()].filter(g=>g.members.length>1).map(g=>({...g,members:g.members.sort()})),decisions:decisions.map(d=>({...d,stationId:owner.get(d.stopId)})),unresolved};
  if(builtIn)caches.set(files,result);return result;
}

export function stationView(resolution,selectedStopIds){
  const view=new Map([...resolution.source].map(([id,s])=>[id,{...s}]));
  for(const group of resolution.groups){
    const selected=group.members.filter(id=>selectedStopIds.has(id)),id=group.id;
    const display=selected.includes(id)?id:selected[0]||id;
    view.set(id,{...view.get(id),stop_name:view.get(display).stop_name.replace(platform,''),source_stop_ids:[...group.members]});
  }
  return view;
}
