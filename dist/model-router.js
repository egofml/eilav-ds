(function(root){'use strict';
const STORAGE_KEY='eilav.gemini.model-health.v1',COOLDOWN_MS=15*60*1000,MAX_MODELS=3;
const safeModel=model=>typeof model==='string'&&/^gemini-\d+(?:\.\d+)*-flash(?:-lite)?(?:-\d{3})?$/.test(model);
function unavailable(){const error=Error('현재 사용 가능한 같은 계열의 안정 모델이 없습니다. 완료 결과는 유지됩니다. 약 15분 후 시작 / 이어하기로 다시 확인해주세요.');error.code='AI_MODELS_UNAVAILABLE';return error;}
class ModelRouter {
 constructor({listModels,now=Date.now,storage=null,onStatus=()=>{}}={}){
  if(typeof listModels!=='function')throw TypeError('listModels가 필요합니다.');
  this.listModels=listModels;this.now=now;this.storage=storage;this.onStatus=onStatus;this.blocked=new Map();this.beginRun();
  try{const saved=JSON.parse(storage?.getItem(STORAGE_KEY)||'null');if(saved?.version===1&&Array.isArray(saved.blocked))for(const item of saved.blocked.slice(0,100)){if(safeModel(item?.model)&&Number.isFinite(item.until)&&item.until>now()&&item.until<=now()+COOLDOWN_MS)this.blocked.set(item.model,item.until);}}catch{}
 }
 beginRun(){this.projects=new Map();}
 persist(){this.prune();try{this.storage?.setItem(STORAGE_KEY,JSON.stringify({version:1,blocked:[...this.blocked].slice(-100).map(([model,until])=>({model,until}))}));}catch{}}
 prune(){const at=this.now();for(const [model,until]of this.blocked)if(until<=at)this.blocked.delete(model);}
 async state({key,project}){
  let state=this.projects.get(project);
  if(!state){state={attempted:new Set(),models:null};this.projects.set(project,state);}
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
  const selected=models.find(candidate=>!this.blocked.has(candidate)&&(state.attempted.has(candidate)||state.attempted.size<MAX_MODELS));
  if(!selected)throw unavailable();return selected;
 }
 async execute({key,project,automatic=true,model,request,onModel=()=>{}}){
  const selected=await this.resolve({key,project,automatic,model});
  if(automatic)this.projects.get(project).attempted.add(selected);
  onModel(selected);
  try{return await request(selected);}catch(error){
   if(!automatic||![500,502,503,504,404].includes(error?.status))throw error;
   this.blocked.set(selected,this.now()+COOLDOWN_MS);this.persist();
   let next;try{next=await this.resolve({key,project,automatic,model});}catch(nextError){if(nextError.code!=='AI_MODELS_UNAVAILABLE')throw nextError;this.notify({project,model:selected,code:'AI_MODELS_UNAVAILABLE',message:selected+' 응답 오류 · 같은 등급의 대체 모델 없음'});throw nextError;}
   const switched=Error(selected+' 응답 오류 · '+next+' 모델로 전환합니다.');switched.code='AI_MODEL_SWITCH';switched.model=selected;switched.nextModel=next;
   this.notify({project,model:selected,nextModel:next,code:switched.code,message:switched.message});throw switched;
  }
 }
 notify(event){try{this.onStatus(event);}catch{}}
}
if(typeof module!=='undefined'&&module.exports)module.exports=ModelRouter;else root.DSModelRouter=ModelRouter;
})(typeof window==='undefined'?globalThis:window);
