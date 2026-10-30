import {tableSize,splitPanel} from './table-layout.mjs?v=20261030-bypass-segments';
export const PDF_TABLE_WIDTH=1046;
export function packPDFPanels(panels) {
  const rows=[];let row=[],used=0;
  const fitted=panels.flatMap(panel=>{
    if(!Array.isArray(panel.trips)||!panel.trips.length||panel.trips.length>10000||!Array.isArray(panel.rows)||panel.rows.length>2000)throw new Error('Invalid timetable panel.');
    const parts=splitPanel(panel,PDF_TABLE_WIDTH);
    return parts.map((part,i)=>parts.length===1?part:{...part,number:i+1,total:parts.length});
  });
  for(const panel of fitted) {
    const size=tableSize(panel),stationWidth=size.stationWidth,width=Math.min(PDF_TABLE_WIDTH,size.width);
    const item={panel,width,stationWidth};
    // Very tall tables need independent pagination rather than a shared row.
    if(panel.rows.length>24){if(row.length)rows.push(row);rows.push([item]);row=[];used=0;continue;}
    if(row.length&&used+20+width>PDF_TABLE_WIDTH){rows.push(row);row=[];used=0;}
    used+=(row.length?20:0)+width;row.push(item);
  }
  if(row.length)rows.push(row);return rows;
}
