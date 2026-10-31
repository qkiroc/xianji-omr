import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {fileURLToPath} from 'node:url';
import {compile} from './compile-ui.mjs';
const window=new Window({url:'http://localhost/localization/datasets/d/records/r'});
const NativeMessageChannel=globalThis.MessageChannel,channels=[];
globalThis.MessageChannel=class extends NativeMessageChannel {constructor(){super();channels.push(this);}};
for(const name of ['window','document','navigator','HTMLElement','Element','Node','ShadowRoot','HTMLInputElement','HTMLFormElement','HTMLButtonElement','MutationObserver','ResizeObserver','getComputedStyle','FormData','File','Event','CustomEvent','MouseEvent','PointerEvent','KeyboardEvent','SVGElement']){
 Object.defineProperty(globalThis,name,{configurable:true,value:name==='window'?window:name==='getComputedStyle'?window[name].bind(window):window[name]});
}
globalThis.requestAnimationFrame=window.requestAnimationFrame.bind(window);globalThis.cancelAnimationFrame=window.cancelAnimationFrame.bind(window);globalThis.IS_REACT_ACT_ENVIRONMENT=true;
after(async()=>{await window.happyDOM.close();for(const channel of channels){channel.port1.close();channel.port2.close();}globalThis.MessageChannel=NativeMessageChannel;});
const React=await import('react'),{createRoot}=await import('react-dom/client'),{act}=React,h=React.createElement;
const {UiProvider}=await import(await compile(fileURLToPath(new URL('../components/ui/provider.tsx',import.meta.url))));
const {LocalizationEditor}=await import(await compile(fileURLToPath(new URL('../components/localization/editor.tsx',import.meta.url)),{'next/navigation':new URL('./ui-navigation.mjs',import.meta.url).href}));
const page={localPageId:'p',sourcePageId:'p',sourceSha:'a'.repeat(64),pixelSha:null,width:200,height:160,mapping:[[1,0,0],[0,1,0],[0,0,1]]};
const initial={id:'r',dataset_id:'d',version:1,status:'draft',title:'Test rhythm',original:{},geometry:{schemaVersion:'omr-rhythm-v1',pages:[page],regions:[{id:'row',pageId:'p',systemId:'s',track:'guitar',bbox:[0,0,200,100]}],measures:[]}};
const click=async element=>{assert.ok(element,'button exists');await act(async()=>element.dispatchEvent(new window.MouseEvent('click',{bubbles:true})));};
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
const key=async(key,extra={})=>act(async()=>window.dispatchEvent(new window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra})));
test('actual editor: draw measure/event, set region categories without musical-content fields, undo/redo, crop view and save keyboard on Windows/Mac',async()=>{
 let remote=structuredClone(initial),savedBody;const originalFetch=globalThis.fetch;
 globalThis.fetch=async(path,opts={})=>{
  if(String(path).endsWith('/content'))return new Response(new Blob(['image'],{type:'image/png'}));
  if(String(path).includes('/editor?'))return Response.json({previousId:null,nextId:null});
  if(opts.method==='PUT'){savedBody=JSON.parse(opts.body);remote={...remote,version:remote.version+1,geometry:savedBody.geometry};}
  return Response.json(remote);
 };
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>{root.render(h(UiProvider,null,h(LocalizationEditor,{datasetId:'d',recordId:'r'})));});
  const svg=host.querySelector('svg[aria-label="小节与音符事件选区"]');assert.ok(svg);
  svg.getScreenCTM=()=>({inverse:()=>({})});svg.createSVGPoint=()=>({x:0,y:0,matrixTransform(){return{x:this.x,y:this.y};}});svg.setPointerCapture=()=>{};
  const draw=async(x1,y1,x2,y2)=>{
   await act(async()=>svg.dispatchEvent(new window.PointerEvent('pointerdown',{button:0,pointerId:1,clientX:x1,clientY:y1,bubbles:true})));
   await act(async()=>svg.dispatchEvent(new window.PointerEvent('pointermove',{pointerId:1,clientX:x2,clientY:y2,bubbles:true})));
   await act(async()=>svg.dispatchEvent(new window.PointerEvent('pointerup',{pointerId:1,clientX:x2,clientY:y2,bubbles:true})));
  };
  await click(button('画小节 M'));await draw(10,10,190,90);assert.ok(host.querySelector('[data-kind="move-measure"]'));
  await click(button('画事件 E'));await draw(40,20,70,80);assert.ok(host.querySelector('[data-kind="move-event"]'));
  assert.doesNotMatch(host.querySelector('.rhythm-properties').textContent,/事件类型|附点|连音比例|声部|延音到|歌词段落/);
  await key('4');assert.equal(host.querySelector('.rhythm-properties .ant-tag').textContent,'八分音符');
  await key('3');assert.equal(host.querySelector('.rhythm-properties .ant-tag').textContent,'四分音符');
  await key('z',{ctrlKey:true});assert.equal(host.querySelector('.rhythm-properties .ant-tag').textContent,'八分音符');
  await key('y',{ctrlKey:true});assert.equal(host.querySelector('.rhythm-properties .ant-tag').textContent,'四分音符');
  await key('4');await key('d');await key('r');assert.equal(host.querySelector('.rhythm-properties .ant-tag').textContent,'八分音符');
  await key('Tab');assert.equal(svg.getAttribute('viewBox'),'0 0 200 160');await key('Tab');assert.equal(svg.getAttribute('viewBox'),'0 0 200 100');
  await key('s',{metaKey:true});assert.equal(savedBody.version,1);const event=savedBody.geometry.measures[0].events[0];assert.deepEqual(event.rhythm,{duration:8});assert.equal(event.centerX,55);assert.deepEqual(event.bbox,[40,20,70,80]);
  assert.match(host.textContent,/草稿/);await key('s',{ctrlKey:true});assert.equal(savedBody.version,2);
 }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=originalFetch;}
});
test('failed save retains drawn regions and a remounted editor restores them before retrying',async()=>{
 let remote=structuredClone(initial),savedBody,fail=true,toast='';const originalFetch=globalThis.fetch;
 const onToast=e=>{if(e.detail.text)toast=e.detail.text;};window.addEventListener('omr-toast',onToast);
 window.localStorage.clear();
 globalThis.fetch=async(path,opts={})=>{
  if(String(path).endsWith('/content'))return new Response(new Blob(['image'],{type:'image/png'}));
  if(String(path).includes('/editor?'))return Response.json({previousId:null,nextId:null});
  if(opts.method==='PUT'){
   if(fail)return Response.json({error:'事件类型无效'},{status:400});
   savedBody=JSON.parse(opts.body);remote={...remote,version:remote.version+1,geometry:savedBody.geometry};
  }
  return Response.json(remote);
 };
 const host=document.createElement('div');document.body.append(host);let root=createRoot(host);
 const render=()=>act(async()=>root.render(h(UiProvider,null,h(LocalizationEditor,{datasetId:'d',recordId:'r'}))));
 try{
  await render();const svg=host.querySelector('svg[aria-label="小节与音符事件选区"]');
  svg.getScreenCTM=()=>({inverse:()=>({})});svg.createSVGPoint=()=>({x:0,y:0,matrixTransform(){return{x:this.x,y:this.y};}});svg.setPointerCapture=()=>{};
  const draw=async(x1,y1,x2,y2)=>{for(const [type,x,y] of [['pointerdown',x1,y1],['pointermove',x2,y2],['pointerup',x2,y2]])await act(async()=>svg.dispatchEvent(new window.PointerEvent(type,{button:0,pointerId:1,clientX:x,clientY:y,bubbles:true})));};
  await click(button('画小节 M'));await draw(10,10,190,90);await click(button('画事件 E'));await draw(40,20,70,80);await key('s',{ctrlKey:true});
  const draft=JSON.parse(window.localStorage.getItem('omr-region-draft:r'));assert.equal(draft.geometry.measures[0].events.length,1);assert.match(toast,/旧版校验/);
  await act(async()=>root.unmount());root=createRoot(host);fail=false;await render();
  assert.ok(host.querySelector('[data-kind="move-event"]'));await key('s',{metaKey:true});
  assert.equal(savedBody.geometry.measures[0].events.length,1);assert.equal(window.localStorage.getItem('omr-region-draft:r'),null);
 }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=originalFetch;window.localStorage.clear();window.removeEventListener('omr-toast',onToast);}
});
