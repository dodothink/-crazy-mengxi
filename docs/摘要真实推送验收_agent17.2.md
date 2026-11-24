# agent.17.2 · 摘要真实推送验收

存档：运行中Agent与独立只读复验均读到9935帖，JSON校验异常0。

用户现有设置：3个开启账号，每天09:00，Europe/Dublin。没有更改名单、频率、时区或启停。对原失败任务请求一次重试。

原摘要任务多次fetch failed，但/models鉴权200、kimi-k3.1-pro存在；短回复和长输入短回复诊断均成功。无法仅凭此证明底层断线原因。改用Kimi官方SSE流式输出处理长摘要，完整[DONE]及finish_reason后才接受；推理片段不作为正文，长度截断或中断仍失败不推送。仅摘要调用流式，其余回复链路保持原行为。保留诊断错误码，不记录密钥。

真实验收：10条新增发言摘要已完成，remaining0，history/backfill跳过1条；Telegram outbox sent=1，lastError清空。最后一次摘要调用usage：prompt4149、completion2709、total6858，含缓存命中4096。下一次计划1794906000000（2026-11-17 09:00 Europe/Dublin）。未发表论坛回复。

回归：新增UTF8分包、推理与正文分离、usage保留、断流拒绝半成品、token上限拒绝等3项；共49+142=191通过。本轮未发布GitHub。

参考：https://platform.kimi.com/docs/guide/kimi-k3-1-pro-quickstart 的流式输出说明。
