// Transport only: never changes accounts, drafts or the current screen.
// A failed write is not retried automatically: the server may have saved it.
export class ApiError extends Error {
  constructor(message,code,status=0){super(message);this.name='ApiError';this.code=code;this.status=status;}
}

export async function requestJSON(url,{method='GET',csrf='',data,timeoutMs=15000,fetchImpl=globalThis.fetch}={}){
  const controller=new AbortController();let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{
    reject(new ApiError('Сервер не ответил вовремя. Проверьте соединение и повторите действие.','timeout'));
    controller.abort();
  },timeoutMs);});
  const perform=async()=>{
    let response;
    try{
      response=await fetchImpl(url,{method,credentials:'same-origin',redirect:'error',signal:controller.signal,
        headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},
        body:data===undefined?undefined:JSON.stringify(data)});
    }catch{
      throw new ApiError('Не удалось связаться с сервером. Проверьте подключение к интернету и повторите действие.','network');
    }
    if(response.status===401&&response.headers.get('www-authenticate'))
      throw new ApiError('Доступ к демонстрации не подтверждён. Обновите страницу и введите логин и пароль демонстрации.','demo-access',401);
    if(response.status>=500)
      throw new ApiError('Сервер временно недоступен. Подождите немного и повторите действие.','unavailable',response.status);
    // Proxy error pages can contain internal details. Never display their body.
    let result;
    if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))
      throw new ApiError('Получен некорректный ответ сервера. Повторите действие позже.','invalid-response',response.status);
    try{result=await response.json();}catch{
      throw new ApiError('Получен некорректный ответ сервера. Повторите действие позже.','invalid-response',response.status);
    }
    if(!response.ok){
      const message=typeof result?.error==='string'&&result.error.length<=500?result.error:'Не удалось выполнить запрос.';
      throw new ApiError(message,'http',response.status);
    }
    return result;
  };
  try{return await Promise.race([perform(),timeout]);}finally{clearTimeout(timer);}
}
