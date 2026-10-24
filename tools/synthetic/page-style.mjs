export const LAYOUT_REVISION='audition195-layout-v2';
export const HEADER_LAYOUTS=['stack','left','right','split','reverse-split','band','compact'];
export const FOOTER_LAYOUTS=['none','folio','rule','columns','banner','split','vertical','sticker','ticket'];
export const WATERMARK_LAYOUTS=['none','diagonal','tiled','seal','graphic','mixed'];
const esc=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function seededRandom(seed,axis=''){
 let s=2166136261;for(const c of String(seed)+':'+axis)s=Math.imul(s^c.charCodeAt(0),16777619)>>>0;
 return()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};
}
const pick=(r,a)=>a[Math.floor(r()*a.length)],int=(r,l,h)=>Math.floor(l+r()*(h-l+1));
const shuffle=(r,a)=>{a=[...a];for(let i=a.length-1;i>0;i--){const k=int(r,0,i);[a[i],a[k]]=[a[k],a[i]];}return a;};
const hsl=(r,s,l)=>`hsl(${int(r,0,359)} ${s}% ${l}%)`;
// The seed and physical page select appearance. No music, labels or split are consulted.
export function pageStyle(seed,pageIndex,width=1500,height=2120){
 const key=`${LAYOUT_REVISION}:${seed}:${pageIndex}`,m=seededRandom(key,'margins'),a=seededRandom(key,'header'),f=seededRandom(key,'footer'),w=seededRandom(key,'watermark'),d=seededRandom(key,'dirt'),c=seededRandom(key,'colors');
 const layout=pick(f,FOOTER_LAYOUTS),fh=['banner','columns','split','ticket'].includes(layout)?int(f,100,172):['rule','sticker','vertical'].includes(layout)?int(f,60,104):int(f,30,62),kind=pick(w,WATERMARK_LAYOUTS);
 const p={revision:LAYOUT_REVISION,seed,pageIndex,width,height,
 margins:{left:int(m,32,145),right:int(m,32,145),top:int(m,28,112),bottom:int(m,28,90)},rowGap:int(m,10,42),
 header:{layout:pick(a,HEADER_LAYOUTS),align:pick(a,['left','center','right']),order:shuffle(a,['title','performer','metadata']),metadataOrder:shuffle(a,['original','written','capo','meter','tempo']),titleSize:int(a,32,53),artistSize:int(a,17,26),metadataSize:int(a,17,23),gap:int(a,8,20),padding:int(a,8,24),letterSpacing:int(a,0,4),font:pick(a,['Microsoft YaHei,sans-serif','SimSun,serif','KaiTi,serif','Arial,sans-serif','SimHei,sans-serif'])},
 footer:{layout,height:fh,align:pick(f,['left','center','right']),inset:int(f,16,90),gap:int(f,10,36),reverse:f()<.5,fontSize:int(f,15,24),angle:int(f,-3,3),title:pick(f,['六弦日记','琴房手册','音乐笔记','今日练习','Acoustic Studio','Guitar Notes','和声小屋','弹唱时光']),texts:shuffle(f,['慢练 · 保持节拍','演奏提示','和弦与旋律','每日练习','Keep the rhythm','Practice notes','弹唱记录','音乐让生活更美好']).slice(0,int(f,1,4)),number:f()<.85,numberAlign:pick(f,['left','center','right']),numberStyle:int(f,0,3)},
 colors:{paper:c()<.55?'#ffffff':hsl(c,int(c,8,28),int(c,96,99)),ink:pick(c,['#111111','#171717','#242020','#15212a','#202522']),accent:hsl(c,int(c,10,65),int(c,27,62)),secondary:hsl(c,int(c,8,45),int(c,35,68)),watermark:w()<.55?hsl(c,int(c,0,12),int(c,25,50)):hsl(c,int(c,35,72),int(c,32,58))},
 frame:{enabled:c()<.23,inset:int(c,6,22),width:int(c,1,6),dashed:c()<.3},
 watermark:{kind,opacity:.025+w()*.055,angle:int(w,-55,45),size:int(w,28,104),text:pick(w,['音乐分享','GUITAR','练习手记','琴房','Acoustic','六弦','Music Notes','收藏版']),count:kind==='tiled'?int(w,5,14):int(w,1,4)},
 dirt:{enabled:d()<.64,seed:key,count:int(d,2,12),opacity:.025+d()*.055}};
 p.contentWidth=width-p.margins.left-p.margins.right;p.footerTop=height-p.margins.bottom-fh;return p;
}
export function headerHTML(s,p){
 const h=p.header,meta={original:`<span data-meta="key_signature" data-key-kind="original">原调 ${esc(s.key)}</span>`,written:`<span data-meta="key_signature" data-key-kind="written">1=${esc(s.fingeringKey)}</span>`,capo:s.defaultCapo>=0?`<span data-meta="capo">Capo = ${s.defaultCapo}</span>`:'',meter:`<span data-meta="time_signature">${s.meter.join('/')}</span>`,tempo:`<span data-meta="tempo">♩ = ${s.bpm}</span>`};
 const items={title:`<h1 data-meta="title" style="font-size:${h.titleSize}px;letter-spacing:${h.letterSpacing}px">${esc(s.title)}</h1>`,performer:`<p data-meta="performer" style="font-size:${h.artistSize}px">${esc(s.artist)}</p>`,metadata:`<div class="page-meta" style="font-size:${h.metadataSize}px;gap:${h.gap}px">${h.metadataOrder.map(k=>meta[k]).join('')}</div>`};
 return `<header class="page-header header-${h.layout}" style="text-align:${h.align};gap:${h.gap}px;padding:${h.padding}px 0 ${h.padding+12}px;font-family:${h.font}">${h.order.map(k=>items[k]).join('')}</header>`;
}
export function footerHTML(p){
 const f=p.footer,c=p.colors;if(f.layout==='none')return '';
 const text=`<div class="footer-copy">${f.texts.map(v=>`<span>${esc(v)}</span>`).join('')}</div>`,number=f.number?`<span class="folio" data-page-number data-format="${f.numberStyle}" style="text-align:${f.numberAlign}"></span>`:'';
 return `<footer class="random-footer footer-${f.layout}" data-ignore-annotation="true" style="left:${f.inset}px;right:${f.inset}px;top:${p.footerTop}px;height:${f.height}px;gap:${f.gap}px;font-size:${f.fontSize}px;color:${c.accent};--secondary:${c.secondary};text-align:${f.align};--footer-angle:${f.angle}deg;flex-direction:${f.reverse?'row-reverse':'row'}"><strong>${esc(f.title)}</strong>${text}${number}</footer>`;
}
export function decorationHTML(p){
 const r=seededRandom(p.dirt.seed,'shapes'),m=p.watermark,{width:w,height:h,colors:c}=p,parts=[],kinds=[];
 const text=(x,y,size,angle,opacity)=>`<text x="${x}" y="${y}" font-family="Arial,Microsoft YaHei,sans-serif" font-size="${size}" fill="${c.watermark}" opacity="${opacity}" transform="rotate(${angle} ${x} ${y})">${esc(m.text)}</text>`;
 if(m.kind==='tiled')for(let i=0;i<m.count;i++)parts.push(text(int(r,5,w-220),int(r,80,h-60),m.size*(.6+r()*.5),m.angle+int(r,-12,12),m.opacity));
 if(m.kind==='diagonal'||m.kind==='mixed')for(let i=0;i<m.count;i++)parts.push(text(int(r,40,w-430),int(r,120,h-80),m.size+24,m.angle,m.opacity));
 if(m.kind==='seal'||m.kind==='mixed'){const x=w*(.12+r()*.72),y=h*(.12+r()*.75),rad=int(r,65,180);parts.push(`<g opacity="${m.opacity}" fill="none" stroke="${c.watermark}" stroke-width="${int(r,2,8)}" transform="rotate(${m.angle} ${x} ${y})"><circle cx="${x}" cy="${y}" r="${rad}"/><circle cx="${x}" cy="${y}" r="${rad-10}"/><path d="M${x-rad*.8} ${y}h${rad*1.6}"/>${text(x-rad*.8,y-12,rad*.35,0,1)}</g>`);}
 if(m.kind==='graphic'){const x=int(r,100,w-200),y=int(r,180,h-400),z=int(r,100,300);parts.push(`<g opacity="${m.opacity}" fill="none" stroke="${c.watermark}" stroke-width="${int(r,3,10)}" transform="rotate(${m.angle} ${x} ${y})"><ellipse cx="${x}" cy="${y+z}" rx="${z*.62}" ry="${z}"/><circle cx="${x}" cy="${y+z}" r="${z*.22}"/><path d="M${x-12} ${y+z*.8}v-${z*1.8}h24v${z*1.8}M${x-25} ${y-z}h50v-${z*.4}h-50Z"/></g>`);}
 if(p.dirt.enabled)for(let i=0;i<p.dirt.count;i++){
  const kind=pick(r,['stain','dust','scratch','stamp-fragment','ghost-text','crease']),x=int(r,0,w),y=int(r,0,h),alpha=p.dirt.opacity*(.35+r()*.65),color=hsl(r,int(r,0,40),int(r,18,54));kinds.push(kind);
  if(kind==='stain')parts.push(`<ellipse cx="${x}" cy="${y}" rx="${int(r,12,95)}" ry="${int(r,8,58)}" fill="${color}" opacity="${alpha}" transform="rotate(${int(r,0,359)} ${x} ${y})"/>`);
  else if(kind==='dust'){const dots=Array.from({length:int(r,7,28)},()=>`<circle cx="${x+int(r,-95,95)}" cy="${y+int(r,-70,70)}" r="${.5+r()*2}"/>`).join('');parts.push(`<g fill="${color}" opacity="${alpha*1.6}">${dots}</g>`);}
  else if(kind==='scratch'||kind==='crease'){const dx=int(r,-160,160),dy=int(r,40,kind==='crease'?680:220);parts.push(`<path d="M${x} ${y}q${dx} ${dy*.4} ${dx*.5} ${dy}" fill="none" stroke="${color}" stroke-width="${kind==='crease'?2+r()*4:.5+r()*1.5}" opacity="${alpha}"/>`);}
  else if(kind==='stamp-fragment')parts.push(`<path d="M${x-50} ${y}a70 70 0 1 1 100 30m-90-18h78m-65 18h50" fill="none" stroke="${color}" stroke-width="${int(r,2,5)}" opacity="${alpha}" transform="rotate(${int(r,-50,50)} ${x} ${y})"/>`);
  else parts.push(text(x,y,int(r,15,36),int(r,-35,35),alpha));
 }
 if(p.frame.enabled)parts.push(`<rect x="${p.frame.inset}" y="${p.frame.inset}" width="${w-p.frame.inset*2}" height="${h-p.frame.inset*2}" fill="none" stroke="${c.accent}" stroke-width="${p.frame.width}" ${p.frame.dashed?'stroke-dasharray="12 9"':''}/>`);
 return{html:`<svg class="page-decoration" data-ignore-annotation="true" aria-hidden="true" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`,dirtKinds:kinds};
}
export const PAGE_CSS=`
*{box-sizing:border-box}body{margin:0;background:#e7e7e7;font-family:Arial,"Microsoft YaHei",sans-serif}
#staging{position:absolute;left:-20000px;top:0}.song-sheet>header,.preview-score-overviews,.song-sheet>footer,.sheet-follow-spacer{display:none}
.sheet-page{position:relative;isolation:isolate;overflow:hidden;margin-bottom:24px}.sheet-system{display:block;width:100%;height:auto;overflow:visible;color:var(--ink)}.sheet-system text{fill:var(--ink)}
.sheet-system [data-system-bracket]{display:var(--bracket-display,none)}.sheet-system svg[data-sheet-bar]>line,.sheet-system [data-clef-staff-line]{stroke-width:var(--staff-line-width,1)}.sheet-system [data-sheet-rhythm-beam]{stroke-width:var(--beam-width,2)}
.page-header,.systems{position:relative;z-index:1}.page-header{display:flex;flex-direction:column;align-items:stretch;line-height:1.35}.page-header h1,.page-header p{margin:0;overflow-wrap:anywhere;min-width:0}.page-meta{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;line-height:1.5}.page-meta>span{white-space:nowrap}
.header-left{align-items:flex-start;text-align:left!important}.header-right{align-items:flex-end;text-align:right!important}.header-left .page-meta,.header-right .page-meta{gap:22px!important;justify-content:flex-start}
.header-split,.header-reverse-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:center}.header-split h1,.header-split p{grid-column:1}.header-split .page-meta{grid-column:2;grid-row:1/3;justify-content:flex-end}.header-reverse-split h1,.header-reverse-split p{grid-column:2}.header-reverse-split .page-meta{grid-column:1;grid-row:1/3;justify-content:flex-start}
.header-band{border-top:2px solid var(--accent);border-bottom:1px solid var(--accent);margin-bottom:18px}.header-compact{flex-flow:row wrap;align-items:center;justify-content:space-between}.header-compact h1{max-width:70%}.header-compact .page-meta{flex-basis:100%}.systems{display:flex;flex-direction:column}
.random-footer{position:absolute;z-index:3;display:flex;align-items:center;justify-content:space-between;line-height:1.4}.random-footer strong{max-height:100%;overflow:hidden;font-size:1.35em;overflow-wrap:anywhere;max-width:36%}.footer-copy{max-height:100%;overflow:hidden;display:flex;flex-flow:row wrap;gap:8px 20px;max-width:58%}.folio{position:absolute;bottom:0;left:0;width:100%;font:16px Arial;color:var(--ink)}
.footer-folio strong,.footer-folio .footer-copy{display:none}.footer-rule{border-top:1px solid currentColor}.footer-columns .footer-copy{display:grid;grid-template-columns:1fr 1fr}.footer-banner{background:linear-gradient(115deg,var(--accent),var(--secondary));color:white!important;padding:16px 24px;border-radius:2px}.footer-banner .folio{bottom:-22px}.footer-split strong{border:2px solid currentColor;padding:12px}.footer-split .footer-copy{justify-content:flex-end}.footer-vertical strong{writing-mode:vertical-rl;font-size:1em}.footer-vertical .footer-copy{margin-left:auto;max-width:74%}.footer-sticker{width:62%;margin-left:auto;transform:rotate(var(--footer-angle));border:1px dashed currentColor;padding:10px 20px}.footer-ticket{border-top:2px dashed currentColor;border-bottom:1px dashed currentColor;padding:14px}
.page-decoration{position:absolute;inset:0;width:100%;height:100%;z-index:2;pointer-events:none}.overlay{position:absolute;z-index:4;border:2px solid;pointer-events:none}
`;
export function renderDocument(fragment,p){return `<!doctype html><meta charset="utf-8"><style>${PAGE_CSS}\n.sheet-system{font-family:${p.font}}</style><div id="staging" style="width:${p.pageWidth-p.marginX*2}px">${fragment}</div>`;}
export function stylesForScore(profile,source,maxPages){return Array.from({length:maxPages},(_,i)=>{const p=pageStyle(profile.seed,i,profile.pageWidth,profile.pageHeight),d=decorationHTML(p);return{...p,headerHTML:headerHTML(source,p),footerHTML:footerHTML(p),decorationHTML:d.html,dirtKinds:d.dirtKinds};});}
// This function is serialized into a browser: keep it self-contained.
export function paginateScore({profile,styles}){
 const rows=[...document.querySelectorAll('#staging .sheet-system')];let current,index=-1;
 const create=()=>{const p=styles[++index];if(!p)throw Error('Page style budget exhausted');current=document.createElement('article');current.className='sheet-page';current.dataset.pageIndex=index;current.dataset.layoutRevision=p.revision;const m=p.margins,c=p.colors;Object.assign(current.style,{width:p.width+'px',height:p.height+'px',padding:`${m.top}px ${m.right}px ${m.bottom}px ${m.left}px`,background:c.paper,color:c.ink});current.style.setProperty('--ink',c.ink);current.style.setProperty('--accent',c.accent);current.style.setProperty('--staff-line-width',String(profile.staffLineWidth));current.style.setProperty('--beam-width',String(profile.beamWidth));current.style.setProperty('--bracket-display',profile.bracket?'inline':'none');current.innerHTML=(index===0?p.headerHTML:'')+`<div class="systems" style="gap:${p.rowGap}px"></div>`+p.footerHTML+p.decorationHTML;document.body.append(current);};
 for(const row of rows){if(!current)create();const clone=row.cloneNode(true);current.querySelector('.systems').append(clone);const fits=()=>{const origin=current.getBoundingClientRect(),rects=[clone.getBoundingClientRect(),...[...clone.querySelectorAll('text,path,line,circle,ellipse,rect,polygon,polyline')].filter(el=>!el.closest('[data-cursor-bar]')).map(el=>el.getBoundingClientRect())];return Math.max(...rects.map(r=>r.bottom))<=origin.top+styles[index].footerTop-(styles[index].footer.layout==='sticker'?48:14);};if(!fits()){clone.remove();if(!current.querySelector('.sheet-system'))throw Error('A system cannot fit on an empty page');create();current.querySelector('.systems').append(clone);if(!fits())throw Error('A system cannot fit on an empty page');}}
 document.querySelector('#staging').remove();const pages=[...document.querySelectorAll('.sheet-page')];
 for(const [i,node]of pages.entries()){const number=node.querySelector('[data-page-number]');if(number)number.textContent=[`${i+1} / ${pages.length}`,`— ${i+1} —`,`第 ${i+1} 页`,`${i+1}`][Number(number.dataset.format)];const origin=node.getBoundingClientRect(),meta=[...node.querySelectorAll('[data-meta]')].map(el=>el.getBoundingClientRect());for(let a=0;a<meta.length;a++)for(let b=a+1;b<meta.length;b++){const x=meta[a],y=meta[b];if(Math.min(x.right,y.right)-Math.max(x.left,y.left)>1&&Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>1)throw Error('Header metadata overlaps');}for(const el of node.querySelectorAll('.sheet-system text,[data-meta]')){const r=el.getBoundingClientRect();if(r.left<origin.left||r.right>origin.right||r.top<origin.top||r.bottom>origin.top+styles[i].footerTop)throw Error('Musical content outside usable page bounds');}}
 if(document.querySelectorAll('.page-header').length!==1)throw Error('Header must appear on the first page only');
 return{pageCount:pages.length,watermarks:[],pageStyles:styles.slice(0,pages.length).map(({headerHTML,footerHTML,decorationHTML,...p})=>p)};
}
export function mergeLyricRegions(boxes){
 const result=[],seen=new Map();for(const b of boxes){if(b.classKey!=='lyrics'||!b.parentSystemId){result.push({...b});continue;}const key=b.parentSystemId;if(!seen.has(key)){const v={...b,id:key+'-lyrics'};seen.set(key,v);result.push(v);}else{const v=seen.get(key),right=Math.max(v.x+v.width,b.x+b.width),bottom=Math.max(v.y+v.height,b.y+b.height);v.x=Math.min(v.x,b.x);v.y=Math.min(v.y,b.y);v.width=right-v.x;v.height=bottom-v.y;}}return result.map((b,readingOrder)=>({...b,readingOrder}));
}

