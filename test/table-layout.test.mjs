import {test} from 'node:test';
import assert from 'node:assert/strict';
import {splitPanel,tableSize} from '../WayToGO/table-layout.mjs';
import {packPDFPanels,PDF_TABLE_WIDTH} from '../WayToGO/pdf-layout.mjs';

const panel=(count=45)=>({heading:'Inbound',number:1,total:1,
  trips:Array.from({length:count},(_,i)=>({number:String(i)})),
  rows:[{name:'Central',cells:Array.from({length:count},(_,i)=>'07:'+String(i).padStart(2,'0'))}]});

test('panels fill the available width and retain departure and cell order',()=>{
  const source=panel();
  for(const width of [280,600,1046,1400]){
    const parts=splitPanel(source,width);
    assert.deepEqual(parts.flatMap(p=>p.trips),source.trips);
    assert.deepEqual(parts.flatMap(p=>p.rows[0].cells),source.rows[0].cells);
    parts.forEach((p,i)=>{
      assert.ok(tableSize(p).width<=width||p.trips.length===1);
      if(i<parts.length-1){
        const next={...p,trips:[...p.trips,parts[i+1].trips[0]],rows:p.rows.map((r,j)=>({...r,cells:[...r.cells,parts[i+1].rows[j].cells[0]]}))};
        assert.ok(tableSize(next).width>width,'another departure cannot fit');
      }
    });
  }
  assert.ok(splitPanel(source,1400)[0].trips.length>splitPanel(source,600)[0].trips.length);
  assert.ok(splitPanel(source,1046)[0].trips.length>10);
});

test('width calculation accounts for day markers, branch labels, and time formats',()=>{
  const source=panel(20);
  source.trips[7]={number:'123456789',marker:'Tu',branch:'Airport express'};
  source.rows[0].cells[7]='11:59 PM +1';
  const parts=splitPanel(source,900,1.15);
  assert.ok(parts.every(p=>tableSize(p,1.15).width<=900));
  assert.equal(parts.flatMap(p=>p.trips)[7].marker,'Tu');
  assert.equal(parts.flatMap(p=>p.rows[0].cells)[7],'11:59 PM +1');
});

test('PDF uses page capacity for full schedules while packing small tables together',()=>{
  const source=panel(),packed=packPDFPanels([source]),parts=packed.flat();
  assert.ok(parts[0].panel.trips.length>10);
  assert.deepEqual(parts.flatMap(p=>p.panel.trips),source.trips);
  assert.ok(parts.every(p=>p.width<=PDF_TABLE_WIDTH));
  assert.deepEqual(parts.map(p=>p.panel.number),parts.map((_,i)=>i+1));
  assert.ok(parts.every(p=>p.panel.total===parts.length));
  assert.deepEqual(packPDFPanels([panel(2),panel(2)]).map(row=>row.length),[2]);
});

test('long GTFS IDs wrap instead of limiting a PDF panel to ten departures',()=>{
  const source=panel(40);
  source.trips=source.trips.map((t,i)=>({...t,number:'very-long-agency-service-trip-identifier-'+i,branch:'Airport express service'}));
  const parts=packPDFPanels([source]).flat();
  assert.ok(parts[0].panel.trips.length>10);
  assert.equal(tableSize(source).tripWidth,64);
  assert.deepEqual(parts.flatMap(p=>p.panel.trips),source.trips);
});
