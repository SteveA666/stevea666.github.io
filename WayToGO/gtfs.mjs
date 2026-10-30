import {resolveStations,stationView} from './station-resolution.mjs?v=20261030-station-resolution';
import {routeMode} from './modes.mjs';
export function csv(text) {
  const rows = []; let row = [], value = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
      row.push(value); value = '';
      if (c !== ',') { if (row.some(Boolean)) rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else value += c;
  }
  if (quoted) throw new Error('Unclosed CSV quotation.');
  row.push(value); if (row.some(Boolean)) rows.push(row);
  const headers = rows.shift() || [];
  return rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

export {routeMode} from './modes.mjs';
const hubCaches=new WeakMap();
function hubRouteCounts(files,stops,mode,aliases=new Map()) {
  if(!hubCaches.has(files))hubCaches.set(files,new Map());
  const cache=hubCaches.get(files);if(cache.has(mode))return cache.get(mode);
  const routes=new Set(files['routes.txt'].filter(r=>routeMode(r)===mode).map(r=>r.route_id));
  const tripRoutes=new Map(files['trips.txt'].filter(t=>routes.has(t.route_id)).map(t=>[t.trip_id,t.route_id]));
  const served=new Map();
  for(const s of files['stop_times.txt']) {
    const route=tripRoutes.get(s.trip_id);if(!route)continue;
    const station=aliases.get(s.stop_id)||s.stop_id;
    if(!served.has(station))served.set(station,new Set());served.get(station).add(route);
  }
  const result=Object.fromEntries([...served].map(([id,routes])=>[id,routes.size]));cache.set(mode,result);return result;
}

function shapePaths(files,routes,trips,stops,geometry) {
  const locations=new Map();
  for(const trip of trips.values())for(const call of trip.times){
    if(!locations.has(call.station))locations.set(call.station,new Map());
    for(const id of call.source_stop_ids||[call.stop_id]){const stop=stops.get(id);if(stop&&[stop.stop_lat,stop.stop_lon].every(v=>v!=null&&v!==''&&Number.isFinite(Number(v))))locations.get(call.station).set(id,stop);}
  }
  const requested=new Set([...trips.values()].filter(t=>t.shape_id).map(t=>t.shape_id));
  const shapes=new Map();
  for(const s of files['shapes.txt']||[])if(requested.has(s.shape_id)) {
    if(!shapes.has(s.shape_id))shapes.set(s.shape_id,[]);
    const lat=Number(s.shape_pt_lat),lon=Number(s.shape_pt_lon),seq=Number(s.shape_pt_sequence);
    if(Number.isFinite(lat)&&Number.isFinite(lon)&&Number.isFinite(seq))shapes.get(s.shape_id).push({lat,lon,seq});
  }
  for(const points of shapes.values())points.sort((a,b)=>a.seq-b.seq);
  const paths={};
  for(const route of routes) {
    const rail=routeMode(route)==='train';
    const surface=[0,5].includes(Number(route.route_type))||(Number(route.route_type)>=900&&Number(route.route_type)<1000);
    const selected=[...trips.values()].filter(t=>t.route_id===route.route_id);
    const ids=new Set(selected.flatMap(t=>t.times.map(s=>s.station)));
    const stations=[...ids].map(id=>stops.get(id)).filter(s=>s&&s.stop_lat!==''&&s.stop_lon!==''&&s.stop_lat!=null&&s.stop_lon!=null&&Number.isFinite(Number(s.stop_lat))&&Number.isFinite(Number(s.stop_lon)));
    const routePaths={};
    for(const shapeId of new Set(selected.map(t=>t.shape_id).filter(Boolean))) {
      const points=shapes.get(shapeId);if(!points||points.length<2)continue;
      if(rail&&!geometry[shapeId]){
        const reduced=[];for(let i=0;i<points.length;i++){
          const p=points[i],last=reduced.at(-1);
          if(!last||i===points.length-1||Math.hypot((p.lat-last[0])*111320,(p.lon-last[1])*111320*Math.cos(p.lat*Math.PI/180))>=40)reduced.push([p.lat,p.lon]);
        }
        geometry[shapeId]=reduced;
      }
      const directions=new Set(selected.filter(t=>t.shape_id===shapeId).map(t=>t.direction_id||''));
      const eligible=rail&&!surface?ids:new Set(selected.filter(t=>directions.has(t.direction_id||'')).flatMap(t=>t.times.map(s=>s.station)));
      const projected=[];
      for(const stop of stations) {
        if(!eligible.has(stop.stop_id))continue;
        let best=Infinity,position=0;
        for(const location of [stop,...(locations.get(stop.stop_id)?.values()||[])]){
        const lat=Number(location.stop_lat),lon=Number(location.stop_lon),scale=Math.cos(lat*Math.PI/180);
        for(let i=1;i<points.length;i++) {
          const a=points[i-1],b=points[i];
          const ax=(a.lon-lon)*scale*111320,ay=(a.lat-lat)*111320,bx=(b.lon-lon)*scale*111320,by=(b.lat-lat)*111320;
          const dx=bx-ax,dy=by-ay,denom=dx*dx+dy*dy;
          const t=denom?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/denom)):0;
          const distance=Math.hypot(ax+t*dx,ay+t*dy);
          if(distance<best){best=distance;position=i-1+t;}
        }
        }
        // Rail stations may use entrance coordinates; bus stops need a tighter
        // street-level match, with opposite-direction stops excluded above.
        if(best<=(rail&&!surface?200:25))projected.push({id:stop.stop_id,position});
      }
      routePaths[shapeId]=projected.sort((a,b)=>a.position-b.position).map(s=>s.id);
    }
    paths[route.route_id]=routePaths;
  }
  return paths;
}

