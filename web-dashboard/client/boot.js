// A small independent recovery path still works if the application cannot start.
let shown=false;
function recover(){
  if(shown)return;shown=true;
  const show=()=>{
    const box=document.createElement('div');box.className='app-error';box.setAttribute('role','alert');
    box.innerHTML='<strong>页面遇到问题</strong><span>请重新加载。已保存的本地记录不会被清除，也可以先导出一份备份。</span><button id="recovery-export">导出本地记录</button><button id="recovery-reload">重新加载</button>';
    document.body.prepend(box);document.getElementById('recovery-reload').onclick=()=>location.reload();
    document.getElementById('recovery-export').onclick=()=>{
      let raw;try{raw=localStorage.getItem('fund-observatory-v1-recovery')||localStorage.getItem('fund-observatory-v1');}catch{}
      const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([raw||'{}'],{type:'application/json'}));a.download='观基-紧急备份.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    };
  };
  if(document.body)show();else document.addEventListener('DOMContentLoaded',show,{once:true});
}
window.addEventListener('error',event=>{if(event.error||event.target?.tagName==='SCRIPT')recover();},true);
window.addEventListener('unhandledrejection',recover);
