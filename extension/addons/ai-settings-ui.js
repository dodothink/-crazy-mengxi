async function aiSettingsUI(save=false){const button=$('aiSave');button.disabled=true;try{const config=save?{provider:$('aiProvider').value,model:$('aiModel').value.trim(),fallbackEnabled:$('aiFallbackOn').checked,fallbackModels:$('aiFallback').value.split(',').map(x=>x.trim()).filter(Boolean),paidDailyLimit:Number($('aiPaidLimit').value),dailyLimit:Number($('aiDailyLimit').value),batchSize:Number($('aiBatchSize').value),reasoningEffort:$('aiEffort').value,maxCompletionTokens:Number($('aiTokens').value),cacheTTL:$('aiCache').value}:undefined;const r=await send({type:'ADDON_AI_CONFIG',action:save?'save':'status',config});const c=r.config;$('aiProvider').value=c.provider;$('aiModel').value=c.model;$('aiFallbackOn').checked=c.fallbackEnabled!==false;$('aiFallback').value=(c.fallbackModels||[]).join(',');$('aiPaidLimit').value=c.paidDailyLimit;$('aiDailyLimit').value=c.dailyLimit;$('aiBatchSize').value=c.batchSize;$('aiEffort').value=c.reasoningEffort;$('aiTokens').value=c.maxCompletionTokens;$('aiCache').value=c.cacheTTL;$('aiSettingsStatus').textContent=(save?'已保存，下一次请求生效。':'已读取。')+' 今日调用 '+r.usedToday+' / '+(c.dailyLimit||'不限')+'（UTC日期） · 回退 '+(c.fallbackEnabled?'开（'+(c.fallbackModels||[]).length+' 个）':'关');}catch(e){$('aiSettingsStatus').textContent=e.message;}finally{button.disabled=false;}}
$('aiSave').onclick=()=>aiSettingsUI(true);$('aiLoad').onclick=()=>aiSettingsUI();aiSettingsUI();

async function aiModelList(){
 const r=await send({type:'ADDON_AI_MODELS'});
 const sel=$('aiModelPick');const current=$('aiModel').value.trim();
 sel.replaceChildren();
 const hint=document.createElement('option');hint.value='';hint.textContent='选择模型（共 '+r.models.length+' 个免费模型）';sel.append(hint);
 for(const m of r.models){
  const o=document.createElement('option');o.value=m.id;
  o.textContent=(m.test?(m.test.ok?'✅ '+(m.test.ms/1000).toFixed(1)+'s':'❌ 不可用')+'  ':'    ')+m.id;
  sel.append(o);
 }
 if(r.models.some(m=>m.id===current))sel.value=current;
 const usable=r.models.filter(m=>m.test?.ok).length;
 $('aiSettingsStatus').textContent='免费模型 '+r.models.length+' 个'+(usable?'，其中 '+usable+' 个已测通':'')+(r.cached?'（1 小时缓存）':'（刚从 OpenRouter 获取）');
}
$('aiModelPick').onchange=()=>{if($('aiModelPick').value)$('aiModel').value=$('aiModelPick').value;};
$('aiModels').onclick=()=>act(async()=>{const b=$('aiModels');b.disabled=true;try{await aiModelList();}catch(e){$('aiSettingsStatus').textContent=e.message;}finally{b.disabled=false;}});
$('aiTest').onclick=()=>act(async()=>{
 const b=$('aiTest');b.disabled=true;$('aiTestResult').textContent='测试中…（推理型模型可能需要十几秒）';
 try{const r=await send({type:'ADDON_AI_TEST'});
  $('aiTestResult').textContent=r.model+' · '+r.ms+' ms\n'+r.text+(r.usage?'\n用量 '+JSON.stringify(r.usage):'');
 }catch(e){$('aiTestResult').textContent='测试失败：'+e.message;}
 finally{b.disabled=false;}
});
aiModelList().catch(()=>{});
$('aiTestAll').onclick=()=>act(async()=>{
 const b=$('aiTestAll');b.disabled=true;$('aiTestResult').textContent='正在并发测速（4 个一组，每个最多 20 秒）…';
 try{const r=await send({type:'ADDON_AI_TEST_ALL'});
  const rows=r.results.map(x=>(x.ok?'✅ ':'❌ ')+String(x.ms).padStart(6)+'ms  '+x.id+(x.ok?'':'  — '+x.error));
  $('aiTestResult').textContent='可用 '+r.usable+' / '+r.total+'\n'+rows.join('\n');
  await aiModelList();
 }catch(e){$('aiTestResult').textContent='测速失败：'+e.message;}
 finally{b.disabled=false;}
});
