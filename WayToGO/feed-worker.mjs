import {unzipBrowser} from './zip-browser.mjs';
import {normalize} from './gtfs.mjs';
import {demo} from './demo.mjs';
let cachedSource,cachedId;
self.onmessage=async({data})=>{
  const {id,action,payload={}}=data;
  const progress=text=>self.postMessage({id,progress:text});
  try{
    let result;
    if(action==='import'){
      const source=await unzipBrowser(payload.buffer,progress);progress('Generating timetables…');
      const feed=normalize(source,{mode:payload.mode||'train'});
      cachedSource=source;cachedId=crypto.randomUUID();result={...feed,feedId:cachedId};
    }else if(action==='select'){
      if(!cachedSource||payload.id!==cachedId)throw Error('Please import your GTFS ZIP again.');
      progress('Loading schedule…');result={...normalize(cachedSource,{mode:payload.mode,routeId:payload.route||undefined}),feedId:cachedId};
    }else if(action==='demo'){cachedSource=undefined;cachedId=undefined;result=demo();}
    else if(action==='pdf'){
      progress('Rendering PDF preview…');const {renderBrowserPDF}=await import('./pdf-browser.mjs?v=20261030-route21fix');
      const bytes=await renderBrowserPDF(payload,progress);self.postMessage({id,result:bytes.buffer},[bytes.buffer]);return;
    }else throw Error('Unknown local operation.');
    self.postMessage({id,result});
  }catch(error){self.postMessage({id,error:error.message||String(error)});}
};

