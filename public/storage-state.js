// Read-only boundaries for untrusted browser JSON. Never mutate or write the
// source: an invalid saved record remains available for manual recovery.
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value:{};
const count=value=>Number.isSafeInteger(value)&&value>=0;

export function normalizeProgress(raw,lessons){
  if(!Array.isArray(raw))return [];
  const validLessons=new Map(lessons.map(l=>[l.id,l.questions.length])),entries=new Map();
  for(const item of raw){
    const p=object(item),total=validLessons.get(p.lesson_id);
    if(!total||p.total!==total||!count(p.score)||p.score>total)continue;
    const entry={lesson_id:p.lesson_id,score:p.score,total,attempts:count(p.attempts)?p.attempts:0},previous=entries.get(p.lesson_id);
    if(previous){entry.score=Math.max(previous.score,entry.score);entry.attempts=Math.max(previous.attempts,entry.attempts);}
    entries.set(p.lesson_id,entry);
  }
  return [...entries.values()];
}

export function normalizePractice(raw,lesson){
  const source=object(raw),answers=Array.isArray(source.answers)?source.answers:[];
  return {answers:lesson.questions.map((question,i)=>Number.isInteger(answers[i])&&answers[i]>=0&&answers[i]<question.options.length?answers[i]:null),path:typeof source.path==='string'?source.path:''};
}

export function normalizeDraft(raw,starter=''){
  const source=object(raw);
  return {code:typeof source.code==='string'?source.code:starter,note:typeof source.note==='string'?source.note:'',updated:count(source.updated)?source.updated:0};
}

export function normalizeLastLesson(raw,lessons){
  return Number.isInteger(raw)&&lessons.some(l=>l.id===raw)?raw:null;
}
