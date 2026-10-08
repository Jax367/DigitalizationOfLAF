const api=window.lafDetail,pane=document.querySelector('#details'),handle=document.querySelector('#width-handle');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let sequence=0,current=null,drag=null,chain=Promise.resolve();
async function render(){
 const token=++sequence,data=await api.state();if(token!==sequence)return;
 const item=data.item;if(!item){pane.classList.remove('visible');pane.replaceChildren();return;}
 const changing=current!==item.id;current=item.id;if(changing)pane.classList.remove('visible');
 document.documentElement.dataset.theme=data.settings.theme;document.documentElement.style.setProperty('--panel-alpha',String(1-data.settings.transparency/100));
 const date=new Date(item.created_at.includes('T')?item.created_at:item.created_at.replace(' ','T')+'Z').toLocaleString('zh-CN');
 pane.innerHTML=`<div class="row between detail-head"><span class="badge">未认领 · #${Number(item.id)}</span><button id="close" class="quiet" aria-label="收起详情">×</button></div><h2>${escape(item.title)}</h2><p class="description">${escape(item.description||'暂无描述')}</p><dl class="facts"><dt>出现楼层</dt><dd>${escape(item.floor||'未填写')}</dd><dt>录入时间</dt><dd>${escape(date)}</dd></dl><div id="image" class="hint">${item.image_id?'正在读取图片…':'暂无关联图片'}</div><p class="width-caption">拖动外侧边缘调整宽度</p>`;
 document.querySelector('#close').addEventListener('click',()=>api.close());
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));if(token!==sequence)return;await api.ready(data.revision);
 if(item.image_id){try{const photo=await api.image(item.image_id);if(token!==sequence)return;const node=document.querySelector('#image');if(photo){const img=document.createElement('img');img.src=photo;img.alt=item.title;img.className='photo';node.replaceWith(img);}else node.textContent='图片尚未缓存';}catch(error){if(token===sequence)document.querySelector('#image').textContent=error.message;}}
}
const resize=value=>{chain=chain.then(()=>api.width(value)).catch(()=>{});};
handle.addEventListener('pointerdown',event=>{if(event.button!==0)return;drag={x:event.screenX,width:innerWidth};handle.setPointerCapture(event.pointerId);});
handle.addEventListener('pointermove',event=>{if(drag)resize(drag.width+(event.screenX-drag.x)*(document.documentElement.dataset.side==='left'?-1:1));});
for(const type of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(type,()=>{drag=null;});
handle.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();resize(innerWidth+(event.key==='ArrowRight'?20:-20)*(document.documentElement.dataset.side==='left'?-1:1));});
api.onChange(()=>render().catch(()=>api.close()));api.onShow(()=>requestAnimationFrame(()=>pane.classList.add('visible')));api.onHide(()=>{++sequence;current=null;pane.classList.remove('visible');});api.onPosition(side=>{document.documentElement.dataset.side=side;});render().catch(()=>api.close());
