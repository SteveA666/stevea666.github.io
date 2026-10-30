import {directionChoices,seconds,hasPassengerJourney} from './schedule.mjs?v=20261030-bypass-segments';

export function inferInbound(feed,routeId) {
  const trips=feed.trips.filter(t=>t.route_id===routeId&&hasPassengerJourney(t)),choices=directionChoices(feed,routeId);
  const stops=new Map(feed.stops.map(s=>[s.stop_id,s]));
  const inbound=[...new Set(trips.filter(t=>/\binbound\b/i.test(t.trip_headsign||'')).map(t=>t.direction_id||'unknown'))];
  const outbound=[...new Set(trips.filter(t=>/\boutbound\b/i.test(t.trip_headsign||'')).map(t=>t.direction_id||'unknown'))];
  const endpoints=new Map();
  for(const t of trips)for(const s of [t.times[0],t.times.at(-1)])endpoints.set(s.station,(endpoints.get(s.station)||0)+1);
  const candidates=[...endpoints].map(([id,count])=>{
    const name=stops.get(id)?.stop_name||id;
    const central=/\b(union|central|downtown|city cent(?:re|er))\b/i.test(name)?30:0;
    const arrivals=trips.filter(t=>t.times.at(-1).station===id&&seconds(t.times.at(-1).arrival_time||t.times.at(-1).departure_time)%86400>=14400&&seconds(t.times.at(-1).arrival_time||t.times.at(-1).departure_time)%86400<36000).length;
    const departures=trips.filter(t=>t.times[0].station===id&&seconds(t.times[0].departure_time||t.times[0].arrival_time)%86400>=14400&&seconds(t.times[0].departure_time||t.times[0].arrival_time)%86400<36000).length;
    return {id,name,score:(feed.hubRouteCounts?.[id]||1)*100+central+Math.log1p(count)*5+10*(arrivals-departures)/Math.max(1,arrivals+departures)};
  }).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  const hub=candidates[0];
  if(!hub)return {id:null,hubName:'',reason:'No endpoint information'};
  let id=inbound.length===1?inbound[0]:null;
  if(id===null&&outbound.length===1&&choices.length===2)id=choices.find(c=>c.id!==outbound[0])?.id;
  if(id===null) {
    const center=stops.get(hub.id);
    const distance=station=>{const s=stops.get(station);if(!s||!center||[s.stop_lat,s.stop_lon,center.stop_lat,center.stop_lon].some(v=>v==null||v===''||!Number.isFinite(Number(v))))return null;return (Number(s.stop_lat)-Number(center.stop_lat))**2+((Number(s.stop_lon)-Number(center.stop_lon))*Math.cos(Number(center.stop_lat)*Math.PI/180))**2;};
    const votes=choices.map(c=>({id:c.id,score:trips.filter(t=>(t.direction_id||'unknown')===c.id).reduce((sum,t)=>{
      const first=t.times[0].station,last=t.times.at(-1).station;
      if(last===hub.id&&first!==hub.id)return sum+3;
      if(first===hub.id&&last!==hub.id)return sum-3;
      const a=distance(first),b=distance(last);return sum+(a!==null&&b!==null&&Math.abs(a-b)>1e-8?(b<a?1:-1):0);
    },0)})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
    if(votes[0]?.score>0)id=votes[0].id;
  }
  return {id:id??null,hubId:hub.id,hubName:hub.name,reason:inbound.length===1?'Explicit inbound headsign':`Toward ${hub.name}`};
}

export function boundDirections(feed,routeId,override='') {
  const choices=directionChoices(feed,routeId),auto=inferInbound(feed,routeId);
  const inbound=choices.some(c=>c.id===override)?override:auto.id;
  return choices.map(c=>{const role=inbound===null?'Unspecified':c.id===inbound?'Inbound':'Outbound';return {...c,compassLabel:c.label,role,label:role==='Unspecified'||c.label.toLowerCase()===role.toLowerCase()?c.label:`${role} · ${c.label}`};}).sort((a,b)=>(a.role==='Inbound'?0:1)-(b.role==='Inbound'?0:1)||a.id.localeCompare(b.id));
}
