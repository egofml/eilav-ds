const test=require('node:test'),assert=require('node:assert/strict'),G=require('../dist/gemini.js'),Batch=require('../dist/batch-review.js');
const model=id=>({name:'models/'+id,supportedGenerationMethods:['generateContent'],outputTokenLimit:8192});
test('auto prefers newest stable Lite, falls back to Flash, rejects unknown families',()=>{
 assert.equal(G.chooseModel(['gemini-4.0-pro','gemini-4.0-flash','gemini-3.1-flash-lite','gemini-3.0-flash-lite','gemini-5.0-flash-lite-preview','gemini-5.0-flash-image'].map(model)),'gemini-3.1-flash-lite');
 assert.equal(G.chooseModel(['gemini-3.1-flash','gemini-4.0-flash'].map(model)),'gemini-4.0-flash');
 assert.throws(()=>G.chooseModel([model('gemini-9.0-pro'),{...model('gemini-4.0-flash'),outputTokenLimit:1000}]),/자동 선택/);
});
test('auto follows pagination and next start notices retired model; manual never lists',async()=>{
 let calls=0;const fetcher=async(url,options)=>{calls++;assert.equal(options.headers['x-goog-api-key'],'fake');assert(!url.includes('fake'));return{ok:true,json:async()=>calls===1?{models:[model('gemini-3.0-flash')],nextPageToken:'next page'}:{models:[model('gemini-4.0-flash-lite')]}};};
 assert.equal(await G.resolveModel({key:'fake',fetcher}),'gemini-4.0-flash-lite');assert.equal(calls,2);
 assert.equal(await G.resolveModel({key:'fake',fetcher:async()=>({ok:true,json:async()=>({models:[model('gemini-5.0-flash-lite')]})})}),'gemini-5.0-flash-lite');
 assert.equal(await G.resolveModel({automatic:false,model:'gemini-manual',fetcher:()=>assert.fail()}),'gemini-manual');
 await assert.rejects(()=>G.resolveModel({key:'fake',fetcher:async()=>({ok:false,status:403})}),e=>e.status===403);
});
test('JSON schema request handles fenced valid response, flags truncation and malformed content',async()=>{
 const items=[{id:0,title:'주방 수납 바구니',candidates:['정리용']}],result=[{id:0,keywords:[{keyword:'정리용',status:'no_obvious_issue',reason:'용도',afterWord:1}]}];
 const run=(text,finishReason='STOP')=>G.check({key:'fake',model:'gemini-test',items,fetcher:async(url,opts)=>{const config=JSON.parse(opts.body).generationConfig;assert.equal(config.responseSchema.minItems,undefined);assert.equal(config.responseMimeType,'application/json');return{ok:true,json:async()=>({candidates:[{finishReason,content:{parts:[{text}]}}]})};}});
 assert.deepEqual(await run('```json\n'+JSON.stringify(result)+'\n```'),result);
 for(const [text,finish] of [['[','STOP'],['[','MAX_TOKENS'],['[]','STOP']])await assert.rejects(()=>run(text,finish),e=>e.code==='AI_FORMAT');
 await assert.rejects(()=>run('', 'SAFETY'),e=>e.code!=='AI_FORMAT');
});
test('format retry splits once, preserves IDs and stops repeated errors without partial application',async()=>{
 const items=Array.from({length:23},(_,id)=>({id})),seen=[],sizes=[];
 await Batch.run({items,request:async b=>{sizes.push(b.length);if(b.length>5)throw Object.assign(Error(),{code:'AI_FORMAT'});return b;},apply:b=>seen.push(...b),wait:async()=>{}});
 assert.deepEqual(sizes,[20,5,5,5,5,3]);assert.deepEqual(seen,items);
 let calls=0,applied=0,failed=[];const result=await Batch.run({items,request:async()=>{calls++;throw Object.assign(Error('bad'),{code:'AI_FORMAT'});},apply:()=>applied++,onFailure:item=>failed.push(item.id),wait:async()=>{}});assert.equal(result.completed,0);assert.equal(result.failed,23);assert.equal(calls,29);assert.equal(applied,0);assert.deepEqual(failed,items.map(x=>x.id));
});
