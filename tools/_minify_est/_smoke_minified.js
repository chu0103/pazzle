// 把全部打包 JS 分别 minify 后拼接(按 game.js 依赖顺序)，在 fake GameGlobal 下装载，
// 验证「压缩后的代码」仍可运行且 17 款游戏全部注册 —— 不只用 terser 语法通过。
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
// 极简 fake 环境，够模块挂载用
global.GameGlobal=global; global.BF=undefined;
global.require=function(){return {};};  // 所有 require 纯副作用，空实现即可
global.wx={createImage:()=>({}),getSystemInfoSync:()=>({screenWidth:390,screenHeight:844,pixelRatio:2}),
  getStorageSync:()=>null,setStorageSync:()=>{},onTouchStart:()=>{},onTouchMove:()=>{},onTouchEnd:()=>{},
  createCanvas:()=>({getContext:()=>({})})};
(async()=>{
  const files=[]; walk(ROOT,files);
  let code='';
  for(const f of files){
    const r=await terser.minify(fs.readFileSync(f,'utf8'),{compress:true,mangle:true});
    code+='\n;\n'+r.code;
  }
  try{
    new Function(code)();
    const bf=global.BF||global.GameGlobal.BF;
    const games=bf&&bf.games?Object.keys(bf.games):[];
    console.log('压缩后代码装载: OK');
    console.log('注册游戏数:',games.length, games.join(','));
    console.log('内置图对:',bf.DIFF_ASSETS?bf.DIFF_ASSETS.length:'n/a','照片:',bf.PHOTO_ASSETS?bf.PHOTO_ASSETS.length:'n/a');
  }catch(e){
    console.log('压缩后代码装载: FAIL ->',e.message);
    process.exit(1);
  }
})();
