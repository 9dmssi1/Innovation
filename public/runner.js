'use strict';
// Этот документ обслуживается с ДРУГОГО origin, без API и доступа к DOM приложения.
const parentOrigin=`http://127.0.0.1:${Number(location.port)-1}`;
let worker=null,timer=null,active=null;
const send=data=>parent.postMessage({...data,token:active},parentOrigin);
function stop(){clearTimeout(timer);if(worker)worker.terminate();worker=null;}
window.addEventListener('message',event=>{
  if(event.origin!==parentOrigin||event.source!==parent)return;
  const d=event.data;
  if(!d||typeof d.token!=='string')return;
  if(d.type==='cancel'){if(active===d.token){stop();send({type:'cancelled'});active=null;}return;}
  if(d.type!=='run'||typeof d.code!=='string'||d.code.length>20000||!['bfs','dfs','path'].includes(d.kind))return;
  stop();active=d.token;
  worker=new Worker('/python-worker.js');
  timer=setTimeout(()=>{stop();send({type:'error',message:'Не удалось загрузить Python за 90 секунд. Проверьте доступ к интернету и повторите.'});},90000);
  worker.onmessage=event=>{
    const message=event.data;
    if(message.type==='ready'){clearTimeout(timer);send({type:'status',message:'Python загружен. Выполняем проверки…'});timer=setTimeout(()=>{stop();send({type:'error',message:'Выполнение остановлено: превышен лимит 8 секунд. Проверьте циклы и условие завершения рекурсии.'});},8000);worker.postMessage({code:d.code,kind:d.kind,graph:d.graph});}
    else if(message.type==='result'||message.type==='error'){stop();send(message);}
  };
  worker.onerror=()=>{stop();send({type:'error',message:'Среда Python не запустилась. Проверьте доступ к CDN jsDelivr и повторите.'});};
  send({type:'status',message:'Загружаем Python. При первом запуске это может занять некоторое время…'});
});
parent.postMessage({type:'runner-ready'},parentOrigin);
