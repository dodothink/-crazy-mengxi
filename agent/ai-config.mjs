export const providers={
 moonshot:{label:'Kimi',base:'https://api.moonshot.cn/v1',secret:'kimi-key',model:'kimi-k3.1-pro'},
 openrouter:{label:'OpenRouter',base:'https://openrouter.ai/api/v1',secret:'openrouter-key',model:'baidu/ernie-5.5-flash-preview:free'}
};
// 实测可用：ernie 中文回复稳定；ling/gemma 免费池常 429；nemotron 为推理模型，易耗尽预算返回空正文。
export const openrouterFreeModels=['baidu/ernie-5.5-flash-preview:free','inclusionai/ling-3.2-flash:free','google/gemma-4-31b-it:free'];
export const defaults={provider:'moonshot',model:'kimi-k3.1-pro',dailyLimit:0,batchSize:8,reasoningEffort:'low',maxCompletionTokens:8192,cacheTTL:'5m',fallbackEnabled:true,fallbackModels:['deepseek/deepseek-v4-flash','deepseek/deepseek-v3.2'],paidDailyLimit:50};
export function aiSettings(store,input){
 const value={...defaults,...store.get('aiConfig',{})};
 if(!providers[value.provider])value.provider='moonshot';
 if(input!==undefined){
  for(const k of ['dailyLimit','batchSize','maxCompletionTokens'])if(input[k]!==undefined){if(typeof input[k]!=='number'||!Number.isInteger(input[k]))throw Error('AI设置必须为整数');value[k]=input[k];}
  for(const k of ['reasoningEffort','cacheTTL'])if(input[k]!==undefined)value[k]=input[k];
  if(input.fallbackEnabled!==undefined){if(typeof input.fallbackEnabled!=='boolean')throw Error('回退开关必须为布尔值');value.fallbackEnabled=input.fallbackEnabled;}
  if(input.paidDailyLimit!==undefined){if(!Number.isInteger(input.paidDailyLimit))throw Error('付费上限必须为整数');value.paidDailyLimit=input.paidDailyLimit;}
  if(input.fallbackModels!==undefined){
   if(!Array.isArray(input.fallbackModels)||input.fallbackModels.length>3)throw Error('回退模型最多 3 个');
   value.fallbackModels=input.fallbackModels.filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim());
   for(const m of value.fallbackModels)if(!/^[A-Za-z0-9._:\/-]{3,120}$/.test(m))throw Error('回退模型名无效: '+m);
  }
  if(input.provider!==undefined){if(!providers[input.provider])throw Error('不支持的AI提供方');value.provider=input.provider;}
  if(input.model!==undefined){if(typeof input.model!=='string'||!/^[A-Za-z0-9._:\/-]{3,120}$/.test(input.model))throw Error('模型名无效');value.model=input.model;}
  if(value.paidDailyLimit<0||value.paidDailyLimit>1000)throw Error('付费每日上限超出范围');
  if(value.dailyLimit<0||value.dailyLimit>100000||value.batchSize<1||value.batchSize>20||value.maxCompletionTokens<1024||value.maxCompletionTokens>32768||!['low','high','max'].includes(value.reasoningEffort)||!['5m','1h'].includes(value.cacheTTL))throw Error('AI设置超出允许范围');
  // Switching provider swaps the model to that provider's default unless a model was passed explicitly.
  const previous=store.get('aiConfig',{}).provider||defaults.provider;
  if(value.provider!==previous&&input.model===undefined)value.model=providers[value.provider].model;
  if(value.provider==='moonshot')value.model=providers.moonshot.model;
  store.set('aiConfig',value);
 }
 return value;
}
// Kimi keeps its Moonshot-only fields; OpenRouter is OpenAI-compatible and rejects them.
export function completionRequest(cfg,messages){
 if(cfg.provider==='openrouter')return {model:cfg.model||providers.openrouter.model,messages,max_tokens:cfg.maxCompletionTokens};
 return {model:providers.moonshot.model,reasoning_effort:cfg.reasoningEffort,max_completion_tokens:cfg.maxCompletionTokens,prompt_cache_options:{ttl:cfg.cacheTTL},messages};
}
export function checkQuota(store,cfg,day){const used=store.get('ai:'+day,0);if(cfg.dailyLimit>0&&used>=cfg.dailyLimit)throw Error('今日AI调用已达设定上限 '+cfg.dailyLimit+' 次');return used;}
export function completionText(j){const c=j.choices?.[0];if(c?.finish_reason==='length')throw Error('模型输出达到Token上限，请提高输出预算后重试；本次未生成可用草稿');const text=c?.message?.content;if(typeof text!=='string'||!text.trim())throw Error('模型未返回正文，请检查输出预算、推理强度或该模型是否支持当前任务');return text;}
