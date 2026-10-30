import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groups,table,pruneTable,seconds,tablePanels,branchOptions,branchTag,directionChoices,genericGroups} from '../WayToGO/schedule.mjs';
const makeTrip=(id,time,ids=['A','B','C'],variant='')=>({trip_id:id,trip_short_name:id,route_id:'R',service_id:'S',direction_id:'0',route_variant:variant,times:ids.map((station,i)=>({station,departure_time:time,arrival_time:time,stop_sequence:String(i)}))});
const makeFeed=trips=>({routes:[{route_id:'R',route_type:'3'}],stops:['A','B','C','X','Y'].map(stop_id=>({stop_id,stop_name:stop_id})),trips,calendar:[{service_id:'S',start_date:'20260101',end_date:'20261231',...Object.fromEntries(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(d=>[d,'1']))}],exceptions:[],frequencies:[]});
test('flat tables contain ten trips, preserve all trips, and do not use time bands',()=>{
  const f=makeFeed(Array.from({length:23},(_,i)=>makeTrip(String(i),String(4+i).padStart(2,'0')+':00:00')));
  const g=groups(f,'R','2026-10-28');assert.equal(g.length,1);assert.equal(g[0].period,undefined);
  const panels=tablePanels(g[0].sections[0].table);assert.deepEqual(panels.map(t=>t.columns.length),[10,10,3]);assert.equal(new Set(panels.flatMap(t=>t.columns.map(c=>c.trip.trip_id))).size,23);
});
test('blank and passing-only rows are removed per panel while scheduled stops remain',()=>{
  const local=makeTrip('L','07:00:00'),short=makeTrip('S','08:00:00',['B']);
  const t=table(makeFeed([local,short]),[local,short]);const panel=pruneTable(t,[t.columns.find(c=>c.trip.trip_id==='S')]);assert.deepEqual(panel.stations.map(s=>s.id),['B']);
  const express=makeTrip('E','08:00:00',['A','C']);const e=table(makeFeed([local,express]),[express],[local,express]);assert.deepEqual(e.columns[0].cells.map(c=>c.kind),['time','pass','time']);
  assert.deepEqual(tablePanels(e)[0].stations.map(s=>s.id),['A','C']);
  const mixed=table(makeFeed([local,express,short]),[local,express,short]);
  assert.deepEqual(pruneTable(mixed,mixed.columns.filter(c=>c.trip.trip_id!=='L'&&c.trip.trip_id!=='S')).stations.map(s=>s.id),['A','C']);
  assert.deepEqual(pruneTable(mixed).stations.map(s=>s.id),['A','B','C']);
  const blankAndPass={stations:[{id:'A'},{id:'B'}],columns:[{cells:[{kind:'time',time:''},{kind:'pass'}]},{cells:[{kind:'blank'},{kind:'blank'}]}]};
  assert.deepEqual(pruneTable(blankAndPass).stations.map(s=>s.id),['A']);
});
test('bus branch layout separates variants and consolidated layout keeps other branches blank',()=>{
  const a=makeTrip('A1','07:00:00',['A','B','C'],'71A'),b=makeTrip('B1','07:30:00',['A','X','C'],'71B');const f=makeFeed([a,b]);
  const opts={branches:'separate'};const separated=groups(f,'R','2026-10-28',false,'all',opts)[0].sections;
  assert.deepEqual(separated.map(s=>s.branchLabel),['71A','71B']);assert.deepEqual(separated[0].table.stations.map(s=>s.id),['A','B','C']);
  const consolidated=groups(f,'R','2026-10-28',false,'all',{})[0].sections[0].table;
  assert.equal(consolidated.columns[0].cells[consolidated.stations.findIndex(s=>s.id==='X')].kind,'blank');
});
test('branches without explicit variants fall back to stopping patterns',()=>{
  const f=makeFeed([makeTrip('a','07:00:00',['A','B','C']),makeTrip('b','07:30:00',['A','X','C'])]);assert.equal(groups(f,'R','2026-10-28',false,'all',{branches:'separate'})[0].sections.length,2);
});
test('loops and conflicting branch orders preserve the time sequence of every call',()=>{
  const trips=[makeTrip('loop','07:00:00',['A','B','A','C']),makeTrip('reverse','08:00:00',['A','C','B','C'])];
  trips.forEach(t=>t.times.forEach((s,i)=>s.departure_time=s.arrival_time=`${t.trip_id==='loop'?'07':'08'}:${String(i*10).padStart(2,'0')}:00`));
  const t=table(makeFeed(trips),trips);for(const c of t.columns)assert.deepEqual(c.cells.filter(s=>s.kind==='time').map(s=>seconds(s.time)),c.trip.times.map(s=>seconds(s.departure_time)));
});
test('branch selector filters exact variants in both directions and does not confuse 47 with 47A',()=>{
  const trips=['47','47A','47B'].flatMap((variant,i)=>[makeTrip('out'+i,'07:00:00',['A','B','C'],variant),{...makeTrip('in'+i,'08:00:00',['C','B','A'],variant),direction_id:'1'}]);
  const f=makeFeed(trips);assert.deepEqual(branchOptions(f,'R').map(b=>b.label),['47','47A','47B']);
  const g=groups(f,'R','2026-10-28',false,'all',{branchKey:'47'});assert.equal(g[0].trips.length,2);assert.ok(g[0].trips.every(t=>t.route_variant==='47'));assert.equal(g[0].sections.length,2);
});
test('unbranched reverse directions do not produce a branch selector',()=>{
  const f=makeFeed([makeTrip('out','07:00:00'),{...makeTrip('in','08:00:00',['C','B','A']),direction_id:'1'}]);
  assert.equal(branchOptions(f,'R').length,1);
});
test('bus highway expresses skip stops in a compatible corridor while other branches stay blank',()=>{
  const local=makeTrip('local','07:00:00',['A','B','C','Y'],'12');
  const express=makeTrip('express','08:00:00',['A','C','Y'],'12B');express.shape_id='HIGHWAY';
  const branch=makeTrip('branch','09:00:00',['A','X','Y'],'12X');
  const f=makeFeed([local,express,branch]);f.paths={R:{HIGHWAY:['A','C','Y']}};
  const t=table(f,f.trips),col=t.columns.find(c=>c.trip===express);
  assert.equal(col.cells[t.stations.findIndex(s=>s.id==='B')].kind,'pass');
  assert.equal(col.cells[t.stations.findIndex(s=>s.id==='X')].kind,'blank');
  assert.equal(col.cells[t.stations.findIndex(s=>s.id==='Y')].kind,'time');
});
test('bus alternative corridors do not invent skip stops and short turns stay blank beyond their terminus',()=>{
  const main=makeTrip('main','07:00:00',['A','B','C']);
  const branch=makeTrip('branch','08:00:00',['A','X','C']);
  const ambiguous=makeTrip('express','09:00:00',['A','C']);
  const short=makeTrip('short','10:00:00',['A','B']);
  const t=table(makeFeed([main,branch,ambiguous,short]),[main,branch,ambiguous,short]);
  const cell=(trip,id)=>t.columns.find(c=>c.trip===trip).cells[t.stations.findIndex(s=>s.id===id)].kind;
  assert.equal(cell(ambiguous,'B'),'blank');assert.equal(cell(ambiguous,'X'),'blank');
  assert.equal(cell(short,'C'),'blank');assert.equal(cell(short,'X'),'blank');
});

