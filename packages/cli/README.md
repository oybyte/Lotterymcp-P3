# Lotterymcp CLI

`neuxnbcp` 是 `lotterymcp` 的实际 CLI 实现包，只支持排列3（`pl3`）。

```bash
npx --yes lotterymcp@latest
lotterymcp doctor
lotterymcp init --mode official --data-dir .lotterymcp-data --periods 200
lotterymcp data sync --full
lotterymcp data import --file history.json
lotterymcp data status
lotterymcp data snapshot create --last 2000
lotterymcp data migrate --dry-run
lotterymcp data migrate --apply
lotterymcp experiment create spec.json
lotterymcp experiment run EXPERIMENT_ID
lotterymcp predict --periods 200 --tickets 10 --play mixed
lotterymcp serve
```

`predict` 使用内置 TypeScript P3 核心。旧版 `analyze pl3` 和 `analyze p3` 仅作为隐藏兼容入口。

remote 模式继续使用 `NEUXSBOT_API_BASE_URL` 和 `NEUXSBOT_TOKEN`。设置 `LOTTERYMCP_DATA_MODE=official` 后优先读取 `.lotterymcp-data/pl3.sqlite`，不调用 NEUXSBOT 受控接口。

已有 `pl3.json` 时使用 `lotterymcp data migrate --dry-run` 和 `--apply` 显式迁移。SQLite M002 也通过同一命令显式执行，提供不可变 As-of 特征和 nested walk-forward 实验。旧 `sync --source official|file` 保留为 JSON 兼容入口。

正式实验只接受 confirmed dataset snapshot。冻结区必须通过 `experiment evaluate EXPERIMENT_ID --frozen --confirm` 显式解封，且每个实验只允许尝试一次。

候选分数不是中奖概率，walk-forward 回测和名义 ROI 不代表未来收益。
