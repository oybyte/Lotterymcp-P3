# 排列3个人研究实验室实施计划

## 当前实现状态（0.7.0）

截至 2026-08-10，M001 数据档案、双来源核对、checkpoint 断点续传、冲突隔离、不可变 dataset snapshot、raw GC、M002、As-of 特征、实验注册、nested walk-forward、逐折恢复、一次性冻结评估、M003 线上运维表和中文只读 Web 研究台已经实现。预测已附带数据状态标注、分年度可信度报告与 confirmed-only 训练窗口基线，候选票附带排序分构成解释，SLA 时间证据（预测早于目标期首次本地 observation）通过 `data sla` 与 Web 总览呈现，失败运行记录输入参数以便复现。Web 研究台新增「数据快照」页，展示不可变数据集快照、哈希校验与绑定实验。`npm run reproduce` 在临时目录一键复现完整链路（数据档案 → 预测 → SLA → 快照校验）。

当前正式 evaluator 为 `uniform-theory`、`random-monte-carlo` 和 `weighted-frequency-v1`。0.7.0 交付个人服务器每日预测闭环、不可变日报、中文只读研究台、Web 认证、企业微信通知和数据迁移 bundle。逻辑回归、LightGBM、ONNX、Champion 晋级和 Shadow 仍按后续路线图推进，不属于 0.7.0 发布物。

真实数据仍保留 23 个未自动裁决的历史冲突。最近 2000 期可使用 confirmed snapshot；包含冲突的全历史实验继续阻塞。

## 1. 文档定位

本文是《排列3个人研究实验室产品方案》的工程实施配套文档。产品方案定义目标和原则，本文固定技术选择、实施顺序、迁移方式、统计口径和阶段退出条件。

实施过程中不得跳过数据可行性、无未来数据泄漏、冻结评估和 Shadow 四类闸门。任何 Challenger 未满足完整晋级条件时，正式预测继续使用 `weighted-frequency-v1`。

## 2. 已锁定决策

- 产品只支持排列3，领域值固定为 `pl3`。
- TypeScript 是 CLI、MCP、数据同步、SQLite、SOP 推理和模型加载的正式运行时。
- Python 3.12 仅用于仓库内离线研究，使用 `uv` 和独立锁文件，不进入 npm 发布包。
- SQLite 使用 `better-sqlite3`，以保持发布包 Node.js `>=20` 兼容。
- 数据库路径固定为 `<dataDir>/pl3.sqlite`；JSON 只用于迁移和交换，启用 SQLite 后不双写。
- 初始 Champion 固定为 `weighted-frequency-v1`；专有模型全部从 Challenger 开始。
- 排序同分时按 `000-999` 数值升序处理，保证跨环境确定性。
- 对象使用键排序的规范化 JSON 计算 SHA-256；时间保存为 UTC ISO 8601，开奖日保存为 `YYYY-MM-DD`。
- Web 研究台已在数据、实验和线上预测闭环之后实现，保持只读边界；Shadow 和 Champion 晋级继续通过 CLI 推进。

## 3. 必须先修正的产品口径

### 3.1 数据量门槛

| 可用记录数 | 允许行为 |
|---|---|
| `< 100` | 数据查看、同步、导入和质量检查 |
| `100..999` | SOP 预测和探索性 walk-forward |
| `1000..1999` | Challenger 开发实验，不允许正式冻结评估或晋级 |
| `>= 2000` | 至少 1000 条训练数据加 1000 条冻结数据，可以进入正式晋级流程 |

原产品文档中的 1500 期只作为探索门槛。冻结评估区 1000 期和最低训练段 1000 期不能重叠，因此正式晋级的有效下限是 2000 期。

### 3.2 完整率

不得用两个来源的简单并集证明完整历史。系统分别输出：

- `authoritativeCompleteness`：来源明确提供历史总数或开奖清单时，使用可用记录数除以权威总数。
- `reconciliationCoverage`：无冲突期数除以所有来源观测期号并集，只表示来源间覆盖。
- `dualSourceCoverage`：两个独立官方来源一致确认的期数占比。
- `completenessStatus`：没有权威分母时为 `unknown`，不得声称达到 99.9%。

期号跳跃只告警，不自动认定缺失，因为可能存在休市或期号规则调整。

