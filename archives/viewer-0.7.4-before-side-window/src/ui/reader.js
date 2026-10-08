const api=window.laf;
const list=document.querySelector('#records'),pane=document.querySelector('#detail'),state=document.querySelector('#state');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let items=[],selected=null,loading=false,imageToken=0,timer;
function render(){
 const query=document.querySelector('#search').value.trim().toLowerCase();
 const shown=items.filter(item=>`${item.title} ${item.description??''} ${item.floor??''}`.toLowerCase().includes(query));
 list.innerHTML=shown.length?shown.map(item=>`<button data-id="${Number(item.id)}" class="${selected===item.id?'active':''}">${escape(item.title)}</button>`).join(''):'<p class="muted">暂无匹配记录</p>';
 list.querySelectorAll('[data-id]').forEach(button=>button.addEventListener('click',()=>detail(Number(button.dataset.id))));
}
async function detail(id){
 const item=items.find(item=>item.id===id);if(!item)return;
 selected=id;const token=++imageToken;render();
 const date=new Date(item.created_at.includes('T')?item.created_at:item.created_at.replace(' ','T')+'Z').toLocaleString('zh-CN');
 pane.innerHTML=`<span class="badge">未认领 · #${Number(item.id)}</span><h2>${escape(item.title)}</h2><p class="description">${escape(item.description||'暂无描述')}</p><dl class="facts"><dt>出现楼层</dt><dd>${escape(item.floor||'未填写')}</dd><dt>录入时间</dt><dd>${escape(date)}</dd></dl><p id="image-state" class="muted">${item.image_id?'正在读取图片…':'暂无关联图片'}</p>`;
 if(!item.image_id)return;
 try{const photo=await api.image(item.image_id);if(token!==imageToken)return;const node=document.querySelector('#image-state');if(photo){const img=document.createElement('img');img.className='photo';img.alt=item.title;img.src=photo;node.replaceWith(img);}else node.textContent='图片尚未缓存';}catch(error){if(token===imageToken)document.querySelector('#image-state').textContent=error.message;}
}
async function refresh(){
 if(loading)return;loading=true;document.querySelector('#refresh').disabled=true;
 try{const data=await api.records(true);items=data.items.filter(item=>item.status==='found');state.textContent=data.error||`${items.length} 件未认领物品${data.offline?' · 离线缓存':''}`;render();if(selected&&items.some(item=>item.id===selected))await detail(selected);else{selected=null;++imageToken;pane.innerHTML='<p class="muted">选择一条记录查看详情</p>';}}catch(error){state.textContent=error.message;}finally{loading=false;document.querySelector('#refresh').disabled=false;}
}
async function configure(){const settings=await api.settings();document.documentElement.dataset.theme=settings.theme;clearInterval(timer);timer=setInterval(refresh,settings.refreshSeconds*1000);await refresh();}
document.querySelector('#search').addEventListener('input',render);document.querySelector('#refresh').addEventListener('click',refresh);api.onSettingsChanged(configure);configure().catch(error=>{state.textContent=error.message;});
