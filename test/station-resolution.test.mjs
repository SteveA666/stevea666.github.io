import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveStations} from '../WayToGO/station-resolution.mjs';
import {normalize} from '../WayToGO/gtfs.mjs';

const stop=(id,name,lat=43,lon=-79,extra={})=>({stop_id:id,stop_name:name,stop_lat:String(lat),stop_lon:String(lon),...extra});
const fixture=stops=>({
  'stops.txt':stops,'routes.txt':[{route_id:'rail',route_type:'2'},{route_id:'bus',route_type:'3'}],
  'trips.txt':[{trip_id:'T',route_id:'rail',service_id:'S'},{trip_id:'B',route_id:'bus',service_id:'S'}],
  'stop_times.txt':[{trip_id:'T',stop_id:stops[0].stop_id,stop_sequence:'1',departure_time:'07:00:00'},
    {trip_id:'B',stop_id:stops[1].stop_id,stop_sequence:'1',departure_time:'08:00:00'}],
  'calendar_dates.txt':[{service_id:'S',date:'20261030',exception_type:'1'}]
});
const station=(r,id)=>r.aliases.get(id)||id;

test('station identities are stable across rail, bus, source order and route selection',()=>{
  const files=fixture([stop('ST','Central GO'),stop('0001','Central GO Bus',43.0005)]);
  const original=JSON.stringify(files),rail=normalize(files),bus=normalize(files,{mode:'bus',routeId:'bus'});
  assert.equal(rail.trips[0].times[0].station,'ST');assert.equal(bus.trips[0].times[0].station,'ST');
  assert.equal(JSON.stringify(files),original,'input feed remains intact');
  const shuffled={...files,'stops.txt':[...files['stops.txt']].reverse()};
  assert.equal(station(resolveStations(shuffled),'0001'),'ST');
  assert.equal(bus.sourceStops.find(s=>s.stop_id==='0001').stop_name,'Central GO Bus');
});

test('validated hints allow large complexes but reject distant facilities sharing a code',()=>{
  const files=fixture([stop('UN','Union Station GO'),stop('02300','Union Station Bus Terminal',43.003),
    stop('BE','Bramalea GO',44),stop('08032','Bramalea Bus Terminal',44.03),stop('00225','Bramalea Bus Terminal',44.03)]);
  const r=resolveStations(files,{hints:[{'02300':'UN','08032':'BE','00225':'BE','absent':'UN'}]});
  assert.equal(station(r,'02300'),'UN');
  assert.equal(station(r,'08032'),station(r,'00225'));assert.notEqual(station(r,'08032'),'BE');
  assert.ok(r.unresolved.some(d=>d.stopId==='08032'&&d.reason==='hint-distance-or-parent-conflict'));
  assert.ok(r.unresolved.some(d=>d.stopId==='absent'&&d.reason==='missing-hint-stop'));
  assert.ok(r.groups.find(g=>g.id==='UN').reasons.includes('validated-station-hint'));
});

test('name references link nearby street stops, while conflicting hint names remain unresolved',()=>{
  const files=fixture([stop('GL','Guelph Central GO'),stop('02518','MacDonell St. @ Carden St. (Guelph Central GO)',43.002),stop('X','Different Station')]);
  const r=resolveStations(files,{hints:[{X:'GL'}]});
  assert.equal(station(r,'02518'),'GL');assert.equal(station(r,'X'),'X');
  assert.ok(r.unresolved.some(d=>d.reason==='hint-name-conflict'));
});

test('nearby stop chains cannot merge facilities farther apart than the group limit',()=>{
  const files=fixture([stop('A','Central Station'),stop('B','Central Station',43.002),stop('C','Central Station',43.004)]);
  const r=resolveStations(files);
  assert.equal(station(r,'A'),station(r,'B'));assert.notEqual(station(r,'A'),station(r,'C'));
});

test('missing or invalid coordinates cannot establish inferred duplicates',()=>{
  const files=fixture([stop('A','Central Station'),stop('B','Central Station',403),stop('C','Central Station','')]);
  const r=resolveStations(files);assert.equal(r.aliases.size,0);
});

test('declared parents remain distinct and boarding areas resolve through platforms',()=>{
  const files=fixture([stop('P','Central Station',43,-79,{location_type:'1'}),stop('Q','Central Station',43.0001,-79,{location_type:'1'}),
    stop('A','Bay A',43,-79,{location_type:'0',parent_station:'P'}),stop('B','Bay B',43,-79,{location_type:'0',parent_station:'Q'}),
    stop('C','Boarding area',43,-79,{location_type:'4',parent_station:'A'})]);
  const r=resolveStations(files);
  assert.equal(station(r,'A'),'P');assert.equal(station(r,'C'),'P');assert.equal(station(r,'B'),'Q');
});

test('bad parent links are reported without erasing stops or inventing stations',()=>{
  const files=fixture([stop('A','Alpha',43,-79,{parent_station:'B'}),stop('B','Beta',43,-79,{parent_station:'A'}),stop('C','Gamma',43,-79,{parent_station:'missing'})]);
  const r=resolveStations(files);assert.equal(station(r,'A'),'A');assert.equal(station(r,'B'),'B');
  assert.ok(r.unresolved.some(d=>d.reason==='parent-cycle'));assert.ok(r.unresolved.some(d=>d.reason==='missing-parent'));
});

test('consecutive aliases retain original calls, arrival/departure and later return visits',()=>{
  const files=fixture([stop('A','Central Station'),stop('B','Central Station',43.0001),stop('X','Other Station',43.02)]);
  files['stop_times.txt']=[['A','07:00:00','07:01:00'],['B','07:02:00','07:03:00'],['X','07:10:00','07:10:00'],['A','07:20:00','07:20:00']].map(([stop_id,arrival_time,departure_time],i)=>({trip_id:'T',stop_id,arrival_time,departure_time,stop_sequence:String(i+1)}));
  const t=normalize(files).trips[0];assert.equal(t.times.length,3);assert.equal(t.source_calls.length,4);
  assert.equal(t.times[0].station,t.times[2].station);assert.equal(t.times[0].arrival_time,'07:00:00');assert.equal(t.times[0].departure_time,'07:03:00');
  assert.deepEqual(t.source_calls.map(c=>c.stop_id),['A','B','X','A']);
});