### 3.3 预测时间证据

本地系统只能证明预测记录早于目标开奖结果的首次本地 observation。系统不得将本地时间戳描述为第三方可信开奖前证明。

## 4. 阶段 0：数据可行性与基线冻结

### 4.1 数据源验证

1. 对中国体彩网主源和中彩网回退源分别执行分页探测。
2. 记录可获取最早/最新期号、有效记录数、总数声明、分页终止条件、限频和 WAF 行为。
3. 保存不包含敏感信息的固定响应 fixture；不将抓取的完整历史数据提交到 npm 包。
4. 验证 JSON/CSV 文件导入可以作为来源均失败时的合法兜底。
5. 如果无法获得至少 2000 条可信历史，允许继续数据档案和 SOP 功能，但停止 Challenger 晋级开发。

### 4.2 算法基线

1. 固定当前 `weighted-frequency-v1` 的 200 期输入 fixture。
2. 保存 1000 个直选状态的完整排序、mixed 注数分配和 walk-forward 结果。
3. 存储重构后必须产生相同排序和 `predictionId`；如 ID 算法升级，保留旧 ID 并新增 `idAlgorithmVersion`。

### 4.3 阶段退出条件

- 两个来源的能力、限制和记录规模有可复验结论。
- 已明确项目当前是否具备 2000 期晋级数据条件。
- 当前 SOP 的确定性快照测试通过。

## 5. 阶段 1：SQLite 数据档案

### 5.1 数据库设置

- 连接启用 `foreign_keys=ON`、`journal_mode=WAL`、`busy_timeout=2000`。
- 所有写入使用参数化 SQL 和事务；迁移及关键写操作使用 `BEGIN IMMEDIATE`。
- schema migration 单向执行并记录版本、名称、校验和和应用时间。
- migration 前自动备份现有数据库，默认保留最近 5 份；正式模型 artifact 不随数据库备份轮转删除。

### 5.2 M001 表结构

| 表 | 关键约束 |
|---|---|
| `schema_migrations` | `version` 主键，保存 migration 校验和 |
| `app_meta` | `key` 主键，保存活动 schema 和迁移状态 |
| `source_snapshots` | 保存 provider、URL、获取时间、HTTP 状态、内容哈希、raw 路径和解析状态 |
| `draw_observations` | append-only；保存 period、日期、三位号码、provider、snapshot 和 observation 时间 |
| `draws` | `period` 主键；保存 `period_num`、当前真值和 `confirmed|single_source|conflict` 状态 |
| `draw_revisions` | append-only；保存旧值、新值、原因、证据和修订时间 |
| `dataset_snapshots` | 保存截止期、记录数、数据哈希和生成 commit |
| `dataset_snapshot_draws` | 固定 snapshot 实际引用的 observation，保证历史实验可重建 |

期号继续保存原始字符串，同时保存不超过 12 位的 `period_num` 用于稳定排序。不得直接依赖 SQLite 文本排序期号。

### 5.3 来源身份与真值规则

- 官方 provider 固定为 `lottery-gov-cn` 和 `zhcw`。
- `neuxsbot-remote` 和 `file-import` 默认不是独立官方确认来源。
- 两个独立官方来源日期和号码一致时，draw 为 `confirmed`。
- 只有一个可信 observation 时为 `single_source`，允许研究但必须披露。
- 同一期日期或号码不一致时为 `conflict`，不进入相关训练或预测快照。
- observation 不覆盖；来源后来修改数据时追加 observation，并通过 revision 更新当前真值。
- 人工处理冲突必须选择已有 observation 或提供新值、证据 URL 和原因。

### 5.4 原始快照与同步

1. 每个 HTTP 响应先以同目录临时文件写入 `raw/<provider>/<year>/<contentHash>.json.gz`，再原子重命名。
2. 数据库保存 raw 相对路径和 SHA-256，不将绝对用户路径写入可发布报告。
3. 主源出现 403、空页、重复页或格式错误时，丢弃该批解析结果并整批切换回退源。
4. `data sync --full` 解除预测窗口 1000 期限制，持续分页至来源结束，并保存可恢复同步游标。
5. `data sync` 只同步最新页；全量同步默认尝试第二来源进行核对，增量核对可按较低频率执行。
6. 同一主机请求间隔不少于 300ms；失败记录告警，不以空结果删除旧数据。
7. raw 已落盘而事务失败时允许留下孤立文件，由后续 `data gc --dry-run` 报告，默认不自动删除。

