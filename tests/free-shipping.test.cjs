const test=require('node:test'),assert=require('node:assert/strict');
const DS=require('../dist/core.js'),G=require('../dist/gemini.js'),S=require('../dist/work-session.js');
const headers='상품코드\t상태\t작업\t오류 메시지\t마켓 상품코드\t소비자준수가\t노트\t관리코드\t상품명\t가격\t오너클랜 판매가격\t목록 이미지\t키워드\t제조사\t원산지\t면세\t카테고리\t성인전용 상품\t반품배송비\t구매대행여부\t판매자 부담 할인\t할인 적용가\t옵션\t상세정보'.split('\t');
const copyHeaders='상품명\t가격\t오너클랜 판매가격\t목록 이미지\t키워드\t제조사\t원산지\t면세\t카테고리\t성인전용 상품\t반품배송비'.split('\t');
const options={terms:['최고'],shipping:500,returns:500,includeZero:false,position:'ai',keywordCount:2};
function record(overrides={}){const values={'상품코드':'0000123','상품명':'최고 주방 수납함','키워드':'최고,정리용','반품배송비':'3,000원','가격':'001200','오너클랜 판매가격':'001000','목록 이미지':'https://example.com/list.jpg','노트':'메모\t보존','할인 적용가':'=A1*0.9','옵션':'색상 "흰색"','상세정보':'<div>첫줄\n둘째줄</div>',...overrides};return headers.map(h=>values[h]??('원본 '+h));}
function table(data){return DS.tableFrom(DS.stringify([headers,...data]));}

test('Gmarket/Auction 24-column free-shipping input preserves every non-target field and has no missing-shipping warning',()=>{
 const original=record(),t=table([original]),rows=DS.analyze(t,options),out=DS.exportRows(t,rows);
 assert.deepEqual(t.headers,headers);assert.equal(t.names.includes('배송비'),false);assert.equal(t.names.includes('브랜드'),false);
 assert.equal(out[0].length,24);assert.equal(out[0][8],'주방 수납함');assert.equal(out[0][12],'정리용');assert.equal(out[0][18],'3500');
 for(let i=0;i<headers.length;i++)if(![8,12,18,20,21].includes(i))assert.equal(out[0][i],original[i],headers[i]);
 assert.equal(out[0][20],'10원');assert.equal(out[0][21],'1190');assert.deepEqual(rows[0].issues,[]);assert.deepEqual(t.rows[0],original);assert.equal(Object.hasOwn(rows[0].output,'undefined'),false);
 assert.deepEqual(DS.exportRows(t,DS.analyze(t,options)),out);
});

test('free-shipping 14-column copy keeps blank rows, original image, zero return fee and approved names aligned',()=>{
 const t=table([record(),Array(24).fill(''),record({'상품코드':'0000456','반품배송비':'0'})]);let rows=DS.analyze(t,options);
 rows[0]=DS.applyKeywordReview(rows[0],[{keyword:'정리용',status:'no_obvious_issue',reason:'용도',afterWord:1}],'ai');
 rows[0]=DS.approve(rows[0],rows[0].proposed,'',options.terms);
 assert.deepEqual(DS.copyHeaders(t),headers.slice(8,22));assert.deepEqual(DS.FREE_COPY_HEADERS,copyHeaders);
 const block=DS.exportBlock(t,rows);assert.equal(block.length,3);assert(block.every(row=>row.length===14));
 assert.equal(block[0][0],'주방 정리용 수납함');assert.equal(block[0][1],'001200');assert.equal(block[0][3],'https://example.com/list.jpg');assert.equal(block[0][10],'3500');
 assert.deepEqual(block[1],Array(14).fill(''));assert.equal(block[2][10],'0');
 assert.equal(block[0][11],t.rows[0][19]);assert.deepEqual(block[0].slice(12),['10원','1190']);
 assert.deepEqual(DS.parseTSV(DS.stringify(block)),block);
});

