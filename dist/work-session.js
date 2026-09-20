(function(root){'use strict';
function encode({source,options,rows}){return {version:1,source,options,edits:rows.map(r=>({checks:r.keywordChecks||[],status:r.status,name:r.approvedName,evidence:r.evidence||'',error:r.aiError})),savedAt:new Date().toISOString()};}
function decode(data,DS,G){
 if(data?.version!==1||typeof data.source!=='string'||!Array.isArray(data.edits))throw Error('지원하지 않는 작업 저장 형식입니다.');
 const o=data.options;if(!o||!Array.isArray(o.terms)||o.terms.length>20000||o.terms.some(t=>typeof t!=='string'||t.length>200)||o.position!=='ai'||typeof o.includeZero!=='boolean')throw Error('저장된 수정 규칙이 올바르지 않습니다.');
 const table=DS.tableFrom(data.source);let rows=DS.analyze(table,o);if(rows.length!==data.edits.length)throw Error('저장된 행 수가 다릅니다.');
 const matcher=DS.makeMatcher(o.terms);rows=rows.map((row,i)=>{const edit=data.edits[i];if(!edit||!Array.isArray(edit.checks))throw Error('저장된 검토 형식이 다릅니다.');if(row.blank||row.exclusion?.length)return row;
 if(edit.checks.length){const result=G.validateResult([{id:i,keywords:edit.checks}],[{id:i,title:row.cleaned,candidates:row.candidates}]);row=DS.applyKeywordReview(row,result[0].keywords,'ai');}
 if(edit.status==='approved')row=DS.approve(row,edit.name,typeof edit.evidence==='string'?edit.evidence:'',o.terms,matcher);
 else if(edit.status==='held')row={...row,status:'held',evidence:typeof edit.evidence==='string'?edit.evidence:''};
 if(typeof edit.error==='string')row.aiError=edit.error.slice(0,1000);return row;});
 return {table,rows,options:o,source:data.source};
}
function storage(indexedDB){let connection;function db(){return connection||(connection=new Promise((resolve,reject)=>{const request=indexedDB.open('eilav-work-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('work');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);}));}
 async function transact(mode,value){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('work',mode),store=tx.objectStore('work');const request=mode==='readonly'?store.get('latest'):store.put(value,'latest');tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('저장 중단'));});}
 return {read:()=>transact('readonly'),write:value=>transact('readwrite',value)};
}
const api={encode,decode,storage};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DSSession=api;
})(typeof window==='undefined'?globalThis:window);
