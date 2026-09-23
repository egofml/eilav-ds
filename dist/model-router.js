(function(root){'use strict';
const STORAGE_KEY='eilav.gemini.model-health.v1',COOLDOWN_MS=15*60*1000,FAILURE_WINDOW_MS=2*60*1000,SUCCESS_WINDOW_MS=60*1000,MAX_MODELS=3;
const safeModel=model=>typeof model==='string'&&/^gemini-\d+(?:\.\d+)*-flash(?:-lite)?(?:-\d{3})?$/.test(model);
function unavailable(scope){const error=Error(scope==='global'?'여러 프로젝트에서 같은 모델의 서버 오류가 확인되어 잠시 제외했습니다. 완료 결과는 유지됩니다. 약 15분 후 시작 / 이어하기로 다시 확인해주세요.':'이 프로젝트에서 이번 실행에 사용할 같은 계열의 안정 모델이 없습니다. 다른 사용 가능한 프로젝트를 확인합니다. 완료 결과는 유지됩니다.');error.code='AI_MODELS_UNAVAILABLE';error.scope=scope;return error;}
class ModelRouter {
 constructor({listModels,now=Date.now,storage=null,onStatus=()=>{}}={}){
  if(typeof listModels!=='function')throw TypeError('listModels가 필요합니다.');
  this.listModels=listModels;this.now=now;this.storage=storage;this.onStatus=onStatus;this.blocked=new Map();this.beginRun();
  // Version 1 treated one request failure as a global outage; never restore it.
  try{const saved=JSON.parse(storage?.getItem(STORAGE_KEY)||'null');if(saved?.version===2&&Array.isArray(saved.blocked))for(const item of saved.blocked.slice(0,100)){if(safeModel(item?.model)&&Number.isFinite(item.until)&&item.until>now()&&item.until<=now()+COOLDOWN_MS)this.blocked.set(item.model,item.until);}}catch{}
 }
 beginRun(){this.projects=new Map();this.health=new Map();}
 persist(){this.prune();try{this.storage?.setItem(STORAGE_KEY,JSON.stringify({version:2,blocked:[...this.blocked].slice(-100).map(([model,until])=>({model,until}))}));}catch{}}
 prune(){const at=this.now();for(const [model,until]of this.blocked)if(until<=at)this.blocked.delete(model);}
 evidence(model){let health=this.health.get(model);if(!health){health={failures:new Map(),successAt:null};this.health.set(model,health);}return health;}
 failed(model,project,status){
  this.projects.get(project).failed.add(model);
  if(status!==404){const at=this.now(),health=this.evidence(model);for(const [source,time]of health.failures)if(at-time>FAILURE_WINDOW_MS)health.failures.delete(source);health.failures.set(project,at);
   if(health.failures.size>=2&&(health.successAt===null||at-health.successAt>=SUCCESS_WINDOW_MS))this.blocked.set(model,at+COOLDOWN_MS);
  }
  this.persist();
 }
 succeeded(model){const health=this.evidence(model);health.successAt=this.now();health.failures.clear();if(this.blocked.delete(model))this.persist();}
 async state({key,project}){
  let state=this.projects.get(project);
  if(!state){state={attempted:new Set(),failed:new Set(),models:null};this.projects.set(project,state);}
  if(!state.models){const pending=Promise.resolve().then(()=>this.listModels({key})).then(models=>{
    const candidates=[...new Set((Array.isArray(models)?models:[]).filter(safeModel))];
    // A failing Lite model must never silently raise the user's cost tier.
    return candidates.some(model=>model.includes('-flash-lite'))?candidates.filter(model=>model.includes('-flash-lite')):candidates;
   });state.models=pending;pending.catch(()=>{if(state.models===pending)state.models=null;});}
  return {state,models:await state.models};
 }
 async resolve({key,project,automatic=true,model}){
  if(!automatic)return model;
  const {state,models}=await this.state({key,project});this.prune();
  const selected=models.find(candidate=>!state.failed.has(candidate)&&!this.blocked.has(candidate)&&(state.attempted.has(candidate)||state.attempted.size<MAX_MODELS));
  if(!selected)throw unavailable(models.length>0&&models.every(candidate=>this.blocked.has(candidate))?'global':'project');return selected;
 }
 async execute({key,project,automatic=true,model,request,onModel=()=>{}}){
  const selected=await this.resolve({key,project,automatic,model});
  if(automatic)this.projects.get(project).attempted.add(selected);
  onModel(selected);
  try{const result=await request(selected);if(automatic)this.succeeded(selected);return result;}catch(error){
   if(!automatic||![500,502,503,504,404].includes(error?.status))throw error;
   this.failed(selected,project,error.status);
   let next;try{next=await this.resolve({key,project,automatic,model});}catch(nextError){if(nextError.code!=='AI_MODELS_UNAVAILABLE')throw nextError;this.notify({project,model:selected,code:'AI_MODELS_UNAVAILABLE',scope:nextError.scope,message:selected+' 응답 오류 · 이 프로젝트의 같은 계열 대체 모델 없음'});throw nextError;}
   const switched=Error(selected+' 응답 오류 · '+next+' 모델로 전환합니다.');switched.code='AI_MODEL_SWITCH';switched.model=selected;switched.nextModel=next;
   this.notify({project,model:selected,nextModel:next,code:switched.code,message:switched.message});throw switched;
  }
 }
 notify(event){try{this.onStatus(event);}catch{}}
}
if(typeof module!=='undefined'&&module.exports)module.exports=ModelRouter;else root.DSModelRouter=ModelRouter;
})(typeof window==='undefined'?globalThis:window);
