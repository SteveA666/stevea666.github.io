// Shared sizing for PDF export and the live timetable.
export function tableSize(panel,scale=1) {
  const stationWidth=Math.min(240,Math.max(180,...panel.rows.map(r=>String(r.name??'').length*5.5+14)))*scale;
  const tripWidth=Math.max(52,...panel.trips.map(t=>String(t.number??'').length*6.3+14+(t.marker?14:0)),...panel.rows.flatMap(r=>r.cells.map(c=>String(c??'').length*5.5+12)))*scale;
  return {stationWidth,width:Math.max(350*scale,stationWidth+tripWidth*panel.trips.length)};
}
