# Changelog

## 0.5.0 - 2026-07-17

- 新增显式 M002 migration、gzip As-of 特征快照和不可变实验注册表。
- 新增 nested walk-forward evaluator、逐折持久化、120 秒 lease、故障恢复和固定种子 bootstrap。
- 增加 `uniform-theory`、`random-monte-carlo`、`weighted-frequency-v1` 三个研究 evaluator。
- 新增 `experiment create/list/inspect/run/resume/report/evaluate`，冻结区只允许显式尝试一次。
- 实验报告原子写入 JSON/Markdown，冻结评估前不展示冻结区结果。
- Node 20 发布 smoke 改为动态读取 pack 文件名，并在 Windows、Linux、macOS 验证原生 SQLite。

## 0.4.0 - 2026-07-17

- 新增 SQLite 数据档案、JSON 迁移、在线备份、完整性校验和恢复前安全备份。
- 官方全量同步改为逐页 raw 归档和 7 天 checkpoint 断点续传，失败批次不提交半批 draws。
- 新增双官方来源核对、冲突分类/筛选、基于 observation 的人工确认与修订审计。
- 新增 confirmed-only dataset snapshot、snapshot inspect/verify 和显式 single-source 研究快照。
- 新增引用感知 raw GC，并保留 23 个真实历史冲突的范围隔离策略。
- 预测账本继续保留为 JSON；实验功能未在 0.4.0 发布。

## 0.3.0 - 2026-07-17

- 将公开类型、MCP Schema、本地缓存和远端响应收敛为排列3专用契约。
- 增加 official 模式初始化参数和完整的无 Token 本地数据工作流。
- 统一五个 P3 MCP 工具清单，补齐许可证、发布元数据和持续集成。
- 保留 `analyze`、`sync --all`、`NbcpConfig`、`createLotteryApiClient`、
  `startNbcpStdioServer` 和 `NBCP_*` 兼容入口；计划在 1.0.0 删除。
