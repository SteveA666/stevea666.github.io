import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalize} from '../WayToGO/gtfs.mjs';
import {groups} from '../WayToGO/schedule.mjs';

function fixture(type='2') {
  return {
    'agency.txt':[{agency_id:'GO',agency_name:'GO Transit'}],
    'routes.txt':['KI-old','KI-new'].map(route_id=>({route_id,agency_id:'GO',route_type:type,route_short_name:'KI',route_long_name:'Kitchener'})),
    'stops.txt':[{stop_id:'A',stop_name:'Central'},{stop_id:'B',stop_name:'West'}],
    'trips.txt':['KI-old','KI-new'].map((route_id,i)=>({trip_id:'T'+i,route_id,service_id:'S',direction_id:String(i)})),
    'stop_times.txt':[0,1].flatMap(i=>['A','B'].map((stop_id,j)=>({trip_id:'T'+i,stop_id:i?'BA'[j]:stop_id,stop_sequence:String(j+1),arrival_time:`0${8+i}:${j?'10':'00'}:00`,departure_time:`0${8+i}:${j?'10':'00'}:00`}))),
    'calendar_dates.txt':[{service_id:'S',date:'20261123',exception_type:'1'}]
  };
}

test('duplicate public lines become one selectable route retaining trips in both directions',()=>{
  const files=fixture(),before=JSON.stringify(files),feed=normalize(files);
  assert.equal(feed.routes.length,1);
  assert.deepEqual(feed.routes[0].source_route_ids,['KI-new','KI-old']);
  assert.equal(feed.modeCounts.train,1);
  assert.equal(feed.trips.length,2);
  assert.ok(feed.trips.every(t=>t.route_id===feed.routes[0].route_id));
  assert.equal(groups(feed,feed.routes[0].route_id,'2026-11-23')[0].sections.length,2);
  assert.equal(JSON.stringify(files),before,'imported source remains intact');
  const reverse=normalize({...files,'routes.txt':[...files['routes.txt']].reverse()});
  assert.equal(reverse.routes[0].route_id,feed.routes[0].route_id);
});

test('bus loading includes every matching route ID and accepts an original alias',()=>{
  const feed=normalize(fixture('3'),{mode:'bus',routeId:'KI-old'});
  assert.equal(feed.routes.length,1);
  assert.equal(feed.loadedRoute,'KI-new');
  assert.deepEqual(feed.trips.map(t=>t.trip_id),['T0','T1']);
  assert.equal(feed.modeCounts.bus,1);
});

test('same labels in different agencies or route types and different line names stay separate',()=>{
  const files=fixture();
  files['routes.txt'][1].agency_id='OTHER';
  assert.equal(normalize(files).routes.length,2);
  files['routes.txt'][1].agency_id='GO';
  files['routes.txt'][1].route_type='0';
  assert.equal(normalize(files).routes.length,2);
  files['routes.txt'][1].route_type='2';
  files['routes.txt'][1].route_long_name='Kitchener Express';
  assert.equal(normalize(files).routes.length,2);
  for(const route of files['routes.txt']){delete route.route_long_name;delete route.route_short_name;}
  assert.equal(normalize(files).routes.length,2);
});
