import path from 'node:path';
import {isIP} from 'node:net';
import {readFileSync,statSync} from 'node:fs';

// Public browser origins are explicit: never infer them from untrusted proxy headers.
export function serverConfig(env, root) {
  const mode=env.GRAPH_MODE||'local';
  if(!['local','demo'].includes(mode))throw Error('GRAPH_MODE: используйте local или demo.');
  const demo=mode==='demo';
  const port=Number(env.PORT||4318),runnerPort=Number(env.RUNNER_PORT||port+1);
  if(![port,runnerPort].every(n=>Number.isInteger(n)&&n>=1024&&n<=65535)||port===runnerPort)
    throw Error('PORT и RUNNER_PORT: разные целые числа от 1024 до 65535.');
  const host=env.GRAPH_BIND_HOST||'127.0.0.1';
  if(!isIP(host)||!demo&&host!=='127.0.0.1')throw Error('GRAPH_BIND_HOST: IP-адрес; в режиме local используйте 127.0.0.1.');
  function publicOrigin(name,fallback) {
    const value=env[name]||fallback;
    let url;
    try{url=new URL(value);}catch{throw Error(`${name}: укажите полный HTTPS origin без пути.`);}
    if(value!==url.origin||demo&&url.protocol!=='https:'||!demo&&value!==fallback)
      throw Error(`${name}: в demo нужен HTTPS origin без пути; в local сохраните стандартный адрес.`);
    return url;
  }
  const app=publicOrigin('APP_ORIGIN',demo?'':`http://127.0.0.1:${port}`);
  const runner=publicOrigin('RUNNER_ORIGIN',demo?'':`http://127.0.0.1:${runnerPort}`);
  if(demo&&app.hostname===runner.hostname)throw Error('APP_ORIGIN и RUNNER_ORIGIN должны иметь разные имена хостов: cookies не изолируются портами.');
  if(env.DEMO_PASSWORD&&env.DEMO_PASSWORD_FILE)throw Error('Задайте только DEMO_PASSWORD или DEMO_PASSWORD_FILE.');
  let demoPassword=env.DEMO_PASSWORD||'';
  if(env.DEMO_PASSWORD_FILE){
    try{
      if(statSync(env.DEMO_PASSWORD_FILE).size>2048)throw Error();
      demoPassword=readFileSync(env.DEMO_PASSWORD_FILE,'utf8').replace(/\r?\n$/,'');
    }catch{throw Error('Не удалось прочитать DEMO_PASSWORD_FILE. Проверьте файл и права доступа.');}
  }
  const demoUser=env.DEMO_USER||'';
  if(demo&&(!/^[A-Za-z0-9_.-]{3,64}$/.test(demoUser)||demoPassword.length<16||demoPassword.length>256||/[\r\n]/.test(demoPassword)))
    throw Error('Для demo задайте DEMO_USER (3–64 латинских символа) и отдельный DEMO_PASSWORD (16–256 символов).');
  if(demo&&(!env.GRAPH_DB||!path.isAbsolute(env.GRAPH_DB)))throw Error('Для demo укажите абсолютный GRAPH_DB в отдельной папке данных.');
  if(!['0','1'].includes(env.GRAPH_TRUST_PROXY||'0')||!demo&&env.GRAPH_TRUST_PROXY==='1')throw Error('GRAPH_TRUST_PROXY: 0 по умолчанию; 1 только для demo за закрытым доверенным прокси.');
  return Object.freeze({mode,demo,host,port,runnerPort,origin:app.origin,runnerOrigin:runner.origin,
    appHost:app.host,runnerHost:runner.host,dbFile:env.GRAPH_DB||path.join(root,'.local','classroom.sqlite'),
    trustProxy:env.GRAPH_TRUST_PROXY==='1',demoUser,demoPassword,cookieName:demo?'__Host-graph_session':'graph_session',secureCookie:demo?'; Secure':''});
}
