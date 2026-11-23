import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stationDisplayName} from '../WayToGO/station-labels.mjs';
import {normalize} from '../WayToGO/gtfs.mjs';
import {branchOptions,groups} from '../WayToGO/schedule.mjs';

test('strip trailing boarding details without changing station identity words',()=>{
  for(const name of ['Fairway Station - Northbound','Fairway Station – South-bound','Fairway Station (Eastbound)',
    'Fairway Station WB','Fairway Station N-bound','Fairway Station Platform 2','Fairway Station (Platform A)',
    'Fairway Station - Northbound LRT Platform towards Conestoga','Fairway Station - Platform 1 - Southbound',
    'Fairway Station - Bay 3','Fairway Station - Track 2'])assert.equal(stationDisplayName(name),'Fairway Station',name);
  for(const name of ['North York Centre','West Harbour GO','Bay','Bay Station','Platform','Union Station','Southbound Cafe'])assert.equal(stationDisplayName(name),name);
});

function ion() {
  return {
    'routes.txt':[{route_id:'301',route_type:'0',route_short_name:'301',route_long_name:'ION light rail'}],
    'stops.txt':['Fairway','Central','Conestoga'].flatMap((name,i)=>['N','S'].map((dir,j)=>({stop_id:name+dir,stop_name:`${name} Station - ${j?'Southbound':'Northbound'}`,stop_lat:String(43+i*.01),stop_lon:String(-80+j*.0001)}))),
    'trips.txt':[{trip_id:'N',route_id:'301',direction_id:'0',service_id:'S'},{trip_id:'S',route_id:'301',direction_id:'1',service_id:'S'}],
    'stop_times.txt':['N','S'].flatMap((dir,i)=>(i?['Conestoga','Central','Fairway']:['Fairway','Central','Conestoga']).map((name,j)=>({trip_id:dir,stop_id:name+dir,stop_sequence:String(j+1),arrival_time:`08:${j}0:00`,departure_time:`08:${j}0:00`}))),
    'calendar_dates.txt':[{service_id:'S',date:'20261123',exception_type:'1'}]
  };
}

test('opposite ION platforms resolve to three stations and no false branch, retaining source calls',()=>{
  const source=ion(),before=JSON.stringify(source),feed=normalize(source);
  assert.deepEqual(branchOptions(feed,'301'),[]);
  assert.equal(new Set(feed.trips.flatMap(t=>t.times.map(s=>s.station))).size,3);
  for(const trip of feed.trips)assert.equal(trip.source_calls.length,3);
  const sections=groups(feed,'301','2026-11-23')[0].sections;
  assert.equal(sections.length,2);
  for(const section of sections)assert.ok(section.table.stations.every(s=>!/(bound|platform|branch)/i.test(s.name)));
  assert.ok(feed.sourceStops.some(s=>s.stop_name.endsWith('Southbound')));
  assert.equal(JSON.stringify(source),before);
});

test('clean labels do not merge distant stations or stops with missing coordinates',()=>{
  const source=ion();
  for(const stop of source['stops.txt'])if(stop.stop_id.endsWith('S'))stop.stop_lon='-82';
  assert.equal(normalize(source).stationResolution.groups.length,0);
  for(const stop of source['stops.txt']){delete stop.stop_lat;delete stop.stop_lon;}
  assert.equal(normalize(source).stationResolution.groups.length,0);
});
