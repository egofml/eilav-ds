const test=require('node:test'),assert=require('node:assert/strict'),G=require('../dist/gemini.js');
test('invalid positions and mutated, missing, duplicate candidates are excluded without inventing placements',()=>{
 const items=[{id:438,title:'플래시 페인트 마커펜 8색 보드마카',candidates:['페인트마카','유리마커','보드마커']},{id:1503,title:'왕골자동차방석V2자동차방석카방석방석왕골방석',candidates:['차량용방석']}];
 const k=(keyword,afterWord,status='no_obvious_issue')=>({keyword,afterWord,status,reason:'용도'});
 const normalized=G.excludeInvalidCandidates([{id:438,keywords:[k('페인트마커',1),k('유리마커',2),k('보드마커',1),k('보드마커',2)]},{id:1503,keywords:[k('차량용방석',5)]}],items);
 const result=G.validateResult(normalized,items);
 assert.equal(result[0].keywords[0].status,'uncertain');assert.equal(result[0].keywords[1].afterWord,2);assert.equal(result[0].keywords[2].afterWord,null);assert.equal(result[1].keywords[0].afterWord,null);
 assert(result.flatMap(r=>r.keywords).every(k=>k.keyword!=='페인트마커'));
 assert.throws(()=>G.excludeInvalidCandidates([{id:999,keywords:[]},{id:999,keywords:[]}],items));
});
test('suspect candidate never inserts even when model assigns a position; valid endpoints stay intact',()=>{
 const items=[{id:1,title:'공백없는상품명',candidates:['브랜드','정리용']}];
 const result=G.validateResult(G.excludeInvalidCandidates([{id:1,keywords:[{keyword:'브랜드',status:'suspect',reason:'의심',afterWord:1},{keyword:'정리용',status:'no_obvious_issue',reason:'용도',afterWord:1}]}],items),items);
 assert.equal(result[0].keywords[0].status,'suspect');assert.equal(result[0].keywords[0].afterWord,null);assert.equal(result[0].keywords[1].afterWord,1);
});
