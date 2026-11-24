// 角色开关：合并版一份代码，两个部署形态。
// collector = 采集端（Edge）：负责读论坛、写存档；不参与回复。
// responder = 回复端（Chrome）：只读存档、生成草稿、审核发表；不采集。
// 未设置 = 不干预，行为与上游纯插件版一致（保证上游测试与老用户升级不受影响）。
const AddonRole=(()=>{
 const KEY='role';
 let cached;
 async function get(){
  if(cached!==undefined)return cached;
  cached=await AddonState.read(KEY,null);
  return cached;
 }
 async function set(role){
  if(![null,'collector','responder'].includes(role))throw Error('角色只能是 collector、responder 或未设置');
  await AddonState.write(KEY,role);
  cached=role;
  return role;
 }
 const label=role=>role==='collector'?'采集端':role==='responder'?'回复端':'未设置（与纯插件版一致）';
 return {get,set,label,KEY};
})();
