const fs=require('fs'), path=require('path'), terser=require('terser');
const ROOT=path.resolve('../..');
const SKIP=new Set(['.workbuddy','_shots','_gen','tools','test','preview']);
function walk(d,out){
  for(const e of fs.readdirSync(d,{withFileTypes:true})){
    const p=path.join(d,e.name);
    const rel=path.relative(ROOT,p).replace(/\\/g,'/').split('/')[0];
    if(e.isDirectory()){ if(!SKIP.has(rel)) walk(p,out); }
    else if(e.name.endsWith('.js')) out.push(p);
  }
}
(async()=>{
  const files=[]; walk(ROOT,files);
  let before=0, after=0; const failed=[];
  for(const f of files){
    const src=fs.readFileSync(f,'utf8'); before+=Buffer.byteLength(src);
    try{
      const r=await terser.minify(src,{compress:true,mangle:true});
      after+=Buffer.byteLength(r.code);
    }catch(e){ failed.push(path.basename(f)+': '+e.message.slice(0,80)); }
  }
  console.log('JS 文件数:',files.length);
  console.log('源码合计: '+(before/1024).toFixed(1)+' KB');
  console.log('terser 压缩后: '+(after/1024).toFixed(1)+' KB');
  console.log('估算省下: '+((before-after)/1024).toFixed(1)+' KB ('+((before-after)/before*100).toFixed(1)+'%)');
  console.log('压缩失败:', failed.length?failed:'无');
})();
