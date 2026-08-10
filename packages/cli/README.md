# Lotterymcp CLI

`neuxnbcp` 是 `lotterymcp` 的实际 CLI 实现包，只支持排列3（`pl3`）。

```bash
npx --yes lotterymcp@latest
lotterymcp doctor
lotterymcp init --mode official --data-dir .lotterymcp-data --periods 200
lotterymcp data sync --full
lotterymcp data import --file history.json
lotterymcp data status
lotterymcp data sla
lotterymcp data snapshot create --last 2000
lotterymcp data bundle create --output transfer-bundle
lotterymcp data migrate --dry-run
lotterymcp data migrate --apply
lotterymcp experiment create spec.json
lotterymcp experiment run EXPERIMENT_ID
lotterymcp predict --periods 200 --tickets 10 --play mixed
lotterymcp ops run-once --migrate
lotterymcp ops serve-reports --host 127.0.0.1 --port 4317
lotterymcp ops auth init --password '请换成足够长的访问口令'
lotterymcp serve
```

`predict` 使用内置 TypeScript P3 核心。旧版 `analyze pl3` 和 `analyze p3` 仅作为隐藏兼容入口。

remote 模式继续使用 `NEUXSBOT_API_BASE_URL` 和 `NEUXSBOT_TOKEN`。设置 `LOTTERYMCP_DATA_MODE=official` 后优先读取 `.lotterymcp-data/pl3.sqlite`，不调用 NEUXSBOT 受控接口。

已有 `pl3.json` 时使用 `lotterymcp data migrate --dry-run` 和 `--apply` 显式迁移。SQLite M002/M003 也通过同一命令显式执行，提供不可变 As-of 特征、nested walk-forward 实验和每日运维记录。旧 `sync --source official|file` 保留为 JSON 兼容入口。

`data bundle create/verify/restore` 用于在本机和服务器之间迁移数据，内部使用 SQLite 在线备份，不直接复制 WAL 数据目录。

`ops run-once` 会同步 P3 数据、结算、预测、生成不可变日报并可发送企业微信通知；`ops serve-reports` 提供中文只读研究台，默认适合 SSH 隧道访问。公网模式需先用 `ops auth init` 初始化口令、TOTP 和恢复码，并放在 HTTPS 反向代理之后。

正式实验只接受 confirmed dataset snapshot。冻结区必须通过 `experiment evaluate EXPERIMENT_ID --frozen --confirm` 显式解封，且每个实验只允许尝试一次。

候选分数不是中奖概率，walk-forward 回测和名义 ROI 不代表未来收益。单来源开奖只产生暂定复盘；双官方来源一致后才视为确认。`data sla` 输出每条预测与目标期首次本地 observation 的时间证据，仅证明预测早于本地首次观测，不构成第三方开奖前时间戳证明。
