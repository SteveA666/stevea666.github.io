export function importFileFrom(files) {
  if(files.length!==1)throw new Error('Choose or drop one GTFS ZIP at a time.');
  const file=files[0];
  if(!/\.zip$/i.test(file.name))throw new Error('Choose or drop a GTFS .zip file.');
  if(file.size>50*1024*1024)throw new Error('Choose a ZIP smaller than 50 MB.');
  return file;
}
export function installFileDrop(target,{onFile,onDragChange,onError}) {
  let depth=0;
  const isFile=e=>[...(e.dataTransfer?.types||[])].includes('Files');
  target.addEventListener('dragenter',e=>{if(!isFile(e))return;e.preventDefault();depth++;onDragChange(true);});
  target.addEventListener('dragover',e=>{if(!isFile(e))return;e.preventDefault();e.dataTransfer.dropEffect='copy';});
  target.addEventListener('dragleave',e=>{if(!depth)return;e.preventDefault();depth=Math.max(0,depth-1);if(!depth)onDragChange(false);});
  target.addEventListener('drop',e=>{if(!isFile(e))return;e.preventDefault();depth=0;onDragChange(false);try{onFile(importFileFrom([...e.dataTransfer.files]));}catch(error){onError(error.message);}});
  target.addEventListener('dragend',()=>{depth=0;onDragChange(false);});
}
