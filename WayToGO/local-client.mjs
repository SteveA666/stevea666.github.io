export function createLocalClient(onProgress=()=>{}) {
  const worker=new Worker(new URL('./feed-worker.mjs?v=20261030-route21fix',import.meta.url),{type:'module'});
  const pending=new Map();let sequence=0;
  worker.onmessage=({data})=>{const request=pending.get(data.id);if(!request)return;if(data.progress){onProgress(data.progress);return;}pending.delete(data.id);if(data.error)request.reject(Error(data.error));else request.resolve(data.result);};
  worker.onerror=event=>{for(const request of pending.values())request.reject(Error(event.message||'Local processing failed. Reload the page and try again.'));pending.clear();};
  return {request(action,payload={},transfer=[]){return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});worker.postMessage({id,action,payload},transfer);});},close(){worker.terminate();for(const request of pending.values())request.reject(Error('Local worker closed.'));pending.clear();}};
}

