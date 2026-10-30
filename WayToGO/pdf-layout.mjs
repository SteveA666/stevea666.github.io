import {tableSize} from './table-layout.mjs';
export function packPDFPanels(panels) {
  const rows=[];let row=[],used=0;
  for(const panel of panels) {
    if(!Array.isArray(panel.trips)||!panel.trips.length||panel.trips.length>10||!Array.isArray(panel.rows)||panel.rows.length>2000)throw new Error('Invalid timetable panel.');
    const size=tableSize(panel),stationWidth=size.stationWidth,width=Math.min(1046,size.width);
    const item={panel,width,stationWidth};
    // Very tall tables need independent pagination rather than a shared row.
    if(panel.rows.length>24){if(row.length)rows.push(row);rows.push([item]);row=[];used=0;continue;}
    if(row.length&&used+20+width>1046){rows.push(row);row=[];used=0;}
    used+=(row.length?20:0)+width;row.push(item);
  }
  if(row.length)rows.push(row);return rows;
}
