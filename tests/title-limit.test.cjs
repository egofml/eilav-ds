const test=require('node:test'),assert=require('node:assert/strict');
const DS=require('../dist/core.js');
const rule={enabled:true};
function row(title){return{original:title,cleaned:title,proposed:title,status:'cleaned',keywordChecks:[],candidates:[],exclusion:[]};}
function reviewed(title,checks){const base=row(title);base.candidates=checks.map(c=>c.keyword);const reviewed=DS.applyKeywordReview(base,checks,'ai');return DS.approve(reviewed,reviewed.proposed,'AI 검토',[]);}
const check=(keyword,afterWord=1)=>({keyword,status:'no_obvious_issue',afterWord});

test('ESM byte count distinguishes ASCII, Korean, whitespace and conservative surrogate pairs',()=>{
 assert.equal(DS.esmBytes('ABC-1038'),8);
 assert.equal(DS.esmBytes('한글 A'),6);
 assert.equal(DS.esmBytes('😀'),4);
 assert.equal(DS.esmBytes(''),0);
 for(const title of ['A'.repeat(100),'가'.repeat(50)]){
  const result=DS.titleLimit(row(title),rule);assert.equal(result.bytes,100);assert.equal(result.over,false);assert.equal(result.title,title);
 }
 assert.equal(DS.titleLimit(row('가'.repeat(50)+'A'),rule).over,true);
});

test('disabled rule leaves approved titles intact even when over 100 bytes',()=>{
 const r=reviewed('가'.repeat(49),[check('수납용')]);
 const limited=DS.titleLimit(r,{enabled:false});
 assert.equal(limited.title,r.approvedName);assert.equal(limited.over,false);assert.equal(limited.adjusted,false);
 assert.equal(DS.effectiveTitle(r),r.approvedName);
 r.titleRule={enabled:false};assert.equal(DS.effectiveTitle(r),r.approvedName);
});

test('automatic shortening removes whole inserted keywords and retains original model tokens',()=>{
 const title='SD-1038 '+'가'.repeat(36); // 80 bytes before AI additions
 const checks=[check('나'.repeat(10)),check('수납',2)];
 const r=reviewed(title,checks),limited=DS.titleLimit(r,rule);
 assert.equal(limited.title,DS.placeAIKeywords(title,[checks[1]]));
 assert.equal(limited.bytes,85);assert.equal(limited.over,false);assert.equal(limited.adjusted,true);
 assert.match(limited.title,/^SD-1038 /);
 assert.equal(r.approvedName,r.proposed,'limiting must not mutate approved source');
 r.titleRule=rule;assert.equal(DS.effectiveTitle(r),limited.title);
 r.titleRule={enabled:false};assert.equal(DS.effectiveTitle(r),r.approvedName,'turning the option off restores the full approved title');
});

test('automatic shortening retains the greatest possible number of reviewed additions',()=>{
 const title='가'.repeat(40),checks=[check('나'.repeat(10)),check('수납'),check('정리')];
 const r=reviewed(title,checks),limited=DS.titleLimit(r,rule);
 assert.equal(limited.title,DS.placeAIKeywords(title,checks.slice(1)));
 assert.equal(limited.bytes,90);assert.equal(limited.over,false);
});

test('manual titles, mismatched proposals and unreviewed long originals are reported rather than truncated',()=>{
 const long='SD-1038 '+'가'.repeat(50);
 const raw=row(long),auto=reviewed('가'.repeat(49),[check('수납')]);
 for(const r of [raw,{...auto,manualReview:true},{...auto,approvedName:auto.approvedName+' 직접수정'},{...auto,keywordChecks:[]}]){
  const expected=r.status==='approved'?r.approvedName:r.cleaned,limited=DS.titleLimit(r,rule);
  assert.equal(limited.title,expected);assert.equal(limited.over,true);assert.equal(limited.adjusted,false);
 }
});

test('spacing repairs are retained when a whole inserted keyword is removed',()=>{
 const original='SD-1038'+'가'.repeat(44),base=row(original),checks=[check('수납용',1)];
 base.candidates=checks.map(c=>c.keyword);
 const spaced='SD-1038 '+'가'.repeat(44),r=DS.applyKeywordReview(base,checks,'ai',spaced);
 const approved=DS.approve(r,r.proposed,'AI 검토',[]),limited=DS.titleLimit(approved,rule);
 assert.equal(limited.title,spaced);assert.equal(limited.bytes,96);assert.equal(limited.over,false);assert.equal(limited.adjusted,true);
});

