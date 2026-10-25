// Browser-side bounds. SVG text boxes include font leading; measure the actual glyph ink instead.
export function musicInkBounds(row){
 const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
 const union=rects=>{rects=rects.filter(Boolean);if(!rects.length)return null;const left=Math.min(...rects.map(r=>r.left)),top=Math.min(...rects.map(r=>r.top)),right=Math.max(...rects.map(r=>r.right)),bottom=Math.max(...rects.map(r=>r.bottom));return{left,top,right,bottom,width:right-left,height:bottom-top};};
 const rect=(m,left,top,right,bottom)=>{const points=[[left,top],[right,top],[left,bottom],[right,bottom]].map(([x,y])=>({x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f}));return{left:Math.min(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),right:Math.max(...points.map(p=>p.x)),bottom:Math.max(...points.map(p=>p.y))};};
 function ink(el){
  const css=getComputedStyle(el);if(css.display==='none'||css.visibility==='hidden'||css.opacity==='0')return null;
  const matrix=el.getScreenCTM();if(!matrix)return null;
  if(el.tagName.toLowerCase()==='text'){
   context.font=[css.fontStyle,css.fontWeight,css.fontSize,css.fontFamily].join(' ');context.textAlign='left';context.textBaseline='alphabetic';
   const text=el.textContent||'',count=el.getNumberOfChars(),rects=[];
   for(let i=0;i<count;i++){const char=text[i];if(!char||/\s/.test(char))continue;const point=el.getStartPositionOfChar(i),metrics=context.measureText(char);if(!Number.isFinite(metrics.actualBoundingBoxAscent))throw Error('Browser lacks glyph ink metrics');
    const left=point.x-metrics.actualBoundingBoxLeft,right=point.x+metrics.actualBoundingBoxRight,top=point.y-metrics.actualBoundingBoxAscent,bottom=point.y+metrics.actualBoundingBoxDescent;
    if(right>left&&bottom>top)rects.push(rect(matrix,left,top,right,bottom));
   }
   return union(rects);
  }
  const bounds=el.getBoundingClientRect(),half=css.stroke&&css.stroke!=='none'?parseFloat(css.strokeWidth||'0')/2:0,dx=half*Math.hypot(matrix.a,matrix.c),dy=half*Math.hypot(matrix.b,matrix.d);
  return{left:bounds.left-dx,top:bounds.top-dy,right:bounds.right+dx,bottom:bounds.bottom+dy};
 }
 const primitives=[...row.querySelectorAll('[data-sheet-melody-lane] path,[data-sheet-melody-lane] line,[data-sheet-melody-lane] text,[data-sheet-melody-lane] circle,[data-sheet-melody-lane] ellipse,[data-sheet-melody-lane] polygon,[data-sheet-melody-lane] polyline,[data-sheet-connections] path')];
 const melodyNodes=primitives.filter(el=>!el.closest('[data-melody-lyric],[data-cursor-bar],[data-ignore-annotation]')&&(el.tagName.toLowerCase()!=='text'||el.closest('.sheet-note-art,[data-melody-tuplet],[data-sheet-connections]')));
 const melody=union(melodyNodes.map(ink)),lyrics=[...row.querySelectorAll('[data-melody-lyric]')].map(el=>({verse:el.dataset.lyricVerse,bounds:ink(el)})).filter(v=>v.bounds);
 return{melody,lyrics};
}
// Clip padding only. If actual artwork overlaps, stop rather than cutting through glyphs.
export function separateMusicPadding(children,musicInk,originTop){
 const melody=children.find(c=>c.classKey==='melody'),lyrics=children.filter(c=>c.classKey==='lyrics');if(!melody||!lyrics.length)return;
 const inkBottom=Math.ceil(musicInk.melody.bottom-originTop),inkTop=Math.floor(Math.min(...musicInk.lyrics.map(l=>l.bounds.top))-originTop);
 if(inkBottom>inkTop)throw Error('Actual melody and lyric artwork overlap; refusing clipped annotations');
 const boundary=Math.floor((inkBottom+inkTop)/2);melody.bbox[3]=Math.min(melody.bbox[3],boundary);for(const lyric of lyrics)lyric.bbox[1]=Math.max(lyric.bbox[1],boundary);
}
