// Downstream reads only local archives. The separate upstream owns collection.
const LocalMode=(()=>{
 async function enforce(){const s=await My0511API.status();if(!s.haltCollect)await My0511API.pause('collect');await AddonState.write('autoReplyConfig',{enabled:false});await AddonState.update('autoReplyTask',t=>t&&['waiting_notice','countdown','claiming','sending'].includes(t.state)?{...t,state:'cancelled',reason:'已切换本机读取与逐条确认模式',...(t.state==='sending'?{submissionStartedAt:t.submissionStartedAt||Date.now()}:{})}:t,null);}
 const ready=AddonState.ready.then(enforce);ready.catch(()=>{});
 My0511API.on('collectResumed',()=>enforce().catch(()=>{}));
 return {active:true,ready,enforce};
})();