test('export uses constrained titles while retaining header order and preserving held or excluded rows',()=>{
 const names=['상품코드','카테고리','상품명','가격','키워드','반품배송비'],title='SD-1038 '+'가'.repeat(36);
 const source=['W123','001>ESM',title,'2000','수납','3000'];
 const approved={...reviewed(title,[check('나'.repeat(10)),check('수납',2)]),source:source.slice(),output:source.slice(),titleRule:rule};
 const held={...approved,status:'held',cleaned:'수정하면 안됨',titleHold:'모델명',output:source.map(()=> '변경')};
 const excluded={...approved,status:'excluded',exclusion:['연령 제한'],approvedName:undefined,output:source.slice()};
 const out=DS.exportRows({names},[approved,held,excluded]);
 assert.equal(out[0][2],DS.titleLimit(approved,rule).title);
 for(const index of [0,1,3,4,5])assert.equal(out[0][index],source[index]);
 assert.deepEqual(out[1],source);assert.deepEqual(out[2],source);
 assert.deepEqual(approved.source,source);assert.deepEqual(approved.output,source);
 assert.equal(DS.effectiveTitle(held),title);
});

test('session roundtrips preserve rule on and off, approved additions and immutable source cells',()=>{
 const Session=require('../dist/work-session.js'),Gemini=require('../dist/gemini.js');
 const names=['상품코드','상품명','가격','키워드','반품배송비','카테고리'];
 const title='SD-1038 '+'가'.repeat(36),keywords=['나'.repeat(10),'수납'];
 const cells=['W123',title,'2000',keywords.join(','),'3000','001>ESM'];
 const source=DS.stringify([names,cells]),table=DS.tableFrom(source);
 let options={terms:[],shipping:500,returns:500,includeZero:false,position:'ai',keywordCount:2,titleRule:{enabled:true}};
 const initial=DS.analyze(table,options)[0];assert.deepEqual(initial.candidates,keywords);
 const checks=initial.candidates.map((keyword,i)=>({...check(keyword,i+1),reason:'문맥 적합'}));
 const candidate=DS.applyKeywordReview(initial,checks,'ai'),approved=DS.approve(candidate,candidate.proposed,'AI 검토',[]);
 const completeName=approved.approvedName,shortName=DS.placeAIKeywords(title,[checks[1]]);
 let state={source,table,options,rows:[approved]};
 for(const enabled of [true,false,true,false]){
  state.options={...state.options,titleRule:{enabled}};
  state.rows=state.rows.map(r=>({...r,titleRule:{enabled}}));
  state=Session.decode(JSON.parse(JSON.stringify(Session.encode(state))),DS,Gemini);
  assert.equal(state.options.titleRule.enabled,enabled);
  assert.equal(state.rows[0].titleRule.enabled,enabled);
  assert.equal(state.rows[0].approvedName,completeName);
  assert.equal(state.rows[0].status,'approved');assert.equal(state.rows[0].manualReview,false);
  assert.equal(DS.effectiveTitle(state.rows[0]),enabled?shortName:completeName);
  assert.equal(DS.exportRows(state.table,state.rows)[0][1],enabled?shortName:completeName);
  assert.deepEqual(state.table.rows,[cells]);assert.deepEqual(state.rows[0].source,cells);assert.equal(state.source,source);
  assert.equal(DS.exportRows(state.table,state.rows)[0][4],'3500','restoration cannot compound fee edits');
 }
 state.options.titleRule={enabled:true};
 state.rows[0]=DS.approve({...state.rows[0],titleRule:{enabled:true}},completeName,'직접 확인',[],undefined,true);
 state=Session.decode(JSON.parse(JSON.stringify(Session.encode(state))),DS,Gemini);
 assert.equal(state.rows[0].manualReview,true);
 assert.equal(DS.effectiveTitle(state.rows[0]),completeName,'restored manual approval must never shorten automatically');
 assert.equal(DS.titleLimit(state.rows[0]).over,true);
 assert.deepEqual(state.rows[0].source,cells);
});
