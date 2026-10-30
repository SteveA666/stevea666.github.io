import {packPDFPanels} from './pdf-layout.mjs';
const SCALE=.75,PAGE=[841.89,595.28],MARGIN=28.35;
let dependencies;
async function load(){
  if(!dependencies)dependencies=(async()=>{
    if(typeof self==='undefined')globalThis.self=globalThis;
    await import('./vendor/pdf-lib.min.js');await import('./vendor/fontkit.umd.min.js');
    return {lib:globalThis.PDFLib,fontkit:globalThis.fontkit};
  })();
  return dependencies;
}
export async function renderBrowserPDF(data,onProgress=()=>{},options={}) {
  if(!Array.isArray(data.panels)||!data.panels.length||data.panels.length>500)throw Error('Choose a timetable with 1 to 500 panels.');
  const packed=packPDFPanels(data.panels),{lib,fontkit}=await load(),{PDFDocument,StandardFonts,rgb}=lib;
  const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);pdf.setTitle(String(data.title||'Timetable'));pdf.setCreator('WayToGO');
  const fontBytes=options.fontBytes||await(await fetch(new URL('./fonts/NotoSans-Regular.ttf',import.meta.url))).arrayBuffer();
  const font=await pdf.embedFont(fontBytes,{subset:true}),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const color=/^[0-9a-f]{6}$/i.test(data.color||'')?data.color:'285b43';
  const channel=color.match(/../g).map(c=>parseInt(c,16)/255),ink=rgb(.125,.2,.175),line=rgb(...channel),border=rgb(.84,.88,.85),tint=rgb(...channel.map(c=>c+(1-c)*.87)),stripe=rgb(...channel.map(c=>c+(1-c)*.96));
  const text=value=>String(value??'').replace(/[\r\n\t]/g,' ');
  const measure=(value,size,f=font)=>f.widthOfTextAtSize(text(value),size);
  const wrap=(value,width,size,f=font)=>{
    const result=[];let current='';
    for(const word of text(value).split(/\s+/)){
      const candidate=current?current+' '+word:word;
      if(measure(candidate,size,f)<=width){current=candidate;continue;}
      if(current){result.push(current);current='';}
      if(measure(word,size,f)<=width){current=word;continue;}
      for(const c of word){if(current&&measure(current+c,size,f)>width){result.push(current);current='';}current+=c;}
    }
    if(current||!result.length)result.push(current);return result;
  };
  const headingFont=value=>{try{bold.encodeText(text(value));return bold;}catch{return font;}};
  const model=item=>{
    const p=item.panel,width=item.width*SCALE,station=item.stationWidth*SCALE,trip=(width-station)/p.trips.length;
    const headFont=headingFont(p.heading),headLines=wrap(p.heading,width-83,11,headFont),subLines=wrap(text(data.title)+(p.branch?' · '+p.branch:''),width,7.5);
    const headerHeight=headLines.length*13+subLines.length*10+17;
    const stationLines=wrap((data.stationLabel||'STATION')+' / TRIP NUMBER',station-8,7);
    const trips=p.trips.map(t=>({number:wrap(t.number,trip-8,7.5),variant:t.branch?wrap(t.branch,trip-8,6):[],marker:t.marker||''}));
    const tableHeader=Math.max(stationLines.length*9,...trips.map(t=>t.number.length*9+t.variant.length*8))+9;
    const rows=p.rows.map(r=>{const label=wrap(r.name,station-8,7.5),cells=r.cells.map(c=>wrap(c,trip-8,7.5));return {label,cells,height:Math.max(label.length,...cells.map(c=>c.length))*10+7};});
    const legend='Passing stop · Blank: not served · +1: next day'+(p.trips.some(t=>t.marker)?' · Day subscripts: M Mon, Tu Tue, W Wed, Th Thu, F Fri, Sa Sat, Su Sun':'');
    const legendLines=wrap(legend,width-9,6),footer=legendLines.length*8+10;
    return {p,width,station,trip,headFont,headLines,subLines,headerHeight,stationLines,trips,tableHeader,rows,legendLines,footer,height:headerHeight+tableHeader+rows.reduce((n,r)=>n+r.height,0)+footer};
  };
  let page,y;
  const addPage=()=>{page=pdf.addPage(PAGE);y=PAGE[1]-MARGIN;};
  const lines=(strings,x,top,size,leading,f=font,centerWidth=0)=>{
    strings.forEach((value,i)=>{
      if(value==='↓'){
        const middle=x+centerWidth/2,bottom=top-i*leading-size;
        page.drawLine({start:{x:middle,y:bottom+7},end:{x:middle,y:bottom},thickness:.7,color:ink});
        page.drawLine({start:{x:middle-2.3,y:bottom+2.7},end:{x:middle,y:bottom},thickness:.7,color:ink});
        page.drawLine({start:{x:middle+2.3,y:bottom+2.7},end:{x:middle,y:bottom},thickness:.7,color:ink});
      }else page.drawText(value,{x:x+(centerWidth?Math.max(0,(centerWidth-measure(value,size,f))/2):0),y:top-size-i*leading,size,font:f,color:ink});
    });
  };
  const heading=(m,x,top,continued=false)=>{
    lines(m.headLines,x,top,11,13,m.headFont);lines(m.subLines,x,top-m.headLines.length*13-3,7.5,10);
    const counter='Panel '+m.p.number+' of '+m.p.total+(continued?' (cont.)':'');
    lines([counter],x+m.width-measure(counter,6.5),top-5,6.5,8);
    page.drawRectangle({x,y:top-m.headerHeight+5,width:m.width,height:3,color:line});
    return top-m.headerHeight;
  };
  const tableHead=(m,x,top)=>{
    page.drawRectangle({x,y:top-m.tableHeader,width:m.width,height:m.tableHeader,color:tint,borderColor:border,borderWidth:.5});
    lines(m.stationLines,x+4,top-4,7,9);
    m.trips.forEach((t,i)=>{const tx=x+m.station+i*m.trip;lines(t.number,tx,top-4,7.5,9,font,m.trip);if(t.marker){const number=t.number.at(-1);const mx=tx+(m.trip+measure(number,7.5))/2+1;page.drawText(t.marker,{x:Math.min(mx,tx+m.trip-measure(t.marker,5)),y:top-14-(t.number.length-1)*9,size:5,font,color:ink});}lines(t.variant,tx,top-5-t.number.length*9,6,8,font,m.trip);});
    return top-m.tableHeader;
  };
  const row=(m,r,x,top,index)=>{
    page.drawRectangle({x,y:top-r.height,width:m.width,height:r.height,color:index%2?stripe:rgb(1,1,1),borderColor:border,borderWidth:.4});
    lines(r.label,x+4,top-3.5,7.5,10);
    for(let i=0;i<m.p.trips.length;i++){const tx=x+m.station+i*m.trip;page.drawLine({start:{x:tx,y:top},end:{x:tx,y:top-r.height},thickness:.4,color:border});lines(r.cells[i]||[''],tx,top-3.5,7.5,10,font,m.trip);}
    return top-r.height;
  };
  const footer=(m,x,top)=>{lines(['↓'],x,top-6,6,8,font,6);lines(m.legendLines,x+9,top-6,6,8);return top-m.footer;};
  addPage();let rendered=0;const total=packed.reduce((n,row)=>n+row.length,0);
  for(const packedRow of packed){
    const models=packedRow.map(model),height=Math.max(...models.map(m=>m.height)),usable=PAGE[1]-2*MARGIN;
    if(height<=usable){
      if(y-height<MARGIN)addPage();
      let x=MARGIN;for(const m of models){let top=tableHead(m,x,heading(m,x,y));m.rows.forEach((r,i)=>{top=row(m,r,x,top,i);});footer(m,x,top);x+=m.width+15;}
      y-=height+12;
    }else{
      for(const m of models){
        if(y<PAGE[1]-MARGIN)addPage();
        let top=tableHead(m,MARGIN,heading(m,MARGIN,y)),continued=false;
        for(let i=0;i<m.rows.length;i++){
          const r=m.rows[i];
          if(top-r.height-m.footer<MARGIN){addPage();continued=true;top=tableHead(m,MARGIN,heading(m,MARGIN,y,continued));}
          if(r.height>top-MARGIN-m.footer)throw Error('A stop name is too long to fit on a PDF page.');
          top=row(m,r,MARGIN,top,i);
        }
        y=footer(m,MARGIN,top)-12;
      }
    }
    rendered+=models.length;onProgress('Rendering PDF preview… '+rendered+' / '+total+' panels');
  }
  return pdf.save();
}