### 5.5 JSON 迁移与切换

迁移采用显式两阶段流程，`serve` 和 `doctor` 不隐式修改用户数据：

```text
lotterymcp data migrate --dry-run
lotterymcp data migrate --apply
```

`--dry-run` 只完成读取、严格校验、冲突预览和数量/hash 报告。`--apply` 执行：

1. 获取维护锁，发现运行中的写进程时拒绝迁移。
2. 备份 `pl3.json` 和 `pl3-predictions.json`。
3. 创建旁路数据库 `pl3.sqlite.migrating-<timestamp>`。
4. 在单事务中导入历史、预测和结算，保留旧 `predictionId`。
5. 对比记录数、最新期号、规范化号码哈希、预测数和结算数。
6. 执行 `PRAGMA integrity_check` 和外键检查。
7. 验证成功后原子切换为 `pl3.sqlite`；失败时删除旁路数据库，不修改原 JSON。

原 JSON 不自动删除。回退旧版本时仍可读取原文件；新版本不维护 SQLite/JSON 双写。

### 5.6 CLI 和 Provider

新增：

```text
lotterymcp data status
lotterymcp data sync [--full]
lotterymcp data import --file FILE --format json|csv
lotterymcp data export --format json|csv --output FILE
lotterymcp data conflicts
lotterymcp data resolve --period PERIOD --observation-id ID --reason TEXT --evidence-url URL
lotterymcp data migrate --dry-run|--apply
lotterymcp data restore --backup FILE
lotterymcp data gc --dry-run
```

现有 `sync --source official|file` 保留为薄兼容入口。official provider 改读 SQLite；remote provider 继续调用远端服务。`doctor` 只报告数据库、迁移、数据质量和冲突状态。

### 5.7 阶段退出条件

- JSON 迁移前后规范化数据和预测账本一致。
- migration 故障不会产生半切换数据库。
- 所有冲突、来源和历史修订可审计。
- 完整率有权威分母时达到 99.9%；无权威分母时明确显示 `unknown`。

## 6. 阶段 2：特征与实验基础设施

### 6.1 M002 表结构

新增 `feature_snapshots`、`experiments`、`experiment_folds`、`experiment_metrics` 和 `runtime_locks`。实验状态固定为：

```text
registered -> running -> development_complete -> frozen_evaluated
                    \-> interrupted
                    \-> failed
```

spec 修改必须创建新 `experimentId`，任何状态的旧实验都不允许覆盖。

### 6.2 As-of 特征

- 特征入口必须显式接收 `datasetSnapshotId` 和 `afterPeriod`。
- 只读取 snapshot 中期号不晚于 `afterPeriod` 的 observation。
- 实现位置/全局频率、和值、跨度、奇偶、号码结构、遗漏、间隔、`10/30/50/100/200/500` 窗口、熵、集中度和漂移。
- 标准化器、编码器和数据驱动参数必须在每个训练折重新拟合。
- 特征快照键由数据哈希、截止期号、特征版本、窗口配置和代码 commit 组成。

### 6.3 实验 spec

spec v1 必须冻结：研究假设、dataset snapshot、开发/冻结范围、排除规则、特征版本、模型、搜索空间、主辅指标、训练模式、窗口、重训频率、随机种子、研究批次和资源上限。

默认值：

- 最低训练段 1000 期。
- 冻结区最后 1000 期，创建后边界不随新数据移动。
- expanding 训练窗口。
- 内外层验证块和测试块均为 50 期，步长 50。
- 同分参数优先选择更简单模型，再按规范化参数字符串排序。
- 单实验最多使用逻辑核心的一半，最长运行 2 小时。

### 6.4 Nested walk-forward

1. 开发区内层折选择参数，外层折评估选择流程。
2. 每个目标期只能使用目标期之前的数据。
3. 每折结果立即持久化，`interrupted` 可从最后完整折恢复。
4. 冻结区汇总只允许 spec 和候选实现冻结后运行一次。
5. 本地系统无法阻止用户直接查看历史开奖，因此冻结区属于研究流程约束；每次解封必须审计。
6. 解封后修改特征、参数或代码必须创建新实验，不能复用原冻结结论。

