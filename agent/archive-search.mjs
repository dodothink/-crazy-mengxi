export async function searchArchives(archives,{query='',author='',offset=0}={}){
 if(typeof query!=='string'||typeof author!=='string'||query.length>200||author.length>100)throw Error('搜索条件无效');
 query=query.trim();author=author.trim();if(!query&&!author)throw Error('请填写正文关键词或作者');
 if(!Number.isSafeInteger(offset)||offset<0)throw Error('翻页位置无效');
 const matches=[],needle=query.toLocaleLowerCase();
 for(const r of await archives.records())for(const f of r.floors){
  if(f.hidden||author&&f.author!==author)continue;const text=String(f.text||'');const index=needle?text.toLocaleLowerCase().indexOf(needle):0;if(index<0)continue;
  matches.push({tid:r.tid,title:r.title,url:r.url,floor:f.floor,author:f.author,time:f.time,snippet:text.slice(Math.max(0,index-60),index+240),complete:r.complete,analysisReady:r.analysisReady});
 }
 return {ok:true,total:matches.length,offset,hasMore:offset+50<matches.length,items:matches.slice(offset,offset+50),scope:'已发布机读存档的当前可见楼层正文；不含图片识别、历史版本和独立引用字段'};
}
