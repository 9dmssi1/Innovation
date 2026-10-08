import {isIP} from 'node:net';

// Enable only behind the bundled proxy, which overwrites this header. Host/Origin
// validation is independent of client addresses and never uses forwarded headers.
export function clientAddress(req,trustProxy=false){
  const forwarded=req.headers['x-graph-client-ip'];
  return trustProxy&&typeof forwarded==='string'&&isIP(forwarded)
    ?forwarded:req.socket.remoteAddress||'unknown';
}

export class WindowLimiter {
  constructor({windowMs=15*60000,maxEntries=5000}={}){this.windowMs=windowMs;this.maxEntries=maxEntries;this.entries=new Map();}
  prune(now=Date.now()){for(const [key,bucket] of this.entries)if(bucket.until<=now)this.entries.delete(key);}
  take(key,limit,now=Date.now()){
    let bucket=this.entries.get(key);
    if(!bucket||bucket.until<=now){
      if(this.entries.size>=this.maxEntries){this.prune(now);if(this.entries.size>=this.maxEntries&&!bucket)return false;}
      bucket={n:0,until:now+this.windowMs};this.entries.set(key,bucket);
    }
    if(bucket.n>=limit)return false;
    bucket.n++;return true;
  }
}

export function readJsonBody(req){
  const invalid=(status,message)=>Object.assign(Error(message),{status});
  return new Promise((resolve,reject)=>{
    let size=0,parts=[],settled=false;
    const rejectOnce=error=>{if(settled)return;settled=true;parts=[];reject(error);};
    req.on('error',()=>rejectOnce(invalid(400,'Запрос прерван.')));
    req.on('aborted',()=>rejectOnce(invalid(400,'Запрос прерван.')));
    req.on('data',chunk=>{
      if(settled)return;
      size+=chunk.length;
      if(size>65536){rejectOnce(invalid(413,'Слишком большой запрос.'));return;}
      parts.push(chunk);
    });
    req.on('end',()=>{
      if(settled)return;
      let data;
      try{data=JSON.parse(Buffer.concat(parts).toString()||'{}');}catch{rejectOnce(invalid(400,'Некорректный JSON.'));return;}
      if(!data||typeof data!=='object'||Array.isArray(data)){rejectOnce(invalid(400,'Ожидается JSON-объект.'));return;}
      settled=true;resolve(data);
    });
    if(Number(req.headers['content-length'])>65536)rejectOnce(invalid(413,'Слишком большой запрос.'));
  });
}
