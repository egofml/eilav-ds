const test=require('node:test'),assert=require('node:assert/strict');
const DS=require('../dist/core.js'),S=require('../dist/work-session.js'),G=require('../dist/gemini.js');
const headers=['상품코드','상품명','가격','오너클랜 판매가격','키워드','반품배송비','카테고리','판매자 부담 할인','할인 적용가','상세정보'];
const options={terms:['sd','금지'],shipping:500,returns:500,includeZero:false,position:'ai',keywordCount:2};
function record(overrides={},names=headers){const values={'상품코드':'W000001','상품명':'주방 수납함','가격':'1500','오너클랜 판매가격':'001100','키워드':'정리용','반품배송비':'0','카테고리':'00123>ESM','판매자 부담 할인':'1%','할인 적용가':'1485','상세정보':'<p>원본\t내용\n보존</p>',...overrides};return names.map(h=>values[h]??'');}
function fixture(records,names=headers){const source=DS.stringify([names,...records]),table=DS.tableFrom(source);return{source,table,rows:DS.analyze(table,options)};}
const cell=(table,row,name)=>row[table.names.indexOf(name)];

test('low-price seller discounts become zero and final prices equal selling prices at the inclusive 1500 boundary',()=>{
 const inputs=[['1499','1%','1484'],['1500','110원','1390'],['1,500원','1%','1485'],['001500','110','1390'],['0','1%','100'],['1501','1%','1486'],['5000','110원','4890']];
 const f=fixture(inputs.map(([price,discount,final])=>record({'가격':price,'판매자 부담 할인':discount,'할인 적용가':final}))),out=DS.exportRows(f.table,f.rows);
 for(let i=0;i<inputs.length;i++){
  const [price,discount,final]=inputs[i],eligible=i<5;
  assert.equal(cell(f.table,out[i],'판매자 부담 할인'),eligible?'0':discount,price);
  assert.equal(cell(f.table,out[i],'할인 적용가'),eligible?String(Number(price.replace(/[,원]/g,''))):final,price);
  for(let j=0;j<headers.length;j++)if(!['판매자 부담 할인','할인 적용가'].includes(headers[j]))assert.equal(out[i][j],f.table.rows[i][j],headers[j]);
 }
 assert.deepEqual(f.table.rows,inputs.map(([price,discount,final])=>record({'가격':price,'판매자 부담 할인':discount,'할인 적용가':final})));
});

test('zero or empty discount still synchronizes an eligible final price and supplier price never selects eligibility',()=>{
 const f=fixture([record({'판매자 부담 할인':'0','할인 적용가':'1000'}),record({'판매자 부담 할인':'','할인 적용가':'1499'}),record({'가격':'1600','오너클랜 판매가격':'1000','판매자 부담 할인':'110원','할인 적용가':'1490'}),record({'가격':'1000','오너클랜 판매가격':'2000'})]),out=DS.exportRows(f.table,f.rows);
 assert.deepEqual(out.map(r=>cell(f.table,r,'판매자 부담 할인')),['0','0','110원','0']);
 assert.deepEqual(out.map(r=>cell(f.table,r,'할인 적용가')),['1500','1500','1490','1000']);
});

test('invalid or absent selling prices cannot zero a discount',()=>{
 const prices=['',' ','=1500','-10','+1000','1499.5','1,50','15,00','1,,500','무료','NaN','9007199254740993'];
 const f=fixture(prices.map(price=>record({'가격':price}))),out=DS.exportRows(f.table,f.rows);
 for(let i=0;i<prices.length;i++)assert.deepEqual(out[i],f.table.rows[i],JSON.stringify(prices[i]));
 const names=headers.filter(h=>h!=='가격'),missing=fixture([record({},names)],names);
 assert.deepEqual(DS.exportRows(missing.table,missing.rows),missing.table.rows);
});

test('optional discount headers never create new columns and copy requires the supplied adjacent discount layout',()=>{
 for(const names of [headers.filter(h=>!['판매자 부담 할인','할인 적용가'].includes(h)),headers.filter(h=>h!=='판매자 부담 할인')]){
  const f=fixture([record({},names)],names);assert.deepEqual(DS.exportRows(f.table,f.rows),f.table.rows);assert.deepEqual(DS.discountHeaders(f.table),[]);assert.throws(()=>DS.exportDiscount(f.table,f.rows));
 }
 const one=headers.filter(h=>h!=='할인 적용가'),single=fixture([record({},one)],one);
 assert.deepEqual(DS.discountHeaders(single.table),['판매자 부담 할인']);assert.deepEqual(DS.exportDiscount(single.table,single.rows),[['0']]);
 assert.equal(DS.exportRows(single.table,single.rows)[0].length,one.length);
 const separated=[...headers.slice(0,8),'추가 열',...headers.slice(8)],f=fixture([record({'추가 열':'원본'},separated)],separated);
 assert.deepEqual(DS.discountHeaders(f.table),[]);assert.throws(()=>DS.exportDiscount(f.table,f.rows));
 assert.equal(cell(f.table,DS.exportRows(f.table,f.rows)[0],'추가 열'),'원본');
});

test('discount copy preserves original row alignment including blanks, exclusions and all held states',()=>{
 const inputs=[record(),Array(headers.length).fill(''),record({'상품명':'만 14세 이상 사용 수납함'}),record({'상품명':'SD-1038 차량 컵홀더'}),record({'상품코드':'HELD'}),record({'상품코드':'FAILED'}),record({'가격':'2000','판매자 부담 할인':'110원','할인 적용가':'1890'})];
 const f=fixture(inputs);f.rows[4].status='held';f.rows[5].applyError='검사 실패';
 assert(f.rows[2].exclusion.length);assert(f.rows[3].titleHold);
 const out=DS.exportRows(f.table,f.rows);for(let i=1;i<=5;i++)assert.deepEqual(out[i],inputs[i]);
 assert.deepEqual(DS.discountHeaders(f.table),['판매자 부담 할인','할인 적용가']);
 assert.deepEqual(DS.exportDiscount(f.table,f.rows),[['0','1500'],['',''],['1%','1485'],['1%','1485'],['1%','1485'],['1%','1485'],['110원','1890']]);
 for(const i of [3,4,5])f.rows[i]=DS.approve(f.rows[i],f.rows[i].original,'개별 확인',options.terms,undefined,true);
 for(const i of [3,4,5])assert.deepEqual(DS.exportDiscount(f.table,f.rows)[i],['0','1500']);
 assert.throws(()=>DS.approve(f.rows[2],f.rows[2].original,'',options.terms,undefined,true));
});

test('saved sessions recalculate low-price discounts without cumulative edits and preserve explicit holds',()=>{
 const f=fixture([record({'반품배송비':'3000'}),record({'상품명':'SD-1038 컵홀더'}),record({'상품코드':'HELD'})]);
 f.rows[1]=DS.approve(f.rows[1],f.rows[1].original,'모델 확인',options.terms,undefined,true);f.rows[2].status='held';
 const expected=DS.exportRows(f.table,f.rows);let state={...f,options};
 for(let i=0;i<3;i++)state=S.decode(JSON.parse(JSON.stringify(S.encode(state))),DS,G);
 assert.deepEqual(state.table.rows,f.table.rows);assert.deepEqual(DS.exportRows(state.table,state.rows),expected);
 assert.deepEqual(DS.exportDiscount(state.table,state.rows),[['0','1500'],['0','1500'],['1%','1485']]);
 assert.equal(cell(state.table,DS.exportRows(state.table,state.rows)[0],'반품배송비'),'3500');
});