### 6.5 评估统计

- 主指标：`normalizedRank = (rank - 1) / 999`，越低越好。
- 相对改善：`(SOP均值 - Challenger均值) / SOP均值`。
- Bootstrap 对每期 Challenger/SOP 配对差值执行，默认块长 30、10,000 次和固定种子。
- 同一预注册研究批次使用 Benjamini-Hochberg，要求 `q <= 0.05`。
- 概率模型与 `dirichlet-frequency` 比较 Log Loss、Brier 和 ECE，不与无概率 SOP 比较校准。
- ROI 只作为附录；没有开奖日期对应奖金规则时返回 `null`。

## 7. 阶段 3：基线和专有模型

### 7.1 统一 Ranker

每个模型实现统一 `Pl3Ranker`，输出 1000 个无重复直选状态：

```text
number, rawScore, rank, calibratedProbability?
```

未满足总概率为 1 且未通过校准的模型不得输出 `calibratedProbability`。组三取三个直选排列均值，组六取六个排列均值，mixed 继续使用 `40%/40%/20%` 最大余数法。

### 7.2 固定基线

统一 evaluator 必须支持：

- `uniform-theory`
- `random-monte-carlo`，每个实验不少于 10,000 次固定种子模拟
- `rolling-frequency`
- `weighted-frequency-v1`
- `dirichlet-frequency`

### 7.3 Python 研究交换协议

TypeScript 导出不可变实验 bundle：

```text
bundle-manifest.json
records.jsonl
features.jsonl
folds.json
```

Python 只读取 bundle，不直接写 SQLite。Python 输出到 staging：

```text
model-manifest.json
artifact.json 或 position-*.onnx
metrics.json
predictions.jsonl
```

TypeScript 校验 schema、experiment/spec/data/feature hash、文件 SHA-256 和推理一致性后，才将 artifact 原子移动到 `models/<modelId>/` 并注册数据库。

### 7.4 第一批 Challenger

- 三位置正则化多项逻辑回归。
- 和值、跨度和号码结构辅助分类。
- 限制深度和特征数量的 LightGBM 三位置模型。
- SOP 与 Challenger 的百分位排名集成。

简单模型导出 JSON；LightGBM 导出 ONNX。JSON 跨语言误差不超过 `1e-6`，ONNX 输出误差不超过 `1e-5`。

模型 manifest 必须包含模型类型、artifact 格式、特征版本、输入字段顺序、训练范围、dataset hash、spec hash、commit、依赖版本、随机种子、指标和所有文件哈希。

### 7.5 模型失效和回退

- artifact 损坏、ONNX 运行时缺失或输入 schema 不匹配时，模型不可运行。
- 不可运行 Challenger 不参与 compare 或 Shadow。
- 当前 Champion 不可运行时，明确告警并回退最近一个可运行 Champion；不得静默改变模型。
- 历史开奖修订与模型训练范围相交时，将模型标记为 `stale`。
- `stale` Challenger 禁止晋级；`stale` Champion 暂时继续服务并显示警告，直到新版本复评完成。

## 8. 阶段 4：线上预测闭环、Shadow 和晋级

### 8.0 0.6.0 线上闭环

0.6.0 已新增 M003 运维表：

| 表 | 用途 |
|---|---|
| `online_prediction_runs` | 记录每日同步、预测、报告生成状态 |
| `operational_events` | 记录运行事件、告警和失败原因 |
| `notification_deliveries` | 记录企业微信等通知投递和去重键 |

新增 CLI：

```text
lotterymcp ops run-once [--periods 200] [--tickets 10] [--play mixed] [--no-sync] [--migrate] [--no-notify]
lotterymcp ops serve-reports [--host 127.0.0.1] [--port 4317]
lotterymcp ops reports
lotterymcp data bundle create --output DIR
lotterymcp data bundle verify --bundle DIR
lotterymcp data bundle restore --bundle DIR
```

