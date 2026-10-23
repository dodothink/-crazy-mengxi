(function(root){
 const format='请在分析之后用独立标签输出可直接使用的纯回复正文：<reply-short>简短回复正文</reply-short> 和 <reply-normal>普通回复正文</reply-normal>。每段不超过1000字，标签内不放分析或操作说明。';
 function request(prompt){return prompt.length+format.length+1<=500?prompt+'\n'+format:prompt;}
 function extract(text){
  const result={short:'',normal:''};
  for(const kind of ['short','normal']){const m=text.match(new RegExp('<reply-'+kind+'>\\s*([\\s\\S]*?)\\s*</reply-'+kind+'>','i'));if(m)result[kind]=m[1].trim();}
  if(!result.short&&!result.normal){
   const lines=text.split(/\r?\n/);let active=null;
   for(const line of lines){const heading=line.replace(/^[\s#>*\d.、）)（-]+/,'').replace(/\*\*/g,'').trim();
    const match=/^(?:回复草稿\s*[一二12]?\s*[：:·—-]?\s*[（(]?)?(简短|普通)(?:版|回复|草稿|回复草稿|版回复|版草稿|版回复草稿)*[）)]?\s*[：:]?\s*$/.exec(heading);
    if(match){const kind=match[1]==='简短'?'short':'normal';if(active!==kind||/^\s*(?:#|\*\*)/.test(line)){active=kind;continue;}}
    if(active&&(/^\s*#{1,6}\s/.test(line)||/^\s*---+\s*$/.test(line))){active=null;continue;}
    if(active)result[active]+=line+'\n';
   }
  }
  for(const k of ['short','normal']){result[k]=result[k].trim();if(result[k].length>3000)result[k]='';}
  return result;
 }
 function canFill(start,current,startDraft,currentDraft){return start===current&&!startDraft.trim()&&currentDraft===startDraft;}
 const api={request,extract,canFill};root.Drafts=api;if(typeof module!=='undefined')module.exports=api;
})(typeof self!=='undefined'?self:this);
