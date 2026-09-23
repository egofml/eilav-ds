const test=require('node:test'),assert=require('node:assert/strict'),DS=require('../dist/core.js');
function row(index,title='바구니'){return {index,status:'pending',cleaned:title,original:title,proposed:title+' 정리용',candidates:['정리용'],keywordChecks:[{keyword:'정리용',status:'no_obvious_issue',afterWord:1}],excludedKeywords:[],empty:false};}
test('one invalid proposal does not cancel valid rows and preserves failed row',()=>{
 const good=row(0),bad={...row(1),proposed:'금지 바구니 정리용'};const result=DS.approveBatch([good,bad],['금지']);assert.equal(result.approved.length,1);assert.equal(result.approved[0].status,'approved');assert.deepEqual(result.failures,[{index:1,message:'금지어가 남아 있습니다. 제거 후 승인해주세요.'}]);assert.equal(bad.status,'pending');assert.equal(good.status,'pending');
});
test('pending unreviewed, empty, excluded, failed and approved rows never bulk apply',()=>{
 for(const change of [{keywordChecks:[]},{empty:true},{exclusion:['연령']},{aiError:'failed'},{status:'approved'},{blank:true}])assert.equal(DS.readyToApply({...row(0),...change}),false);
 assert.equal(DS.readyToApply({...row(0),candidates:['정리용','수납용'],keywordChecks:[{keyword:'정리용'},{keyword:'정리용'}]}),false);
});
test('unsafe and overlength proposals remain blocked while other reviewed rows apply',()=>{
 const a={...row(0),excludedKeywords:['바구니']},b={...row(1),proposed:'가'.repeat(201)},c=row(2);const r=DS.approveBatch([a,b,c],[]);assert.deepEqual(r.approved.map(x=>x.index),[2]);assert.deepEqual(r.failures.map(x=>x.index),[0,1]);assert.equal(DS.approveBatch(r.approved,[]).approved.length,0);
});
