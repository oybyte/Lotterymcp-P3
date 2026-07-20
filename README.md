# Lotterymcp

Lotterymcp 是一个排列3（P3）历史数据、MCP 接入和本地确定性分析工具。

它支持两种数据模式：

- `remote`：使用 NEUXSBOT 接口，需要有效 Token。
- `official`：读取本地公开开奖档案，不调用 NEUXSBOT 受控接口。

预测核心使用固定、可解释的历史频率权重，并提供无未来数据泄漏的 walk-forward 回测。候选分数只是排序分，不是中奖概率，历史回测也不代表未来收益。

快速入口：

- [GitHub 快速开始](docs/github-quickstart.zh-CN.md)
- [MCP 接入说明](docs/mcp-usage.zh-CN.md)
- [分析问题示例](docs/prompt-templates.zh-CN.md)
- [排列3个人研究实验室产品方案](docs/p3-research-product-plan.zh-CN.md)

## 能做什么

- 读取排列3最新开奖、历史开奖、期号和摘要。
- 从中国体彩网公开接口同步排列3数据，失败时切换公开回退源。
- 从公开来源同步全量排列3历史，并保留压缩原始响应。
- 从 JSON/CSV 文件导入排列3历史数据。
- 使用 SQLite 保存来源观测、冲突、修订和不可变数据快照。
- 使用断点续传、raw 证据、备份恢复和引用感知 GC 维护本地数据档案。
- 生成不可变 As-of 特征，并注册可恢复、可审计的 nested walk-forward 实验。
- 按直选、组三、组六或混合玩法生成候选排序。
- 对实际候选注数执行 walk-forward 回测，输出成本、名义奖金和历史 ROI。
- 保存预测账本，并在下一期开奖进入缓存后自动结算。

## 安装

```bash
npx --yes lotterymcp@latest --help
npm i -g lotterymcp
```

## Remote 模式

```bash
lotterymcp init --mode remote --api-base-url https://www.neuxsbot.com --token YOUR_TOKEN --periods 200
lotterymcp doctor
lotterymcp predict --periods 200 --tickets 10 --play mixed
```

remote 模式使用用户自己的 NEUXSBOT Token 读取排列3数据。

## Official 模式

```bash
lotterymcp init --mode official --data-dir .lotterymcp-data --periods 200
lotterymcp data sync --full
lotterymcp data status
lotterymcp doctor
lotterymcp predict --periods 200 --tickets 10 --play mixed
lotterymcp serve
```

official 模式不要求 Token，只读取公开同步或用户导入的本地排列3数据。

## 常用命令

```bash
lotterymcp init
lotterymcp doctor
lotterymcp serve
lotterymcp data sync --full
lotterymcp data import --file history.json
lotterymcp data import --file history.csv
lotterymcp data conflicts
lotterymcp data snapshot create --last 2000
lotterymcp data gc --dry-run
lotterymcp data backup
lotterymcp predict --periods 200 --tickets 10 --play mixed
```

旧版 `analyze pl3` 和 `analyze p3` 仍作为隐藏兼容入口，统一调用同一个 P3 预测核心。

旧版 `sync --source official|file` 继续写入兼容 JSON 缓存。已有 `pl3.json` 的用户先执行显式迁移：

```bash
lotterymcp data migrate --dry-run
lotterymcp data migrate --apply
```

迁移会创建旁路数据库并完成完整性检查，成功后原子切换；原 JSON 和预测账本不会删除，也不会启用 SQLite/JSON 双写。

## MCP 配置

remote 模式：

```json
{
  "mcpServers": {
    "lotterymcp": {
      "command": "npx",
      "args": ["-y", "lotterymcp@latest", "serve"],
      "env": {
        "NEUXSBOT_API_BASE_URL": "https://www.neuxsbot.com",
        "NEUXSBOT_TOKEN": "your-real-token"
      }
    }
  }
}
```

official 模式：

```json
{
  "mcpServers": {
    "lotterymcp": {
      "command": "npx",
      "args": ["-y", "lotterymcp@latest", "serve"],
      "env": {
        "LOTTERYMCP_DATA_MODE": "official",
        "LOTTERYMCP_DATA_DIR": ".lotterymcp-data"
      }
    }
  }
}
```

official 模式只读取用户本地同步或导入的数据，不绕过 NEUXSBOT 授权。

## P3 文件导入

推荐命令：

```bash
lotterymcp data import --file history.json
lotterymcp data import --file history.csv
lotterymcp data export --format json --output exports/pl3.json
```

```json
{
  "records": [{
    "lotteryType": "pl3",
    "period": "2026177",
    "drawDate": "2026-07-10",
    "numbers": "8,1,2",
    "numbersList": [8, 1, 2]
  }]
}
```

JSON 导入接受记录数组或 `{ "records": [...] }`，CSV 使用 `lotteryType,period,drawDate,numbers` 表头。日期无效、号码不是三个 `0..9` 数字或彩种不是 `pl3` 时拒绝导入；同一期号出现不同日期或号码时保存为 `conflict`，不会进入预测和研究快照。SQLite 档案不受预测窗口 1000 期限制。

