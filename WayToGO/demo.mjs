export function demo() {
  const names=['Fern Grove','Viemount · Intermodal Transit Center','Old Brookville','Magnolia Meadows','Sayville · Route 34','Financial District','Sunnyvale Central','Forrest Hill','Springhurst · SolHealth','Edge Park','Farmingdale','Glenridge State University',"Parson’s Springs",'Oxford','Homewood','Ashland · Cathedral Bluffs Road','Ashland · Downtown Depot'];
  const stops=names.map((stop_name,i)=>({stop_id:String(i),stop_name}));
  const fmt=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}:00`;
  const trips=[];
  const offsets=[0,7,12,14,20,27,32,40,42,48,61,64,74,78,90,101,111];
  for(const [service,count] of [['WK',18],['SA',9],['SU',7]]) for(let dir=0;dir<2;dir++) for(let n=0;n<count;n++) {
    const express=n%5===2, short=n%6===1;
    let ids=stops.map((_,i)=>i).filter(i=>!short || (i>=1 && i<=14));
    if(express) ids=ids.filter(i=>[0,1,6,14,16].includes(i));
    if(dir) ids.reverse();
    const start=n===0?15:360+(n-1)*(service==='WK'?20:60);
    const origin=dir?111:0;
    const times=ids.map((id,j)=>({station:String(id),stop_id:String(id),stop_sequence:String(j+1),arrival_time:fmt(start+Math.abs(offsets[id]-origin)-(express?Math.min(j*3,10):0)),departure_time:fmt(start+Math.abs(offsets[id]-origin)-(express?Math.min(j*3,10):0))}));
    trips.push({trip_id:`${service}-${dir}-${n}`,route_id:'H',service_id:service,direction_id:String(dir),shape_id:`main-${dir}`,trip_short_name:String((dir?201:102)+n*2),trip_headsign:dir?'Southbound · Fern Grove':'Northbound · Ashland',times});
  }
  const calendar=['WK','SA','SU'].map(service_id=>({service_id,start_date:'20260101',end_date:'20271231',...Object.fromEntries(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map((d,i)=>[d,service_id==='WK'&&i<5||service_id==='SA'&&i===5||service_id==='SU'&&i===6?'1':'0']))}));
  return {agency:'North Valley Rail',routes:[{route_id:'H',route_short_name:'H',route_long_name:'Highland Line',route_color:'18765C'}],stops,trips,calendar,exceptions:[{service_id:'WK',date:'20261225',exception_type:'2'},{service_id:'SU',date:'20261225',exception_type:'1'}],frequencies:[],firstDate:'20261026',warnings:[],demo:true};
}
