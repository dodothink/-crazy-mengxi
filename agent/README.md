# 疯狂的梦溪本地服务

完整操作见上级 使用说明.md。Node.js 24+，无 npm 依赖。监听 127.0.0.1:17851，仅接受已配对扩展。

Mac 双击 启动本地服务.command；Windows 双击 启动本地服务.cmd。停止按 Control/Ctrl+C，再启动即重启。本机继续使用原 runtime 保留凭据，不要向别人分享它。

新插件名为疯狂的梦溪；重新配对后 Kimi/TG 凭据仍保留。默认只读下载目录的 My0511存档，可在 runtime/config.json 设置 archiveDirectory。报告位于 runtime/reports。存档目录与 runtime 不能重叠。

支持回复草稿、手机审核、人工验证、提醒、日报和摘要。自动发表默认关闭。Kimi 每日 20 次请求按 UTC 日期计数；日报与免打扰按北京时间。真实 Windows 仍待验收。