export function normalize(files, {mode = 'train', routeId} = {}) {
  for (const [name, fields] of Object.entries({routes:['route_id','route_type'],trips:['trip_id','route_id','service_id'],stops:['stop_id','stop_name'],stop_times:['trip_id','stop_id','stop_sequence']})) {
    if (!files[name + '.txt']?.length) throw new Error(`Missing or empty ${name}.txt.`);
    for (const field of fields) if (!(field in files[name + '.txt'][0])) throw new Error(`Missing ${field} in ${name}.txt.`);
  }
  if (!files['calendar.txt']?.length && !files['calendar_dates.txt']?.length) throw new Error('A calendar or calendar_dates file is required.');
  const resolution=resolveStations(files);
  const selectedStopIds=new Set();
  const availableModes = ['train','bus'].filter(m => files['routes.txt'].some(r => routeMode(r) === m));
  if (!availableModes.length) throw new Error('No supported rail or bus routes found in this feed.');
  if (!availableModes.includes(mode)) mode = availableModes[0];
  const selectedRoutes = files['routes.txt'].filter(r => routeMode(r) === mode);
  if (routeId && !selectedRoutes.some(r => r.route_id === routeId)) throw new Error('The selected route is not available in this mode.');
  // Buses are loaded one route at a time; large mixed feeds need not send a million stop times to the browser.
  const loadedRoute = mode === 'bus' ? routeId || selectedRoutes[0].route_id : '';
  const routes = new Set(files['routes.txt'].map(r => r.route_id)), selectedIds = new Set(loadedRoute ? [loadedRoute] : selectedRoutes.map(r => r.route_id));
  const allTripIds = new Set(files['trips.txt'].map(t => t.trip_id));
  const goFeed = files['agency.txt']?.some(a => a.agency_id === 'GO');
  const trips = new Map(files['trips.txt'].filter(t => selectedIds.has(t.route_id)).map(t => {
    // GO publishes its public train number in a date-prefixed trip_id, leaving trip_short_name blank.
    const match = goFeed && t.trip_id.match(/^\d{8}-[A-Z0-9]+-(\d+)$/);
    return [t.trip_id, {...t, train_number:t.trip_short_name || (match ? match[1] : ''), times:[]}];
  }));
  for(const call of files['stop_times.txt'])if(trips.has(call.trip_id))selectedStopIds.add(call.stop_id);
  const stops=stationView(resolution,selectedStopIds),platformAliases=resolution.aliases;
  for (const t of files['trips.txt']) if (!routes.has(t.route_id)) throw new Error(`Trip ${t.trip_id} references an unknown route.`);
  for (const s of files['stop_times.txt']) {
    if (!allTripIds.has(s.trip_id)) throw new Error('A stop time references an unknown trip or stop.');
    if (!trips.has(s.trip_id)) continue;
    if (!stops.has(s.stop_id)) throw new Error('A stop time references an unknown trip or stop.');
    if (!Number.isFinite(Number(s.stop_sequence))) throw new Error('Invalid stop_sequence.');
    const stop = stops.get(s.stop_id);
    trips.get(s.trip_id).times.push({stop_id:s.stop_id, station:platformAliases.get(stop.stop_id) || stop.stop_id,
      stop_sequence:s.stop_sequence, arrival_time:s.arrival_time || '', departure_time:s.departure_time || '',
      pickup_type:s.pickup_type || '0', drop_off_type:s.drop_off_type || '0', timepoint:s.timepoint || '1'});
  }
  for (const t of trips.values()) {
    t.times.sort((a,b) => Number(a.stop_sequence)-Number(b.stop_sequence));
    t.source_calls=t.times;
    const calls=[];
    const permission=(a,b)=>a==='0'||b==='0'?'0':a==='1'?b:b==='1'?a:a;
    for(const stop of t.times){
      const previous=calls.at(-1);
      if(previous?.station===stop.station){
        previous.source_stop_ids=[...new Set([...(previous.source_stop_ids||[previous.stop_id]),stop.stop_id])];
        previous.arrival_time=previous.arrival_time||stop.arrival_time;
        previous.departure_time=stop.departure_time||previous.departure_time;
        previous.pickup_type=permission(previous.pickup_type,stop.pickup_type);
        previous.drop_off_type=permission(previous.drop_off_type,stop.drop_off_type);
        previous.timepoint=previous.timepoint==='1'||stop.timepoint==='1'?'1':'0';
      }else calls.push({...stop});
    }
    t.times=calls;
  }
  // Some agencies publish branch letters as trip_short_name. Repeated letters
  // at different departure times are variants, not unique passenger trip numbers.
  const shortNames=new Map();
  for(const t of trips.values())if(/^[a-z]{1,3}$/i.test(t.trip_short_name||'')){
    const key=JSON.stringify([t.route_id,t.service_id,t.trip_short_name]);
    if(!shortNames.has(key))shortNames.set(key,new Set());shortNames.get(key).add(t.times[0]?.departure_time||t.times[0]?.arrival_time||'');
  }
  for(const t of trips.values())if((shortNames.get(JSON.stringify([t.route_id,t.service_id,t.trip_short_name]))?.size||0)>1){
    t.service_variant=t.trip_short_name;t.trip_short_name='';t.train_number='';
  }
  const railServices = new Set([...trips.values()].map(t => t.service_id));
  const calendar = (files['calendar.txt'] || []).filter(c => railServices.has(c.service_id));
  const exceptions = (files['calendar_dates.txt'] || []).filter(c => railServices.has(c.service_id));
  const frequencies = (files['frequencies.txt'] || []).filter(c => trips.has(c.trip_id));
  const usedStops = new Set([...trips.values()].flatMap(t => t.times.flatMap(s => [s.stop_id,s.station])));
  const dates = [...calendar.flatMap(c => [c.start_date,c.end_date]), ...exceptions.filter(c => c.exception_type === '1').map(c => c.date)].filter(Boolean).sort();
  const warnings = [];
  if (frequencies.length) warnings.push('Frequency-based trips are omitted; this MVP displays fixed scheduled trips only.');
  const shapeGeometry={},paths=shapePaths(files,selectedRoutes,trips,stops,shapeGeometry);
  return { agency: files['agency.txt']?.[0]?.agency_name || 'Imported railway', mode, availableModes, loadedRoute,
    modeCounts:Object.fromEntries(availableModes.map(m => [m,files['routes.txt'].filter(r => routeMode(r) === m).length])),
    sourceStops:[...resolution.source.values()],stationResolution:{aliases:Object.fromEntries(platformAliases),groups:resolution.groups,decisions:resolution.decisions,unresolved:resolution.unresolved},
    agencyId:files['agency.txt']?.[0]?.agency_id || '', paths,shapeGeometry,hubRouteCounts:hubRouteCounts(files,stops,mode,platformAliases),
    routes:selectedRoutes, stops:[...stops.values()].filter(s => usedStops.has(s.stop_id)), trips:[...trips.values()], calendar, exceptions, frequencies, firstDate:dates[0] || '', lastDate:dates.at(-1) || '', warnings };
}
