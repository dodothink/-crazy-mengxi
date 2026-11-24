// 统一时间格式：默认 +08:00；都柏林主机按 GMT（含夏令时）标注。
export const zoneLabel=zone=>zone==='Europe/Dublin'?'GMT（含夏令时）':zone==='Asia/Shanghai'?'+08:00':zone;
export function fmtIn(ts,zone='Asia/Shanghai'){
 if(!ts)return '未知';
 const d=new Date(ts);
 if(Number.isNaN(d.getTime()))return '未知';
 const text=new Intl.DateTimeFormat('zh-CN',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);
 return text+' '+zoneLabel(zone);
}
export const fmtBJ=ts=>fmtIn(ts,'Asia/Shanghai');