`ops run-once` 的顺序固定为：同步 P3 数据、结算待开奖记录、生成下一期预测、写入日报、记录运行状态、发送可选企业微信通知。单来源数据只能产生 `provisional` 复盘；双官方来源一致后才升级为 `confirmed`。若确认结果与暂定复盘不一致，账本进入 `disputed` 并追加 revision。

无域名服务器部署使用 Docker Compose。报告容器内监听 `0.0.0.0`，但宿主机只发布 `127.0.0.1:4317`；远程访问通过 SSH 隧道完成，不开放公网 Web。

### 8.1 M003 表结构

后续 Shadow 和模型晋级会新增 `model_artifacts`、`model_assignments`、`predictions`、`prediction_tickets`、`settlements` 和 `payout_schedules`。这些表属于后续 schema，不在当前 M003 中。

- 模型角色变化使用带起止时间的 assignment 历史，不覆盖旧角色。
- 预测和票据同一事务写入；不同模型对同一 `afterPeriod` 分别保存。
- settlement 主键为 `(prediction_id, revision)`；修订只追加。
- replay 明确标记，不计入实时 Shadow。

### 8.2 Prediction ID

新 ID 由 `idAlgorithmVersion`、模型 ID、spec hash、dataset snapshot、`afterPeriod`、玩法和注数计算。迁移记录保留旧 ID，不尝试重新计算。

### 8.3 Shadow Tick

```text
lotterymcp shadow tick
lotterymcp shadow status
```

一次 tick 幂等完成：增量同步、结算 pending、检查数据冲突、为下一未知开奖写入 Champion 和全部 Shadow 预测。有效 Shadow 预测必须满足：

- 创建时目标开奖不存在于任何 observation。
- `createdAt` 早于目标开奖首次 observation 的 `observedAt`。
- 系统时间和数据库时间没有回拨异常。

不满足条件的补生成记录只能标记为 replay。Shadow 模型固定 300 期，不按单期结果重训，也不得依据 Shadow 中途表现重新选择候选。

### 8.4 晋级规则

`model promote MODEL_ID` 不提供 `--force`，必须同时通过：

1. 冻结区至少 1000 期。
2. 相对 SOP 主指标改善至少 2%。
3. 配对时间块 bootstrap 的改善 95% 区间下界大于 0。
4. 同批多重比较修正后 `q <= 0.05`。
5. 三个连续等长时间段改善方向一致。
6. 任一主要分段相对 SOP 退化不超过 5%。
7. 概率模型相对 `dirichlet-frequency` 的校准退化不超过 5%。
8. 至少 300 期有效 Shadow 且平均改善方向和冻结评估一致。
9. artifact 在干净 Node/Python 环境中可复现。

晋级使用准确的 Shadow artifact，不在晋级时重新训练。回滚必须记录原因，并保留旧预测、结算和 assignment。

### 8.5 奖金规则

增加：

```text
lotterymcp data payouts list
lotterymcp data payouts set --effective-from DATE --stake N --direct N --group3 N --group6 N --source TEXT
lotterymcp data payouts import --file FILE
```

没有匹配日期和来源的奖金规则时只报告命中和成本，ROI 为 `null`。

## 9. MCP 和兼容性

- 保留 `lottery.latest/history/periods/summary/predict` 五个工具。
- 前四个工具只读；`lottery.predict` 只允许幂等追加正式预测账本。
- MCP 不开放实验创建、训练、冲突处理、晋级或回滚。
- `lottery.predict` 默认只返回当前 Champion；Shadow 比较仅出现在 CLI、报告和 Dashboard。
- 保留当前 `{data, meta}`、`model.name/version/scoreIsProbability`，新增 `modelId`、角色、数据快照和 artifact 字段采用向后兼容的可选字段。
- `remote` 模式继续可用，但 remote observation 不作为第二独立官方来源自动确认真值。
- 保留现有 analyze、`sync --all`、旧命名和 `NBCP_*` 薄兼容入口，不扩展第二套实现。

## 10. 阶段 5：Web 研究台

