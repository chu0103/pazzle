// 把所有打包 JS minify 到 tools/_minify_est/mirror/ 保留目录结构，
// 再把非 js 资源软链/复制过去，得到一份「编译压缩后」的镜像工程。
const fs=require('fs'),path=require('path'),terser=require('terser');
const ROOT=path.resolve('../..'), MIR=path.resolve('mirror');
const SKIP=new Set(['.workbuddy','_shots','_gen','tools','test','preview']);
function copyDir(src,dst){
  fs.mkdirSync(dst,{recursive:true});
  for(const e of fs.readdirSync(src,{withFileTypes:true})){
    const s=path.join(src,e.name),d=path.join(dst,e.name);
    const rel=path.relative(ROOT,s).replace(/\\/g,'/').split('/')[0];
    if(SKIP.has(rel))continue;
    if(e.isDirectory())copyDir(s,d);
    else if(e.name.endsWith('.js')){
      const src=fs.readFileSync(s,'utf8');
      if(!src.trim()){ fs.writeFileSync(d,''); }
      else { const r=terser.minify(src,{compress:true,mangle:true}); fs.writeFileSync(d, r.code || src); }
    } else fs.copyFileSync(s,d);
  }
}
(async()=>{
  if(fs.existsSync(MIR))fs.rmSync(MIR,{recursive:true,force:true});
  copyDir(ROOT,MIR);
  console.log('镜像工程已生成:',MIR);
})();
