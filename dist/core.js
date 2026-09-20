(function(root){
'use strict';
const HEADERS='상품코드\t상태\t작업\t오류 메시지\t마켓 상품코드\t소비자준수가\t노트\t관리코드\t상품명\t가격\t오너클랜 판매가격\t대표 이미지\t브랜드\t키워드\t제조사\t원산지\t면세\t카테고리\t성인전용 상품\t배송비\t반품배송비\t배송타입\t구매대행여부\t판매시작일\t판매종료일\t기준출고일\t판매자 부담 할인\t옵션\t상세정보'.split('\t');
function parseTSV(text){
 if(typeof text!=='string'||text.length>30_000_000)throw Error('표는 30MB 이하로 나누어 넣어주세요.');
 text=text.replace(/^\uFEFF/,'');let rows=[],row=[],cell='',quoted=false,closed=false;
 function endCell(){row.push(cell);cell='';closed=false;}
 function endRow(){endCell();rows.push(row);row=[];if(rows.length>20001)throw Error('한 번에 최대 20,000개 상품을 처리할 수 있습니다.');}
 for(let i=0;i<text.length;i++){let c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
 if(closed && c!=='\t'&&c!=='\n'&&c!=='\r')throw Error('닫는 따옴표 뒤에 예상하지 못한 값이 있습니다. Excel에서 다시 복사해주세요.');
 if(c==='"'&&cell===''&&!closed){quoted=true;}else if(c==='\t')endCell();else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;endRow();}else cell+=c;}
 if(quoted)throw Error('따옴표가 닫히지 않았습니다. 표 범위를 다시 복사해주세요.');
 if(cell!==''||row.length||closed)endRow();return rows;
}
function stringify(rows){return rows.map(row=>row.map(v=>{const s=String(v??'');return /[\t\r\n"]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}).join('\t')).join('\r\n');}
function tableFrom(text){const rows=parseTSV(text);if(rows.length<2)throw Error('열 제목과 상품 데이터가 함께 필요합니다.');const headers=rows.shift();const names=headers.map(v=>v.trim());const required=['상품코드','상품명','키워드','배송비','반품배송비'];for(const n of required)if(names.filter(x=>x===n).length!==1)throw Error(n+' 열이 없거나 중복되었습니다.');if(new Set(names).size!==names.length)throw Error('같은 이름의 열이 중복되어 있습니다.');for(let i=0;i<rows.length;i++){if(rows[i].length===1&&rows[i][0]===''){rows[i]=Array(headers.length).fill('');continue;}if(rows[i].length!==headers.length)throw Error((i+2)+'행의 열 수가 제목과 다릅니다. 전체 범위를 다시 복사해주세요.');}return{headers,names,rows};}
function normalize(s){return String(s).normalize('NFKC').toLocaleLowerCase('ko-KR');}
function termsFrom(text){return [...new Set(text.split(/[\r\n\t,]+/).map(x=>x.trim()).filter(Boolean))].sort((a,b)=>b.length-a.length);}
function makeMatcher(terms){
 const nodes=[{next:new Map(),fail:0,out:[]}];const unique=[...new Set(terms.map(t=>normalize(t.trim())).filter(Boolean))];
 for(const term of unique){let p=0;for(const ch of term){if(!nodes[p].next.has(ch)){nodes[p].next.set(ch,nodes.length);nodes.push({next:new Map(),fail:0,out:[]});}p=nodes[p].next.get(ch);}nodes[p].out.push(term);}
 const q=[];for(const n of nodes[0].next.values())q.push(n);for(let qi=0;qi<q.length;qi++){const p=q[qi];for(const [ch,n]of nodes[p].next){q.push(n);let f=nodes[p].fail;while(f&&!nodes[f].next.has(ch))f=nodes[f].fail;nodes[n].fail=nodes[f].next.get(ch)||0;nodes[n].out=nodes[n].out.concat(nodes[nodes[n].fail].out);}}
 return function clean(original){let value=original,removed=new Set();for(let pass=0;pass<100;pass++){let chars=[],map=[];let offset=0;for(const ch of value){const norm=normalize(ch);for(const c of norm){chars.push(c);map.push([offset,offset+ch.length]);}offset+=ch.length;}let p=0,ranges=[];for(let i=0;i<chars.length;i++){const ch=chars[i];while(p&&!nodes[p].next.has(ch))p=nodes[p].fail;p=nodes[p].next.get(ch)||0;for(const term of nodes[p].out){const n=[...term].length;ranges.push([map[i-n+1][0],map[i][1]]);removed.add(term);}}if(!ranges.length)break;ranges.sort((a,b)=>a[0]-b[0]);let next='',at=0;for(const [a,b]of ranges){if(a>at)next+=value.slice(at,a);at=Math.max(at,b);}next+=value.slice(at);if(next===value)break;value=next;}
 return {value:removed.size?value.replace(/[ \u3000]+/g,' ').trim():original,removed:[...removed]};};
}
function fee(value,amount,includeZero){if(!Number.isSafeInteger(amount)||amount<0||amount>1000000)throw Error('인상액은 0~1,000,000원의 정수로 입력해주세요.');let s=value.trim();if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\s*원)?$/.test(s))return{value,issue:s?'숫자가 아닌 배송비: '+s:'빈 배송비'};const n=Number(s.replace(/[,\s원]/g,''));if(!Number.isSafeInteger(n)||!Number.isSafeInteger(n+amount))return{value,issue:'금액 범위 초과'};if((n===0&&!includeZero)||amount===0)return{value,issue:null};return{value:String(n+amount),issue:null};}
function placeKeywords(title,keywords,position='auto'){if(!title.trim()||!keywords.length)return title;const phrase=keywords.join(' ');if(position==='start')return phrase+' '+title;if(position==='afterFirst'){const m=title.match(/^\S+/);return m?title.slice(0,m[0].length)+' '+phrase+title.slice(m[0].length):title;}if(position==='auto'){const tail=title.match(/\s+((?:(?:\d[\d.,]*\s*(?:mm|cm|ml|kg|oz|m|l|g|개|매|입|세트|팩|호|인치)|소형|중형|대형|화이트|블랙)(?:\s+|$))+?)$/i);if(tail)return title.slice(0,tail.index)+' '+phrase+title.slice(tail.index);}return title+' '+phrase;}
function placeAIKeywords(title,checks){const words=[...title.matchAll(/\S+/gu)];const insertions=new Map();for(const c of checks){if(c.status!=='no_obvious_issue'||c.afterWord===null)continue;if(!Number.isInteger(c.afterWord)||c.afterWord<0||c.afterWord>words.length)throw Error('AI 삽입 위치를 확인해주세요.');const at=c.afterWord===0?0:words[c.afterWord-1].index+words[c.afterWord-1][0].length;if(!insertions.has(at))insertions.set(at,[]);insertions.get(at).push(c.keyword);}let result=title;for(const [at,keys]of [...insertions].sort((a,b)=>b[0]-a[0]))result=result.slice(0,at)+(at===0?keys.join(' ')+' ':' '+keys.join(' '))+result.slice(at);return result;}
function applyKeywordReview(row,checks,position){if(row.exclusion?.length)throw Error("삭제 필요 검토 대상입니다.");const excluded=checks.filter(c=>c.status!=='no_obvious_issue'||position==='ai'&&c.afterWord===null).map(c=>c.keyword);const remaining=row.candidates.filter(k=>!excluded.includes(k));const proposed=position==='ai'?placeAIKeywords(row.cleaned,checks):placeKeywords(row.cleaned,remaining,position);return{...row,aiError:undefined,keywordChecks:checks,excludedKeywords:excluded,proposed,approvedName:undefined,reviewedAt:undefined,evidence:'',status:proposed!==row.cleaned?'pending':'cleaned',empty:!row.cleaned.trim()};}
function exclusionReasons(table,source){
 const fields=['상품명','키워드','옵션','상세정보','노트'];const found=[];
 for(const field of fields){const index=table.names.indexOf(field);if(index<0)continue;
 const text=normalize(source[index]).replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ');
 const pattern=/(?<![\d.])(?:만\s*)?(?:\d{1,2}\s*(?:세|살)|\d{1,3}\s*개월)\s*(?:이상|이하|미만|초과|부터)(?:\s*(?:사용|이용|착용)\s*(?:금지|불가|가능|권장)?)?/gu;
 for(const match of text.matchAll(pattern))found.push(field+' · '+match[0].trim());

 }return [...new Set(found)];
}
function analyze(table,options){const count=options.keywordCount??1;if(!Number.isInteger(count)||count<1||count>3)throw Error('추가 키워드는 1~3개로 선택해주세요.');const ix=Object.fromEntries(table.names.map((n,i)=>[n,i]));const clean=makeMatcher(options.terms||[]);return table.rows.map((source,i)=>{
 const blank=source.every(v=>v==='');if(blank)return {index:i,source,output:source.slice(),blank:true,issues:[],removed:[],status:'blank'};
 const before=source[ix['상품명']],rawKeywords=source[ix['키워드']];const exclusion=exclusionReasons(table,source);if(exclusion.length)return{index:i,source,output:source.slice(),blank:false,code:source[ix['상품코드']],original:before,cleaned:before,proposed:before,keyword:'',candidates:[],candidateReason:'연령 제한 문구 — 삭제 필요 검토',keywordChecks:[],excludedKeywords:[],keywords:rawKeywords,removed:[],issues:[],status:'excluded',exclusion,empty:!before.trim(),evidence:''};
 const titleResult=clean(before);const cleanedKeywords=rawKeywords.split(/[,，;；\n|]+/).map(k=>clean(k));const terms=cleanedKeywords.map(k=>k.value.trim()).filter(Boolean);const keywordChanged=cleanedKeywords.some(k=>k.removed.length);const keywords=keywordChanged?[...new Set(terms)].join(', '):rawKeywords;
 const compact=s=>normalize(s).replace(/\s+/g,'');const candidates=[];for(const t of terms){if(t.length<2||t.length>100||compact(titleResult.value).includes(compact(t))||candidates.some(k=>compact(k).includes(compact(t))||compact(t).includes(compact(k))))continue;candidates.push(t);if(candidates.length===count)break;}
 const candidateReason=candidates.length?'':!rawKeywords.trim()?'키워드 없음':!terms.length?'금지어 제거 후 키워드 없음':terms.every(t=>compact(titleResult.value).includes(compact(t)))?'키워드가 이미 상품명에 포함됨':'추가 가능한 키워드 없음 (중복·길이 조건)';const keyword=candidates.join(', ');const proposed=options.position==='ai'?titleResult.value:clean(placeKeywords(titleResult.value,candidates,options.position)).value;
 const ship=fee(source[ix['배송비']],options.shipping,options.includeZero),ret=fee(source[ix['반품배송비']],options.returns,options.includeZero);const output=source.slice();output[ix['상품명']]=titleResult.value;output[ix['키워드']]=keywords;output[ix['배송비']]=ship.value;output[ix['반품배송비']]=ret.value;
 const issues=[ship.issue&&'배송비: '+ship.issue,ret.issue&&'반품배송비: '+ret.issue].filter(Boolean);
 const removed=[...new Set([...titleResult.removed,...cleanedKeywords.flatMap(k=>k.removed)])];
 return{index:i,source,output,blank:false,code:source[ix['상품코드']],original:before,cleaned:titleResult.value,proposed,keyword,candidates,candidateReason,keywordChecks:[],excludedKeywords:[],keywords,removed,issues,status:proposed!==titleResult.value||options.position==='ai'&&candidates.length?'pending':'cleaned',empty:!titleResult.value.trim(),evidence:''};
 });}
function approve(row,name,evidence,terms,matcher){if(row.exclusion?.length)throw Error("삭제 필요 검토 대상은 상품명 수정에서 제외됩니다.");const clean=matcher||makeMatcher(terms);if(!name.trim())throw Error('상품명은 비울 수 없습니다.');if(name.length>200)throw Error('상품명은 200자 이내로 입력해주세요.');if(clean(name).removed.length)throw Error('금지어가 남아 있습니다. 제거 후 승인해주세요.');if((row.excludedKeywords||[]).some(k=>normalize(name).includes(normalize(k))))throw Error('의심 또는 확인 필요로 분류된 추가 키워드는 이름에 넣을 수 없습니다.');if(/^[=+\-@]/.test(name.trim()))throw Error('수식으로 해석될 수 있는 시작 문자를 제거해주세요.');return{...row,approvedName:name.trim(),status:'approved',evidence,reviewedAt:new Date().toISOString(),empty:false};}
const COPY_HEADERS='상품명\t가격\t오너클랜 판매가격\t대표 이미지\t브랜드\t키워드\t제조사\t원산지\t면세\t카테고리\t성인전용 상품\t배송비\t반품배송비'.split('\t');
function exportBlock(table,rows){const start=table.names.indexOf(COPY_HEADERS[0]);if(start<0||COPY_HEADERS.some((name,i)=>table.names[start+i]!==name))throw Error('상품명부터 반품배송비까지 13개 열이 안내된 순서로 연속되어 있어야 합니다. 원본 표에 해당 열을 모두 포함해주세요.');return exportRows(table,rows).map(row=>row.slice(start,start+COPY_HEADERS.length));}
function exportRows(table,rows){const title=table.names.indexOf('상품명');return rows.map(row=>{const result=row.output.slice();if(row.status==='approved')result[title]=row.approvedName;return result;});}
const api={exclusionReasons,HEADERS,COPY_HEADERS,exportBlock,parseTSV,stringify,tableFrom,normalize,termsFrom,makeMatcher,fee,placeKeywords,placeAIKeywords,applyKeywordReview,analyze,approve,exportRows};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DS=api;
})(typeof window==='undefined'?globalThis:window);
