# Lotterymcp CLI

`neuxnbcp` 是 `lotterymcp` 的实际 CLI 实现包，只支持排列3（`pl3`）。

```bash
npx --yes lotterymcp@latest
lotterymcp doctor
lotterymcp sync --source official --lottery pl3 --limit 500
lotterymcp sync --source file --file history.json --limit 500
lotterymcp predict --periods 200 --tickets 10 --play mixed
lotterymcp serve
```

`predict` 使用内置 TypeScript 核心，不需要 Python。`analyze pl3`、`analyze p3` 和 `analyze pl3_markov` 为兼容别名。

remote 模式继续使用 `NEUXSBOT_API_BASE_URL` 和 `NEUXSBOT_TOKEN`。设置 `LOTTERYMCP_DATA_MODE=official` 后改为读取 `.lotterymcp-data/pl3.json`，不调用 NEUXSBOT 受控接口。

候选分数不是中奖概率，walk-forward 回测和名义 ROI 不代表未来收益。
