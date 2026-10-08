const api=window.lafDetail,pane=document.querySelector('#details'),handle=document.querySelector('#width-handle'),stack=document.querySelector('#content-stack');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let sequence=0,current=null,drag=null,chain=Promise.resolve(),currentLayer=null,animations=[],transitionSerial=0;
const nextPaint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
function settleTransition(){
 ++transitionSerial;for(const animation of animations)animation.cancel();animations=[];
 for(const child of [...stack.children])if(child!==currentLayer)child.remove();
 if(currentLayer){currentLayer.style.opacity='1';currentLayer.inert=false;currentLayer.removeAttribute('aria-hidden');}
}
function commit(layer,animate){
 settleTransition();const previous=currentLayer;currentLayer=layer;stack.appendChild(layer);
 if(!previous)return;
 if(!animate||matchMedia('(prefers-reduced-motion: reduce)').matches){previous.remove();return;}
 previous.inert=true;previous.setAttribute('aria-hidden','true');
 const serial=++transitionSerial,options={duration:180,easing:'ease-in-out',fill:'both'};
 animations=[previous.animate([{opacity:1},{opacity:0}],options),layer.animate([{opacity:0},{opacity:1}],options)];
 Promise.allSettled(animations.map(animation=>animation.finished)).then(()=>{if(serial!==transitionSerial)return;settleTransition();});
}
async function prepareContent(item){
 const layer=document.createElement('section');layer.className='content-layer';layer.dataset.recordId=String(item.id);
 const date=new Date(item.created_at.includes('T')?item.created_at:item.created_at.replace(' ','T')+'Z').toLocaleString('zh-CN');
 layer.innerHTML=`<h2>${escape(item.title)}</h2><p class="description">${escape(item.description||'暂无描述')}</p><dl class="facts"><dt>出现楼层</dt><dd>${escape(item.floor||'未填写')}</dd><dt>录入时间</dt><dd>${escape(date)}</dd></dl>`;
 let photo=null,message='暂无关联图片';
 if(item.image_id){try{const data=await api.image(item.image_id);if(data){const img=new Image();img.src=data;img.alt=item.title;img.className='photo';let timeout;try{await Promise.race([img.decode(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('图片读取超时')),4000);})]);photo=img;}finally{clearTimeout(timeout);}}else message='图片尚未缓存';}catch(error){message=error.message||'图片读取失败';}}
 if(photo)layer.appendChild(photo);else{const note=document.createElement('div');note.className='hint';note.textContent=message;layer.appendChild(note);}
 return layer;
}
async function render(){
 const token=++sequence,data=await api.state();if(token!==sequence)return;
 const item=data.item;if(!item){pane.classList.remove('visible');current=null;settleTransition();return;}
 // Keep the accepted content and the window surface visible while preparing the next record.
 const layer=await prepareContent(item);if(token!==sequence)return;
 const changing=current!==null&&current!==item.id;current=item.id;
 document.documentElement.dataset.theme=data.settings.theme;document.documentElement.style.setProperty('--panel-alpha',String(1-data.settings.transparency/100));
 document.querySelector('#identity').textContent=`未认领 · #${item.id}`;commit(layer,changing&&pane.classList.contains('visible'));pane.scrollTop=0;
 await nextPaint();if(token!==sequence)return;await api.ready(data.revision);
}
document.querySelector('#close').addEventListener('click',()=>api.close());
const resize=value=>{chain=chain.then(()=>api.width(value)).catch(()=>{});};
handle.addEventListener('pointerdown',event=>{if(event.button!==0)return;drag={x:event.screenX,width:innerWidth};handle.setPointerCapture(event.pointerId);});
handle.addEventListener('pointermove',event=>{if(drag)resize(drag.width+(event.screenX-drag.x)*(document.documentElement.dataset.side==='left'?-1:1));});
for(const type of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(type,()=>{drag=null;});
handle.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();resize(innerWidth+(event.key==='ArrowRight'?20:-20)*(document.documentElement.dataset.side==='left'?-1:1));});
api.onChange(()=>render().catch(()=>api.close()));api.onShow(()=>requestAnimationFrame(()=>pane.classList.add('visible')));api.onHide(()=>{++sequence;current=null;settleTransition();pane.classList.remove('visible');});api.onPosition(side=>{document.documentElement.dataset.side=side;});render().catch(()=>api.close());