两个独立官方来源完全一致时状态为 `confirmed`；单个来源、remote 或普通文件导入默认为 `single_source`。NEUXSBOT remote 和文件导入不会被错误地当作第二官方来源。

## 数据档案与冲突隔离

全量同步逐页保存 gzip raw 响应和 checkpoint。默认自动恢复 7 天内参数一致的任务，也可以显式控制：

```bash
lotterymcp data sync --full --reconcile --resume
lotterymcp data sync --full --restart
lotterymcp data conflicts --type numbers --from-period 2000000 --json
lotterymcp data resolve --period PERIOD --observation-id ID --reason "人工核验" --evidence-url https://example.com/evidence
```

主来源整批失败时不会提交半批 draws，回退源会从第一页重新开始。人工解决冲突只能选择已保存的 observation；第三份证据必须先通过 `data import` 形成 observation。

截至 2026-07-17 的真实数据核验保留 23 个历史冲突，不自动信任任一来源。最近 2000 期无冲突，可以创建 confirmed snapshot；全历史 snapshot 在冲突解决前会返回全部冲突期号并拒绝创建。

```bash
lotterymcp data snapshot create --last 2000
lotterymcp data snapshot list
lotterymcp data snapshot inspect SNAPSHOT_ID
lotterymcp data snapshot verify SNAPSHOT_ID
lotterymcp data gc --dry-run
lotterymcp data gc --apply
lotterymcp data backup
lotterymcp data restore --backup backups/pl3.TIMESTAMP.sqlite
```

snapshot 默认只接受 `confirmed` 数据。`--allow-single-source` 仅用于明确的探索研究，不可用于正式实验。GC 只删除 `raw/` 中超过 7 天、无数据库/manifest/活动 checkpoint 引用且与 dry-run 扫描完全一致的普通文件。

## 可复现实验

实验功能使用显式 M002。程序不会在 `doctor`、`serve` 或普通同步时隐式迁移数据库：

```bash
lotterymcp data migrate --dry-run
lotterymcp data migrate --apply
lotterymcp data snapshot create --last 2000
```

将 snapshot ID 写入 [实验 spec 示例](examples/pl3-experiment-spec.json)，然后运行：

```bash
lotterymcp experiment create examples/pl3-experiment-spec.json
lotterymcp experiment list
lotterymcp experiment inspect EXPERIMENT_ID
lotterymcp experiment run EXPERIMENT_ID
lotterymcp experiment report EXPERIMENT_ID
lotterymcp experiment evaluate EXPERIMENT_ID --frozen --confirm
```

特征只读取 dataset snapshot 中 `afterPeriod` 及之前的数据。参数在每个外层折内部选择，标准化主指标固定为 `normalizedRank.mean`；ROI 不参与选参或晋级。冻结区在显式评估前不进入报告，每个 confirmatory experiment 只允许尝试一次冻结评估。相同 spec、snapshot、代码标识和 seed 产生相同实验 ID 与报告哈希。

当前 evaluator 包含 `uniform-theory`、`random-monte-carlo` 和 `weighted-frequency-v1`。它们用于建立研究基线和验证流程，不构成开奖可预测性或收益承诺。

## MCP 工具

- `lottery.latest`
- `lottery.history`
- `lottery.periods`
- `lottery.summary`
- `lottery.predict`

`lotteryType` 可以省略，默认使用 `pl3`；其他彩种会返回 `LOTTERYMCP_ONLY_PL3_SUPPORTED`。

## 终端效果

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/terminal-help.svg" alt="Lotterymcp P3 中文菜单" /></td>
    <td width="50%"><img src="docs/screenshots/terminal-pl3.svg" alt="排列3预测与回测输出" /></td>
  </tr>
</table>

## 分析问题示例

- 读取最近 200 期排列3，生成 10 注 mixed 候选并展示 walk-forward 回测。
- 只生成 8 注直选候选，说明每个候选的排序分构成。
- 对比最近 100 期和 300 期的排列3位置频率、和值、跨度和奇偶结构。
- 查看预测账本中的待结算记录和已经结算的历史结果。

## 配置说明

- `NEUXSBOT_TOKEN` 环境变量优先于本地配置文件。多人机器和 CI 建议使用环境变量。
- 默认数据目录是 `.lotterymcp-data/`，SQLite 档案为 `pl3.sqlite`，原始响应保存在 `raw/`。预测账本暂时继续使用 `pl3-predictions.json`，将在 Shadow 阶段迁入数据库。
- 默认单注成本为 2 元，名义奖金为直选 1040、组三 346、组六 173；可分别通过 `LOTTERYMCP_PL3_STAKE`、`LOTTERYMCP_PL3_PAYOUT_DIRECT`、`LOTTERYMCP_PL3_PAYOUT_GROUP3`、`LOTTERYMCP_PL3_PAYOUT_GROUP6` 覆盖。
- 奖金、回报和 ROI 都是按配置计算的历史模拟，不构成收益承诺。

## 开发验证

```bash
npm ci
npm test
npm run docs:screenshots:check
npm audit --omit=dev
```

项目使用 [MIT License](LICENSE)。
