// A/B: 同一装载流程跑「源码」vs「minify后」，从 vm 内部读 BF 注册表，比较是否一致。
const fs=require('fs'),path=require('path'),vm=require('vm'),terser=require('terser');
const ROOT=path.resolve('../..');
function load(minify){
  const sb={console:{log(){},warn(){},error(){}}};
  sb.GameGlobal=sb;
  sb.require=function(){return{};}; // 所有 require 纯副作用
  sb.wx={createImage:()=>({}),getSystemInfoSync:()=>({screenWidth:390,screenHeight:844,pixelRatio:2}),
    getStorageSync:()=>null,setStorageSync:()=>{},onTouchStart:()=>{},onTouchMove:()=>{},onTouchEnd:()=>{},
    createCanvas:()=>({getContext:()=>({})})};
  vm.createContext(sb);
  const entry=fs.readFileSync(path.join(ROOT,'game.js'),'utf8');
  const reqs=[...entry.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)].map(m=>m[1]);
  let bootErr=null;
  for(const r of reqs){
    const f=path.join(ROOT,r+'.js'); if(!fs.existsSync(f))continue;
    let src=fs.readFileSync(f,'utf8');
    if(minify){try{src=terser.minify(src,{compress:true,mangle:true}).code;}catch(e){bootErr='minify '+path.basename(f)+': '+e.message;break;}}
    try{vm.runInContext(src,sb,{filename:path.basename(f)});}catch(e){bootErr=path.basename(f)+': '+e.message;break;}
  }
  // 从 vm 内部读取注册表
  const probe=vm.runInContext(`(function(){
    var G=typeof GameGlobal!=='undefined'?GameGlobal:(typeof window!=='undefined'?window:globalThis);
    var bf=G.BF||{};
    return {games: bf.games?Object.keys(bf.games).sort():[],
            diff: bf.DIFF_ASSETS?bf.DIFF_ASSETS.length:-1,
            photo: bf.PHOTO_ASSETS?bf.PHOTO_ASSETS.length:-1,
            version: bf.VERSION||null, scenes: bf.App?Object.keys(bf.App.scenes||{}).sort():[]};
  })()`,sb);
  return {bootErr,...probe};
}
(async()=>{
  const a=load(false),b=load(true);
  console.log('源码  :',JSON.stringify(a));
  console.log('minify:',JSON.stringify(b));
  const same=JSON.stringify(a)===JSON.stringify(b);
  console.log(same?'✅ A/B 完全一致：压缩后 17 款游戏/场景/图对全部照常注册':'⚠ A/B 不一致');
  process.exit(same?0:1);
})();