test('a highway express with unique access stops skips the inner local corridor',()=>{
  const local=makeTrip('local','07:00:00',['A','B','C','D','E','F','G','H','I','J','T'],'21F');
  const express=makeTrip('express','08:00:00',['A','B','C','X','Y','T'],'21A');
  const branch=makeTrip('branch','09:00:00',['A','B','C','Z','T'],'21X');
  const f=makeFeed([local,express,branch]);f.stops=[...'ABCDEFGHIJ', 'X','Y','Z','T'].map(id=>({stop_id:id,stop_name:id}));
  express.shape_id='distant-highway';f.paths={R:{'distant-highway':['A','B','C','X','Y','T']}};
  const t=table(f,f.trips),col=t.columns.find(c=>c.trip===express);
  for(const id of ['D','E','F','G','H','I','J'])assert.equal(col.cells[t.stations.findIndex(s=>s.id===id)].kind,'pass',id);
  assert.equal(col.cells[t.stations.findIndex(s=>s.id==='Z')].kind,'blank');
  assert.equal(col.cells[t.stations.findIndex(s=>s.id==='X')].kind,'time');
});
test('direction names use headsigns or geographic movement rather than assigning meaning to IDs',()=>{
  const f=makeFeed([makeTrip('out','07:00:00'),{...makeTrip('in','08:00:00',['C','B','A']),direction_id:'1'}]);
  f.stops.forEach((s,i)=>{s.stop_lat='43';s.stop_lon=String(-80+i);});
  assert.deepEqual(directionChoices(f,'R').map(d=>d.label),['Eastbound','Westbound']);
  f.trips[0].trip_headsign='Inbound to Central';f.trips[1].trip_headsign='Outbound to Airport';
  assert.deepEqual(directionChoices(f,'R').map(d=>d.label),['Inbound','Outbound']);
  for(const s of f.stops){s.stop_lat='';s.stop_lon='';}for(const t of f.trips)delete t.trip_headsign;
  assert.deepEqual(directionChoices(f,'R').map(d=>d.label),['Toward C','Toward A']);
});
test('rail expresses fill shared segments across different shapes without passing through another branch',()=>{
  const local=makeTrip('local','07:00:00',['A','B','C']),express=makeTrip('express','08:00:00',['X','A','C']);
  local.shape_id='local';express.shape_id='branch-express';
  const f=makeFeed([local,express]);f.mode='train';f.routes[0].route_type='2';
  const t=table(f,[express],[local,express]);assert.equal(t.columns[0].cells[t.stations.findIndex(s=>s.id==='B')].kind,'pass');
});
test('a known geometric path takes precedence over a longer alternative stopping pattern',()=>{
  const local=makeTrip('local','07:00:00',['A','B','C']),detour=makeTrip('detour','08:00:00',['A','C']);
  local.shape_id='main';detour.shape_id='detour';const f=makeFeed([local,detour]);f.mode='train';
  f.paths={R:{main:['A','B','C'],detour:['A','C']}};
  const t=table(f,[local,detour]);assert.equal(t.columns.find(c=>c.trip.trip_id==='detour').cells[t.stations.findIndex(s=>s.id==='B')].kind,'blank');
});
test('shared territory includes branch trains, short turns and nonstopping through trains, and clips outer stops',()=>{
  const main=makeTrip('main','07:00:00',['A','B','C']),fork=makeTrip('fork','08:00:00',['A','B','X']);
  const short=makeTrip('short','08:30:00',['A','B']),through=makeTrip('through','09:00:00',['Y','C']),outside=makeTrip('outside','10:00:00',['C']);
  through.shape_id='THROUGH';
  const f=makeFeed([main,fork,short,through,outside]);f.mode='train';f.paths={R:{THROUGH:['Y','A','B','C']}};
  const g=groups(f,'R','2026-10-28',false,'all',{branchKey:'rail:shared'});
  assert.deepEqual(g[0].trips.map(t=>t.trip_id),['main','fork','short','through']);
  const t=g[0].sections[0].table;assert.deepEqual(t.stations.map(s=>s.id),['A','B']);
  assert.deepEqual(t.columns.find(c=>c.trip.trip_id==='through').cells.map(s=>s.kind),['pass','pass']);
  assert.ok(branchOptions(f,'R').some(b=>b.label==='Shared trunk'));
});

