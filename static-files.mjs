// Кэшируются только публичные файлы. API и пользовательские данные сюда не попадают.
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
const compress=promisify(gzip),cache=new Map();
function acceptsGzip(header=''){
  const types=new Map(header.toLowerCase().split(',').map(part=>{
    const [name,...parameters]=part.trim().split(';');
    const q=parameters.find(p=>p.trim().startsWith('q='));
    return [name,q===undefined?1:Number(q.trim().slice(2))];
  }));
  return (types.get('gzip')??types.get('*')??0)>0;
}
export async function serveStatic(req,res,file,mime){
  const info=await stat(file);let item=cache.get(file);
  if(!item||item.mtime!==info.mtimeMs||item.size!==info.size){
    const data=await readFile(file);
    item={data,mtime:info.mtimeMs,size:info.size,hash:createHash('sha256').update(data).digest('hex').slice(0,24)};
    cache.set(file,item);
  }
  const compressed=item.data.length>=512&&acceptsGzip(req.headers['accept-encoding']);
  if(compressed&&!item.gzip)item.gzip=await compress(item.data);
  const data=compressed?item.gzip:item.data,etag=`"${item.hash}-${compressed?'gzip':'identity'}"`;
  res.setHeader('Cache-Control','public, max-age=0, must-revalidate');
  res.setHeader('Vary','Accept-Encoding');res.setHeader('ETag',etag);
  if(compressed)res.setHeader('Content-Encoding','gzip');
  const validators=String(req.headers['if-none-match']||'').split(',').map(s=>s.trim().replace(/^W\//,''));
  if(validators.includes(etag)||validators.includes('*')){res.writeHead(304);res.end();return;}
  res.writeHead(200,{'Content-Type':mime,'Content-Length':data.length});
  res.end(req.method==='HEAD'?undefined:data);
}
