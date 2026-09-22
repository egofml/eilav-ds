(function(root){'use strict';
const emptyUsage=()=>({requests:0,responses:0,input:0,output:0,total:0});
const pacific=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function parts(at){return Object.fromEntries(pacific.formatToParts(at).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));}
function midnight(day){let at=day+8*3600000;for(let i=0;i<3;i++){const p=parts(at);at+=day-Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);}return at;}
function usageWindow(at){const p=parts(at),day=Date.UTC(p.year,p.month-1,p.day);return {day:new Date(day).toISOString().slice(0,10),start:midnight(day),end:midnight(day+86400000)};}
class KeyPool {
 constructor({now=Date.now}={}){this.now=now;this.keys=[];this.projects=new Map();this.active=null;this.busy=false;this.counter=0;this.runningProjects=new Set();this.nextRequest=new Map();}
 usagePeriod(){const at=this.now();if(!this.period||at<this.period.start||at>=this.period.end)this.period=usageWindow(at);return {...this.period};}
 daily(entry){const period=this.usagePeriod();if(entry.usageDay!==period.day){entry.usageDay=period.day;entry.dailyUsage=emptyUsage();}return entry.dailyUsage;}
 countRequest(entry){entry.usage.requests++;this.daily(entry).requests++;}
 workerProjects(limit=4){return [...new Set(this.summary().filter(k=>k.status==='ready'||k.status==='quota'&&!['daily','unavailable'].includes(this.projects.get(k.project)?.kind)).sort((a,b)=>Number(b.active)-Number(a.active)).map(k=>k.project))].slice(0,Math.max(1,Math.min(4,limit)));}
 async executeProject(project,request,{paceMs=0,quotaRetries=null,stopped=()=>false,onWait=()=>{},wait=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}={}){
 if(this.runningProjects.has(project)||this.busy&&!this.runningProjects.size)throw Error('해당 프로젝트 요청이 이미 진행 중입니다.');
 const entry=this.keys.filter(k=>k.project===project&&k.status!=='invalid').sort((a,b)=>Number(b.id===this.active)-Number(a.id===this.active))[0];
 if(!entry)throw Error('사용 가능한 프로젝트 키가 없습니다.');
 this.runningProjects.add(project);this.busy=true;
 const pause=async(ms,label)=>{for(let left=Math.max(0,ms);left>0;){if(stopped())throw Error('사용자가 검토를 중지했습니다.');onWait(label+' · '+Math.ceil(left/1000)+'초');const part=Math.min(1000,left);await wait(part);left-=part;}if(stopped())throw Error('사용자가 검토를 중지했습니다.');};
 try{
  const state=this.projects.get(project);
  if(state){if(['daily','unavailable'].includes(state.kind))throw Error(state.kind==='daily'?'일일 요청 한도 소진 · Google 한도 확인 필요':'사용 가능한 할당량 없음 · Google 설정 확인 필요');
   await pause(state.retryAt-now(),'이전 제한 대기');this.projects.delete(project);}
  for(let attempt=0;;attempt++){
   await pause((this.nextRequest.get(project)||0)-now(),'요청 간격 조절');
   if(stopped())throw Error('사용자가 검토를 중지했습니다.');
   this.nextRequest.set(project,now()+paceMs);onWait('요청 중');this.countRequest(entry);
   try{const result=await request(entry.key);this.projects.delete(project);return result;}
   catch(e){
    if(e.status===401||e.status===403)entry.status='invalid';
    if(e.status!==429)throw e;
    const kind=e.quotaKind||'unknown',delay=Math.max(60000,e.retryAfterMs||0)+1000;
    this.projects.set(project,{retryAt:now()+delay,kind});
    const maxRetries=quotaRetries??(kind==='temporary'?3:kind==='unknown'?1:0);
    if(attempt>=maxRetries)throw e;
    await pause(delay,kind==='temporary'?'일시 제한 자동 재개 대기':'한도 종류 미확인 · 한 번 재시도 대기');
    this.projects.delete(project);
   }
  }
 }finally{this.runningProjects.delete(project);this.busy=this.runningProjects.size>0;}
 }