test('unified copy includes intervening fields through the last discount column and falls back when absent',()=>{
 const names=[...headers.slice(0,21),'중간 메모',...headers.slice(21)],values=names.map(h=>h==='중간 메모'?'원본\t메모':record()[headers.indexOf(h)]),t=DS.tableFrom(DS.stringify([names,values]));
 const rows=DS.analyze(t,options),out=DS.exportBlock(t,rows);
 assert.equal(out[0].length,15);assert.equal(out[0][13],'원본\t메모');assert.equal(out[0][14],'1190');assert.equal(out[0][12],'10원');
 const narrow=headers.filter(h=>!['판매자 부담 할인','할인 적용가'].includes(h)),fallback=DS.tableFrom(DS.stringify([narrow,narrow.map(h=>record()[headers.indexOf(h)])]));
 assert.deepEqual(DS.copyHeaders(fallback),copyHeaders);assert.equal(DS.exportBlock(fallback,DS.analyze(fallback,options))[0].length,11);
 const paid=DS.tableFrom(DS.stringify([DS.HEADERS,DS.HEADERS.map(h=>({'상품명':'바구니','가격':'1500','판매자 부담 할인':'1%','배송비':'3000','반품배송비':'0','판매시작일':'2026-09-23','판매종료일':'2099-12-31','배송타입':'원본 타입'}[h]||''))]));
 const paidOut=DS.exportBlock(paid,DS.analyze(paid,options))[0];assert.equal(paidOut[18],'10원');for(const h of ['판매시작일','판매종료일','배송타입'])assert.equal(paidOut[DS.copyHeaders(paid).indexOf(h)],paid.rows[0][paid.names.indexOf(h)]);
});

test('free-shipping work checkpoint restores approved review and 24 original columns without adding return fee twice',()=>{
 const source=DS.stringify([headers,record(),Array(24).fill(''),record({'반품배송비':'0'})]),t=DS.tableFrom(source);let rows=DS.analyze(t,options);
 rows[0]=DS.applyKeywordReview(rows[0],[{keyword:'정리용',status:'no_obvious_issue',reason:'용도',afterWord:1}],'ai');
 rows[0]=DS.approve(rows[0],rows[0].proposed,'',options.terms);
 const expected=DS.exportRows(t,rows);let restored={source,options,rows};
 for(let i=0;i<3;i++)restored=S.decode(JSON.parse(JSON.stringify(S.encode(restored))),DS,G);
 assert.deepEqual(restored.table.headers,headers);assert.deepEqual(restored.table.rows,t.rows);assert.deepEqual(DS.exportRows(restored.table,restored.rows),expected);
 assert.equal(restored.rows[0].output[18],'3500');assert.equal(restored.rows[2].output[18],'0');assert.deepEqual(DS.exportBlock(restored.table,restored.rows),DS.exportBlock(t,rows));
});

test('free-shipping input still rejects missing required fields, duplicated headers and malformed rows',()=>{
 for(const name of ['상품코드','상품명','키워드','반품배송비']){const at=headers.indexOf(name);assert.throws(()=>DS.tableFrom(DS.stringify([headers.filter((_,i)=>i!==at),record().filter((_,i)=>i!==at)])),/없거나 중복/);}
 assert.throws(()=>DS.tableFrom(DS.stringify([[...headers,'목록 이미지'],[...record(),'duplicate']])),/중복/);
 assert.throws(()=>DS.tableFrom(DS.stringify([headers,record().slice(0,-1)])),/열 수/);
 const bad=record({'반품배송비':'무료'}),row=DS.analyze(table([bad]),options)[0];assert.equal(row.output[18],'무료');assert.equal(row.issues.length,1);assert.match(row.issues[0],/^반품배송비:/);
});

test('copy layout selects only the exact supported contiguous 13- or 11-column blocks',()=>{
 const paidRow=DS.HEADERS.map(h=>({'상품코드':'001','상품명':'수납함','키워드':'정리용','배송비':'3000','반품배송비':'0'}[h]||'')),paid=DS.tableFrom(DS.stringify([DS.HEADERS,paidRow]));
 assert.deepEqual(DS.copyHeaders(paid),DS.HEADERS.slice(8,27));const paidBlock=DS.exportBlock(paid,DS.analyze(paid,options));assert.equal(paidBlock[0].length,19);assert.equal(paidBlock[0][11],'3500');assert.equal(paidBlock[0][12],'0');
 for(const altered of [headers.map(h=>h==='목록 이미지'?'대표 이미지':h),[...headers.slice(0,12),'추가 열',...headers.slice(12)],headers.map((h,i)=>i===9?headers[10]:i===10?headers[9]:h)]){
  const t=DS.tableFrom(DS.stringify([altered,altered.map(h=>record()[headers.indexOf(h)]??'별도 값')]));
  assert.deepEqual(DS.copyHeaders(t),[]);assert.throws(()=>DS.exportBlock(t,DS.analyze(t,options)),/열|순서/);
 }
});