test('rail short turns and terminal-loop order changes do not create geographic branches',()=>{
  const full=makeTrip('full','07:00:00',['A','B','C','X']);
  const short=makeTrip('short','08:00:00',['B','C']);
  const loop=makeTrip('loop','09:00:00',['B','C','B']);
  const f=makeFeed([full,short,loop]);f.mode='train';
  assert.deepEqual(branchOptions(f,'R'),[]);
  const fork=makeTrip('fork','10:00:00',['A','B','Y']);f.trips.push(fork);
  // Use a fresh feed because corridor profiles are cached per feed.
  const branched={...f};assert.ok(branchOptions(branched,'R').length>1);
});

test('single-stop scheduling records do not become actual or generic timetable columns',()=>{
  const full=makeTrip('passenger','04:41:00',['A','B','C']);
  const stub=makeTrip('stub','04:41:00',['A']);
  const closed=makeTrip('no-public-journey','04:42:00',['A','B']);closed.times.forEach(s=>{s.pickup_type='1';s.drop_off_type='1';});
  const f=makeFeed([stub,full,closed]);
  for(const gs of [groups(f,'R','2026-10-28'),genericGroups(f,'R','2026-10-28')])for(const g of gs)assert.deepEqual(g.trips.map(t=>t.trip_id),['passenger']);
});

