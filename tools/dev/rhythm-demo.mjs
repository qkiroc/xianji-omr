import sharp from 'sharp';

// Independent demo data, generated inside the isolated development database.
export async function seedRhythmDemo(api) {
  const source = await api('/datasets',{name:'小节与音符事件 · 切图示例',description:'两个小节的六线谱、简谱和歌词，用于本地验证。'});
  const song = await api('/datasets/'+source.id+'/songs',{name:'节奏标注练习',songGroupKey:'local-rhythm-demo',split:'train'});
  const positions=[80,160,240,320,480,560,640,720];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="320">
    <rect width="800" height="320" fill="white"/><g font-family="sans-serif" fill="#28354b">
    <text x="25" y="28" font-size="18">Rhythm practice · 2/4</text>
    ${[60,70,80,90,100,110].map(y=>`<path d="M20 ${y}H780" stroke="#69788b"/>`).join('')}
    ${[20,400,780].map(x=>`<path d="M${x} 60V145" stroke="#69788b"/>`).join('')}
    ${positions.map((x,i)=>`<rect x="${x-7}" y="${i%2?63:93}" width="14" height="14" fill="white"/><text x="${x}" y="${i%2?75:105}" font-size="15" text-anchor="middle">${[0,2,3,2][i%4]}</text><path d="M${x} 112V145" stroke="#28354b"/>`).join('')}
    <path d="M80 145H320M480 145H720" stroke="#28354b" stroke-width="3"/>
    ${positions.map((x,i)=>`<text x="${x}" y="205" font-size="25" text-anchor="middle">${[1,2,3,5][i%4]}</text><path d="M${x-10} 214H${x+10}" stroke="#28354b" stroke-width="2"/>`).join('')}
    <path d="M400 180V220" stroke="#69788b"/>
    ${positions.map(x=>`<text x="${x}" y="277" font-size="21" text-anchor="middle">la</text>`).join('')}
    </g></svg>`;
  const image = await sharp(Buffer.from(svg)).png().toBuffer();
  let page = await api('/songs/'+song.id+'/pages',image,'POST',{'Content-Type':'image/png','X-File-Name':'rhythm-practice.png'});
  const box=(id,classKey,y,height,readingOrder,parentSystemId='system')=>({id,classKey,parentSystemId,readingOrder,x:20,y,width:760,height});
  page=await api('/pages/'+page.image.id,{version:page.image.version,annotationFormat:'layout-v2',boxes:[
    box('system','system',10,290,0,null),box('guitar','guitar',45,115,1),box('melody','melody',180,50,2),box('lyrics','lyrics',250,40,3),
  ]},'PUT');
  await api('/pages/'+page.image.id+'/confirm',{version:page.image.version,acknowledged:true});
  return api('/localization/datasets',{name:'小节与音符事件 · 标注示例',description:'先画小节，再画音符或歌词事件。',task:'rhythm',sourceDatasetId:source.id});
}
