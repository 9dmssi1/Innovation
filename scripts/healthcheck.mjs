import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {serverConfig} from '../server-config.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const config=serverConfig(process.env,root);
const authorization='Basic '+Buffer.from(config.demoUser+':'+config.demoPassword).toString('base64');
function probe(port,host,route,headers={}){
  return new Promise((resolve,reject)=>{
    const req=http.get({hostname:config.host==='::'?'::1':'127.0.0.1',port,path:route,headers:{Host:host,...headers}},res=>{
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>4096){req.destroy(Error('Unexpected health response'));return;}chunks.push(chunk);});
      res.on('error',reject);
      res.on('end',()=>res.statusCode===200?resolve(Buffer.concat(chunks).toString()):reject(Error('Health endpoint unavailable')));
    });
    req.setTimeout(3000,()=>req.destroy(Error('Health check timed out')));
    req.on('error',reject);
  });
}
try{
  const [health,runner]=await Promise.all([
    probe(config.port,config.appHost,'/healthz',config.demo?{Authorization:authorization}:{}),
    probe(config.runnerPort,config.runnerHost,'/runner-config.js')
  ]);
  if(JSON.parse(health).ok!==true||runner!==`export const parentOrigin=${JSON.stringify(config.origin)};\n`)throw Error('Service is not ready');
}catch{
  console.error('Приложение, база или среда Python не готовы.');process.exitCode=1;
}
