// Kimi's SSE stream keeps long generation observable; never accept a partial response.
export async function readKimiStream(response){
 let buffer='',data=[],content='',finish=null,usage=null,done=false,bytes=0;
 const decoder=new TextDecoder();
 function event(){if(!data.length)return;const raw=data.join('\n');data=[];if(raw==='[DONE]'){done=true;return;}const j=JSON.parse(raw);if(j.error)throw Error('模型流返回错误');if(j.usage)usage=j.usage;const c=j.choices?.[0];if(c?.delta?.content)content+=c.delta.content;if(c?.finish_reason)finish=c.finish_reason;if(content.length>100000)throw Error('模型正文超出限制');}
 for await(const chunk of response.body){bytes+=chunk.length;if(bytes>4*1024*1024)throw Error('模型响应超出限制');buffer+=decoder.decode(chunk,{stream:true});let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n).replace(/\r$/,'');buffer=buffer.slice(n+1);if(!line)event();else if(line.startsWith('data:'))data.push(line.slice(5).trimStart());}if(done)break;}
 if(!done||!finish)throw Error('模型连接中断，未收到完整摘要；保留进度等待重试');
 return {choices:[{finish_reason:finish,message:{content}}],usage};
}
