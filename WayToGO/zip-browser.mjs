import {csv} from './gtfs.mjs';
const LIMIT=200*1024*1024;
const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=table[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
export async function unzipBrowser(input,onProgress=()=>{}) {
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.length>50*1024*1024)throw Error('ZIP exceeds the 50 MB limit.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decoder=new TextDecoder();
  const requireBytes=(offset,size)=>{if(offset<0||offset+size>bytes.length)throw Error('Invalid or truncated ZIP.');};
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0)throw Error('This file is not a supported GTFS ZIP.');
  const count=view.getUint16(end+10,true);let cursor=view.getUint32(end+16,true),total=0;const files={};
  if(count===65535)throw Error('ZIP64 archives are not supported.');
  for(let i=0;i<count;i++){
    requireBytes(cursor,46);if(view.getUint32(cursor,true)!==0x02014b50)throw Error('Invalid ZIP directory.');
    const flags=view.getUint16(cursor+8,true),method=view.getUint16(cursor+10,true),checksum=view.getUint32(cursor+16,true),size=view.getUint32(cursor+20,true),length=view.getUint32(cursor+24,true),n=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true),offset=view.getUint32(cursor+42,true);
    requireBytes(cursor+46,n+extra+comment);
    const name=decoder.decode(bytes.subarray(cursor+46,cursor+46+n)).split('/').pop().toLowerCase();cursor+=46+n+extra+comment;
    if(!/^(agency|routes|trips|stops|stop_times|calendar|calendar_dates|frequencies|shapes)\.txt$/.test(name))continue;
    if(flags&1)throw Error('Encrypted ZIPs are not supported.');
    total+=length;if(total>LIMIT)throw Error('Unpacked feed exceeds the 200 MB limit.');
    if(files[name])throw Error('Duplicate '+name+' in archive.');
    requireBytes(offset,30);if(view.getUint32(offset,true)!==0x04034b50)throw Error('Invalid ZIP entry.');
    const start=offset+30+view.getUint16(offset+26,true)+view.getUint16(offset+28,true);requireBytes(start,size);
    onProgress('Reading '+name+'…');
    const data=bytes.subarray(start,start+size);let output;
    if(method===0)output=data;
    else if(method===8){
      let stream;try{stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));}catch{throw Error('This browser cannot unpack GTFS ZIPs. Update Chrome, Edge, Firefox or Safari.');}
      const reader=stream.getReader();output=new Uint8Array(length);let position=0;
      try{while(true){const {value,done}=await reader.read();if(done)break;if(position+value.length>length){await reader.cancel();throw Error('ZIP entry exceeds its declared size.');}output.set(value,position);position+=value.length;}if(position!==length)throw Error('Damaged ZIP entry.');}finally{reader.releaseLock();}
    }else throw Error('Unsupported ZIP compression method.');
    if(output.length!==length||crc32(output)!==checksum)throw Error('Damaged ZIP entry: '+name);
    files[name]=csv(decoder.decode(output));
  }
  return files;
}

