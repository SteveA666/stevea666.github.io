// Shared sizing for PDF export and the live timetable.
export function tableSize(panel,scale=1) {
  const stationWidth=Math.min(240,Math.max(180,...panel.rows.map(r=>String(r.name??'').length*5.5+14)))*scale;
  // Headers can wrap; long GTFS trip IDs must not widen every time column.
  const tripWidth=Math.max(52,...panel.trips.map(t=>Math.max(Math.min(64,String(t.number??'').length*6.8+14)+(t.marker?String(t.marker).length*6+4:0),Math.min(64,String(t.branch??'').length*5.5+12))),...panel.rows.map(r=>r.cells.reduce((width,c)=>Math.max(width,String(c??'').length*5.5+12),0)))*scale;
  return {stationWidth,tripWidth,width:Math.max(350*scale,stationWidth+tripWidth*panel.trips.length)};
}

// Keep departures in order and fill each panel at readable column widths.
export function splitPanel(panel,availableWidth,scale=1) {
  const result=[];
  const slice=(start,end)=>({...panel,trips:panel.trips.slice(start,end),rows:panel.rows.map(r=>({...r,cells:r.cells.slice(start,end)}))});
  let start=0;
  while(start<panel.trips.length){
    let end=start+1,current=slice(start,end);
    while(end<panel.trips.length){
      const next=slice(start,end+1);
      if(tableSize(next,scale).width>availableWidth)break;
      current=next;end++;
    }
    result.push(current);start=end;
  }
  return result;
}