test('opposite curbs and a nearby terminal-only turnback are not rail branches',()=>{
  const full=makeTrip('full','07:00:00',['A','B','C','X']),short=makeTrip('short','08:00:00',['A','B','L']);
  const back={...makeTrip('back','09:00:00',['X','C','B2','A']),direction_id:'1'};
  const f=makeFeed([full,short,back]);f.mode='train';
  f.stops=[['A','North Terminal',43.02,-79],['B','Main St at Junction Ave South Side',43,-79],['B2','Junction Ave at Main St North Side',43.0001,-79],['C','Waterfront',42.99,-79],['X','City Terminal',42.98,-79],['L','Junction Loop',43.0002,-79],['Y','Other Loop',43.02,-78.98]].map(([stop_id,stop_name,stop_lat,stop_lon])=>({stop_id,stop_name,stop_lat,stop_lon}));
  assert.deepEqual(branchOptions(f,'R'),[]);
  const t=table(f,[full,short],[full,short]),index=id=>t.stations.findIndex(s=>s.id===id);
  assert.equal(index('L'),index('B')+1);assert.ok(index('L')<index('C'));
  assert.equal(t.columns.find(c=>c.trip===full).cells[index('L')].kind,'blank');
  const fork=makeTrip('fork','10:00:00',['A','B','Y']);
  assert.ok(branchOptions({...f,trips:[...f.trips,fork]},'R').some(b=>b.label.includes('Other Loop')),'a remote loop terminal is a real branch');
});

test('rail geometry unifies directional stopping differences but preserves a separate physical branch',()=>{
  const out=makeTrip('out','07:00:00',['A','B','C']);out.shape_id='OUT';
  const back={...makeTrip('back','08:00:00',['C','X','A']),direction_id:'1',shape_id:'BACK'};
  const f=makeFeed([out,back]);f.mode='train';f.routes[0].route_type='0';
  f.shapeGeometry={OUT:[[43,-79],[43,-78.99],[43,-78.98]],BACK:[[43.0001,-78.98],[43.0001,-78.99],[43.0001,-79]]};
  assert.deepEqual(branchOptions(f,'R'),[],'different named intermediate stops on the same alignment are not branches');
  const split=makeTrip('split','09:00:00',['A','B','Y']);split.shape_id='SPLIT';
  const branched={...f,trips:[...f.trips,split],shapeGeometry:{...f.shapeGeometry,SPLIT:[[43,-79],[43,-78.99],[43.02,-78.98]]}};
  assert.ok(branchOptions(branched,'R').length>1,'a geographically diverging destination remains a branch');
});

test('trip branch tags use route codes rather than full destination text',()=>{
  const route={route_short_name:'11'};
  assert.equal(branchTag({trip_headsign:'North - 11A Bayview towards Steeles'},route),'11A');
  assert.equal(branchTag({trip_headsign:'North - 11B Bayview towards Sunnybrook'},route),'11B');
  assert.equal(branchTag({route_variant:'47D',trip_headsign:'Highway 407'},{route_short_name:'47'}),'47D');
  assert.equal(branchTag({trip_headsign:'Airport via Highway 407'},{route_short_name:'47'}),'');
  assert.equal(branchTag({service_variant:'A'},route),'11A');
});

test('compact branch annotations work across agencies and reject free-form descriptors',()=>{
  for(const [route,head,expected]of [
    ['M15','Uptown - M15-SBS via 1 Avenue','M15-SBS'],
    ['X1','Outbound X1A towards Airport','X1A'],
    ['Q44','Northbound Q44-SBS to Bronx Zoo','Q44-SBS'],
    ['A','A2 to Downtown','A2'],
    ['BRT','BRT Express to Central','BRT'],
    ['11','North - 11A Bayview towards Steeles','11A']
  ])assert.equal(branchTag({trip_headsign:head},{route_short_name:route}),expected);
  for(const descriptor of ['Northbound','Downtown','Airport via Highway 407','East - Main Street Express']){
    assert.equal(branchTag({route_variant:descriptor},{route_short_name:'11'}),'');
  }
  assert.equal(branchTag({route_variant:'North - M15-SBS via First Avenue'},{route_short_name:'M15'}),'M15-SBS');
  assert.equal(branchTag({trip_headsign:'Airport shuttle towards Terminal 2'},{route_short_name:'X1'}),'');
});