- `0.7.0` 使用私有 React/Vite 应用和小型 TypeScript 只读 API，静态产物随 CLI 发布到 `packages/cli/dist/web/`。
- 命令为 `lotterymcp ops serve-reports --host 127.0.0.1 --port 4317`，默认 `LOTTERYMCP_WEB_ACCESS_MODE=tunnel`。
- tunnel 模式不启用 Web 登录，适合 SSH 隧道；public 模式必须先执行 `ops auth init`，并放在 HTTPS 反向代理之后。
- 提供总览、历史日报、回测分析、数据质量和运行状态五个视图。
- 只读 API 包含 `/healthz`、`/readyz`、`/api/v1/session`、`/api/v1/overview`、`/api/v1/reports`、`/api/v1/reports/:runId` 和 `/api/v1/operations`。
- 实验、训练、冲突处理、晋级和回滚仍通过 CLI 执行。
- Python、数据库、raw、reports、models、web-state 和 secrets 不得进入 tarball。

## 11. 测试矩阵

### 11.1 数据和迁移

- 主源多页、403、空页、重复页、限频和整批回退。
- 非 P3、非法期号、非法日期、非法号码和同期间冲突。
- 单来源、双来源确认、remote/file 不构成伪双来源。
- dry-run 零写入、旁路迁移、事务故障、完整性失败和恢复。
- JSON 迁移、JSON/CSV 往返、raw 原子写入和孤立文件报告。

### 11.2 特征和实验

- 每个特征的 As-of 边界。
- 修改未来数据不影响历史折。
- 标准化器和模型只在训练折拟合。
- 实验 hash、固定种子和断点恢复稳定。
- 冻结区只解封一次，多次尝试均被审计。

### 11.3 模型

- 1000 状态完整、唯一和稳定排序。
- 组三/组六排列平均和 mixed 分配。
- 概率和、校准输入、manifest 和 artifact hash。
- Python/TypeScript JSON 与 ONNX 推理一致性。
- artifact 损坏、依赖缺失、stale 和 Champion 回退。

### 11.4 预测和 Shadow

- ID 稳定、旧 ID 迁移、事务和重复执行。
- pending、首次 observation、系统时间异常、replay 和 settlement revision。
- Shadow 300 期、晋级九项门槛、拒绝强制晋级和回滚历史。

### 11.5 发布

- Node 24 完整构建、测试、audit 和 pack。
- Node 20 执行四个发布包的安装、SQLite、MCP 和预测 smoke test。
- Windows、Linux、macOS 验证 `better-sqlite3`；ONNX 作为可选能力单独验证。
- Python 执行 `uv sync --frozen`、pytest、ruff、mypy 和导出一致性测试。
- 四个 tarball 不包含用户数据、Python 研究区或未冻结 artifact。

## 12. 发布与停止条件

| 版本 | 交付 | 阻断条件 |
|---|---|---|
| `0.4.0` | SQLite、全量同步、冲突、JSON 迁移 | 迁移不能稳定回滚或数据规模未知 |
| `0.5.0` | As-of 特征、实验注册、nested walk-forward | 未来数据泄漏或结果不可复现 |
| `0.6.0` | 服务器每日预测闭环、报告、企业微信通知、迁移 bundle、Docker | 单来源复盘被误当作 confirmed |
| `0.7.0` | 中文只读 Web 研究台、密码和 TOTP、审计 | public 模式未配置 HTTPS 或固定 EIP |
| `0.8.0` | Shadow、结算 revision 入库、晋级与回滚 | 无法证明首次 observation 前生成预测 |
| `0.9.0` | 五个基线、Python Challenger、artifact 推理 | 少于 2000 条 confirmed 数据时禁止正式晋级功能 |

每个版本必须通过：

```text
npm ci
npm run build
npm test
npm audit --omit=dev
npm pack --dry-run --workspace lotterymcp-core
npm pack --dry-run --workspace lotterymcp-server
npm pack --dry-run --workspace neuxnbcp
npm pack --dry-run --workspace lotterymcp
git diff --check
```

## 13. 最终完成定义

- 数据来源、观测、真值、冲突和修订可以完整追溯。
- 任意实验可以使用固定 snapshot、spec、commit 和 seed 在另一环境重建。
- 任何历史折均不读取未来数据。
- 正式预测使用冻结 Champion，失败时回退行为明确且可见。
- Challenger 只能通过预注册冻结评估和 300 期 Shadow 自动门槛晋级。
- 系统允许并清晰表达“未发现可重复预测优势”。
- 产品不提供自动投注、资金计划、收益承诺、多彩种、多用户或云端账号能力。
