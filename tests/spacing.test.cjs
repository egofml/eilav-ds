const test=require('node:test'),assert=require('node:assert/strict'),DS=require('../dist/core.js'),G=require('../dist/gemini.js'),S=require('../dist/work-session.js');
const title='왕골자동차방석V2자동차방석카방석방석왕골방석',spaced='왕골 자동차방석 V2 자동차방석 카방석 방석 왕골방석';
test('spacing limited to long unspaced Korean titles and preserves characters and model IDs',()=>{
 assert(DS.spacingEligible(title));assert.equal(DS.checkedSpacing(title,spaced),spaced);
 for(const name of ['주방 수납 바구니','짧은상품명','ABC123456789012345'])assert.throws(()=>DS.checkedSpacing(name,name+' '));
 for(const bad of [spaced.replace('V2','V 2'),spaced.replace('왕골','왕굴'),spaced+' 추가',spaced.replace('왕골','')])assert.throws(()=>DS.checkedSpacing(title,bad));
});
test('spacing review validates new positions and survives save and restore without changing source',()=>{
 const table=DS.tableFrom('상품코드\t상품명\t키워드\t배송비\t반품배송비\nA\t'+title+'\t차량용\t3000\t3000');
 const options={terms:[],shipping:500,returns:500,includeZero:false,position:'ai',keywordCount:1};
 const row=DS.analyze(table,options)[0],items=[{id:0,title,candidates:row.candidates}];
 const response=[{id:0,spacingTitle:spaced,keywords:[{keyword:'차량용',status:'no_obvious_issue',reason:'용도',afterWord:2}]}];
 const result=G.validateResult(G.excludeInvalidCandidates(response,items),items)[0];
 const next=DS.applyKeywordReview(row,result.keywords,'ai',result.spacingTitle);
 assert(next.proposed.includes('차량용'));assert.equal(next.cleaned,title);assert.equal(next.spacingTitle,spaced);
 const data=S.encode({source:DS.stringify([table.headers,...table.rows]),options,rows:[next]});
 const restored=S.decode(data,DS,G);assert.equal(restored.rows[0].proposed,next.proposed);assert.equal(restored.rows[0].source[1],title);
 data.edits[0].spacingTitle=spaced+'다른글자';assert.throws(()=>S.decode(data,DS,G));
});
