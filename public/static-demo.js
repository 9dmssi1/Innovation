const messages={
  badge:['Демо · без регистрации','Демо · тіркелусіз'],
  note:['Открытая демонстрация: курс, графы, миссии и Python работают без регистрации. Прогресс и черновики сохраняются только в этом браузере. Классы и отправка работ учителю доступны в серверной версии.','Ашық демонстрация: курс, графтар, миссиялар және Python тіркелусіз жұмыс істейді. Ілгерілеу мен жобалар тек осы браузерде сақталады. Сыныптар мен мұғалімге жұмыс жіберу серверлік нұсқада қолжетімді.'],
  title:['Мои результаты на этом устройстве','Осы құрылғыдағы нәтижелерім'],
  python:['Python загружается с jsDelivr и выполняется в отдельном процессе браузера. Для первого запуска нужен интернет. В этой демонстрации работы сохраняются на вашем устройстве.','Python jsDelivr арқылы жүктеліп, браузердің бөлек процесінде орындалады. Алғашқы іске қосуға интернет қажет. Бұл демонстрацияда жұмыстар құрылғыңызда сақталады.'],
};
export const demoText=(key,locale='ru')=>messages[key][locale==='kk'?1:0];

// A data: Worker has an opaque origin, unlike a same-origin blob Worker.
// It cannot access the app's DOM or origin-bound browser storage. Never fall
// back to executing learner code on the page or in a same-origin iframe.
export class StaticPython {
  constructor(receive){this.receive=receive;this.active=null;this.worker=null;this.timer=null;}
  stop(){clearTimeout(this.timer);this.worker?.terminate();this.worker=null;this.active=null;}
  async send(d){
    if(d.type==='cancel'){if(this.active===d.token)this.stop();return;}
    this.stop();this.active=d.token;
    const emit=message=>{if(this.active===d.token)this.receive({...message,token:d.token});};
    const fail=message=>{emit({type:'error',message});if(this.active===d.token)this.stop();};
    this.timer=setTimeout(()=>fail('Не удалось загрузить Python за 90 секунд. Проверьте доступ к интернету и повторите.'),90000);
    emit({type:'status',message:'Загружаем Python. При первом запуске это может занять некоторое время…'});
    try{
      const response=await fetch(new URL('./python-worker.js',import.meta.url),{signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('Worker source unavailable');
      const source=await response.text();
      if(this.active!==d.token)return;
      // Refuse execution in browsers that do not isolate data: workers.
      const isolated="if(self.origin!=='null'){throw Error('Opaque worker required');}\n"+source;
      const worker=new Worker('data:text/javascript;charset=utf-8,'+encodeURIComponent(isolated));
      this.worker=worker;
      worker.onmessage=event=>{
        if(this.active!==d.token)return;
        const message=event.data;
        if(message?.type==='ready'){
          clearTimeout(this.timer);
          this.timer=setTimeout(()=>fail('Выполнение остановлено: превышен лимит 8 секунд. Проверьте циклы и условие завершения рекурсии.'),8000);
          emit({type:'status',message:'Python загружен. Выполняем проверки…'});
          worker.postMessage({code:d.code,kind:d.kind,graph:d.graph});
        }else if(message?.type==='result'||message?.type==='error'){
          emit(message);if(this.active===d.token)this.stop();
        }
      };
      worker.onerror=()=>fail('Среда Python не запустилась. Проверьте доступ к CDN jsDelivr и повторите.');
    }catch{if(this.active===d.token)fail('Среда Python не запустилась. Проверьте доступ к CDN jsDelivr и повторите.');}
  }
}
