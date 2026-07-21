# Changelog

## 0.7.0 - 2026-07-21

- 新增中文只读 Web Dashboard，包含总览、历史日报、回测分析、数据质量和运行状态五个页面。
- 日报改为按北京时间日期和 `runId` 不可变保存，并维护 `reports/index.json` 与 `reports/latest.json`。
- `ops serve-reports` 改为提供打包 SPA 和只读 `/api/v1/*`，动态合并预测账本中的当前复盘状态。
- 新增 `LOTTERYMCP_WEB_ACCESS_MODE=tunnel|public`；默认 tunnel 仍适合 SSH 隧道。
- 新增独立 Web 认证存储和 `ops auth init`，公网模式要求口令、TOTP、HttpOnly SameSite Strict Cookie、登录限流和审计。
- Docker Compose 将 reports 的 P3 数据挂载为只读，并拆分 `/web-state` 与 `/secrets`，worker 不再读取 Web 认证 secret。
- 发布物随 CLI 包含 Web 静态资源，MCP 工具和预测算法保持不变。

## 0.6.0 - 2026-07-20

- 新增 M003 线上运维 schema，记录每日预测运行、运行事件和企业微信通知投递。
- 预测账本结算状态升级为 `pending/provisional/confirmed/disputed`；单来源开奖只做暂定复盘，不再静默当作确认事实。
- 新增 `ops run-once`，可执行同步、结算、预测、日报生成和可选企业微信通知。
- 新增 `ops serve-reports`，默认适配 SSH 隧道访问的本地静态报告服务。
- 新增 `data bundle create/verify/restore`，使用 SQLite 在线备份生成可校验迁移包，避免直接拷贝 WAL 数据目录。
- 新增 Dockerfile、Docker Compose 和环境变量示例；Compose 仅把报告端口发布到宿主机 `127.0.0.1:4317`。
- 版本升级为 `0.6.0`，发布物和声明文件已同步。

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