 createDispatch(){return {retired:new Set(),strikes:new Map()};}
 async executeAny(request,{dispatch=this.createDispatch(),fallback=true,stopped=()=>false,onProject=()=>{},wait=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,...options}={}){
  while(!stopped()){
   const candidates=[...new Set(this.keys.filter(k=>k.status!=='invalid'&&!dispatch.retired.has(k.project)&&!['daily','unavailable'].includes(this.projects.get(k.project)?.kind)).map(k=>k.project))];
   if(!candidates.length)throw Error('이번 실행에서 사용할 수 있는 프로젝트가 없습니다. 완료 결과는 유지됩니다.');
   const free=candidates.filter(p=>!this.runningProjects.has(p)).sort((a,b)=>(this.projects.get(a)?.retryAt||0)-(this.projects.get(b)?.retryAt||0));
   const project=free[0],remaining=project?(this.projects.get(project)?.retryAt||0)-now():1000;
   if(!project||remaining>0){onProject(project||'',project?'한도 대기 · '+Math.ceil(remaining/1000)+'초':'다른 프로젝트 요청 완료 대기');await wait(Math.min(1000,Math.max(1,remaining)));continue;}
   onProject(project,'배정됨');
   try{return await this.executeProject(project,key=>request(key,project),{...options,quotaRetries:0,stopped,wait,now,onWait:state=>onProject(project,state)});}
   catch(e){
    if(stopped()||!fallback)throw e;
    if(e.status===429){
     const strikes=(dispatch.strikes.get(project)||0)+1;dispatch.strikes.set(project,strikes);
     const max=e.quotaKind==='temporary'?4:e.quotaKind==='unknown'||!e.quotaKind?2:1;
     if(strikes>=max)dispatch.retired.add(project);
     onProject(project,dispatch.retired.has(project)?'한도 반복 · 이번 실행 중지':'한도 대기 · 다른 프로젝트에 인계');
     continue;
    }
    if(e.status===401||e.status===403||e.status===404){dispatch.retired.add(project);onProject(project,'오류 · 다른 프로젝트에 인계');continue;}
    throw e;
   }
  }
  throw Error('사용자가 검토를 중지했습니다.');
 }
 save(storage){for(const k of this.keys)this.daily(k);if(!this.keys.length){storage.removeItem('eilav.gemini.keys.v1');return;}storage.setItem('eilav.gemini.keys.v1',JSON.stringify({version:1,keys:this.keys,active:this.active,projects:[...this.projects]}));}
 restore(storage){const raw=storage.getItem('eilav.gemini.keys.v1');if(!raw)return;const data=JSON.parse(raw);if(data.version!==1||!Array.isArray(data.keys)||data.keys.length>20||!Array.isArray(data.projects))throw Error('저장된 키 목록을 읽을 수 없습니다.');const next=new KeyPool({now:this.now});for(const k of data.keys){const id=next.add(k.label,k.project,k.key);if(k.usage){const u=k.usage;for(const field of ['requests','responses','input','output','total'])next.keys.at(-1).usage[field]=Number.isSafeInteger(u[field])&&u[field]>=0?u[field]:0;}if(k.usageDay===next.usagePeriod().day&&k.dailyUsage){const entry=next.keys.at(-1);next.daily(entry);for(const field of Object.keys(emptyUsage()))entry.dailyUsage[field]=Number.isSafeInteger(k.dailyUsage[field])&&k.dailyUsage[field]>=0?k.dailyUsage[field]:0;}if(k.status==='invalid')next.keys.at(-1).status='invalid';if(k.id===data.active)next.active=id;}for(const [project,state]of data.projects){if(typeof project!=='string'||!Number.isFinite(state?.retryAt))throw Error('저장된 한도 정보를 읽을 수 없습니다.');next.projects.set(project,{retryAt:state.retryAt,kind:['temporary','daily','unavailable','unknown'].includes(state.kind)?state.kind:'unknown'});}this.keys=next.keys;this.active=next.active;this.projects=next.projects;this.counter=next.counter;}
 add(label,project,key){label=label.trim();project=project.trim().toLowerCase();key=key.trim();if(!label||!project||!key)throw Error('키 이름, Google 프로젝트 ID, API 키를 입력해주세요.');if(label.length>60||!/^[a-z0-9][a-z0-9-]{2,62}$/.test(project))throw Error('실제 Google 프로젝트 ID를 입력해주세요. 영문 소문자·숫자·하이픈만 사용할 수 있습니다.');if(this.keys.length>=20)throw Error('최대 20개 키까지 등록할 수 있습니다.');if(this.keys.some(k=>k.key===key))throw Error('이미 등록한 API 키입니다.');const entry={id:++this.counter,label,project,key,status:'ready',usage:{requests:0,responses:0,input:0,output:0,total:0}};this.daily(entry);this.keys.push(entry);if(!this.active)this.active=entry.id;return entry.id;}
 remove(id){if(this.busy)throw Error('요청이 끝난 뒤 키를 삭제해주세요.');const entry=this.keys.find(k=>k.id===id);if(entry)entry.key='';this.keys=this.keys.filter(k=>k.id!==id);if(this.active===id)this.active=this.keys[0]?.id||null;}
 select(id){if(this.busy)throw Error('요청이 끝난 뒤 키를 바꿔주세요.');if(!this.keys.some(k=>k.id===id))throw Error('등록된 키를 선택해주세요.');this.active=id;}
 reset(project,now=Date.now()){const state=this.projects.get(project);if(state&&now<state.retryAt)throw Error('대기 시간이 지나지 않았습니다. 잠시 후 다시 시도해주세요.');this.projects.delete(project);for(const key of this.keys)if(key.project===project)key.status='ready';}
 async test(id,request){if(this.busy)throw Error('진행 중인 요청이 끝난 뒤 테스트해주세요.');const entry=this.keys.find(k=>k.id===id);if(!entry)throw Error('등록된 키를 선택해주세요.');const quota=this.projects.get(entry.project);if(quota&&Date.now()<quota.retryAt)throw Error('한도 초과 대기 시간이 지나지 않았습니다.');this.busy=true;try{this.countRequest(entry);const result=await request(entry.key);entry.status='ready';this.projects.delete(entry.project);return result;}catch(e){if(e.status===429)this.projects.set(entry.project,{retryAt:Date.now()+Math.max(60000,e.retryAfterMs||0),kind:e.quotaKind||'unknown'});if(e.status===401||e.status===403)entry.status='invalid';throw e;}finally{this.busy=false;}}
 recordUsage(key,metadata){const entry=this.keys.find(k=>k.key===key);if(!entry)return;entry.usage.responses++;const daily=this.daily(entry);daily.responses++;for(const [field,source]of [["input","promptTokenCount"],["output","candidatesTokenCount"],["total","totalTokenCount"]]){const n=metadata[source];if(Number.isSafeInteger(n)&&n>=0){entry.usage[field]+=n;daily[field]+=n;}}}
 summary(){return this.keys.map(k=>({id:k.id,label:k.label,project:k.project,active:k.id===this.active,status:this.projects.has(k.project)?'quota':k.status,quotaKind:this.projects.get(k.project)?.kind,mask:'••••'+k.key.slice(-4),usage:{...k.usage},dailyUsage:{...this.daily(k)},usageDay:k.usageDay}));}
 async execute(request,{fallback=true,onSwitch=()=>{}}={}){if(this.busy)throw Error('이미 Gemini 요청을 처리하고 있습니다.');if(!this.keys.length)throw Error('Gemini API 키를 먼저 등록해주세요.');this.busy=true;const candidates=[...this.keys].sort((a,b)=>(b.id===this.active)-(a.id===this.active));const attempted=new Set();let lastError;try{for(const key of candidates){if(!fallback&&key.id!==this.active)continue;if(key.status==='invalid'||this.projects.has(key.project)||attempted.has(key.project))continue;attempted.add(key.project);onSwitch({label:key.label,project:key.project});try{this.countRequest(key);const value=await request(key.key);this.active=key.id;return value;}catch(error){lastError=error;if(error.status===429){this.projects.set(key.project,{retryAt:Date.now()+Math.max(60000,error.retryAfterMs||0),kind:error.quotaKind||'unknown'});if(!fallback)throw error;continue;}if(error.status===401||error.status===403){key.status='invalid';throw error;}throw error;}}throw lastError||Error('사용 가능한 프로젝트가 없습니다. Google AI Studio에서 한도를 확인한 후 중지를 해제해주세요.');}finally{this.busy=false;}}
}
if(typeof module!=='undefined'&&module.exports)module.exports=KeyPool;else root.DSKeyPool=KeyPool;
})(typeof window==='undefined'?globalThis:window);
