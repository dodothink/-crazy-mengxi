// Downstream reads only local archives. The separate upstream owns collection.
const LocalMode=(()=>{
 async function enforce(){
  // 只有明确选成回复端才强制只读；未设置时保持上游纯插件版行为，采集端不干预。
  const role=typeof AddonRole!=='undefined'?await AddonRole.get():null;
  if(role!=='responder')return;
  const s=await My0511API.status();if(!s.haltCollect)await My0511API.pause('collect');
 }
 const ready=AddonState.ready.then(enforce);ready.catch(()=>{});
 My0511API.on('collectResumed',()=>enforce().catch(()=>{}));
 return {active:true,ready,enforce};
})();
