# Lotterymcp

Lotterymcp 是一个排列3（P3）历史数据、MCP 接入和本地确定性分析工具。

它支持两种数据模式：

- `remote`：使用 NEUXSBOT 接口，需要有效 Token。
- `official`：读取本地公开开奖缓存，不调用 NEUXSBOT 受控接口。

预测核心使用固定、可解释的历史频率权重，并提供无未来数据泄漏的 walk-forward 回测。候选分数只是排序分，不是中奖概率，历史回测也不代表未来收益。

快速入口：

- [GitHub 快速开始](docs/github-quickstart.zh-CN.md)
- [MCP 接入说明](docs/mcp-usage.zh-CN.md)
- [分析问题示例](docs/prompt-templates.zh-CN.md)
- [排列3个人研究实验室产品方案](docs/p3-research-product-plan.zh-CN.md)

## 能做什么

- 读取排列3最新开奖、历史开奖、期号和摘要。
- 从中国体彩网公开接口同步排列3数据，失败时切换公开回退源。
- 从本地 JSON 文件导入排列3历史数据。
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
lotterymcp sync --source official --limit 500
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
lotterymcp sync --source official --limit 500
lotterymcp sync --source file --file history.json --limit 500
lotterymcp predict --periods 200 --tickets 10 --play mixed
```

旧版 `analyze pl3` 和 `analyze p3` 仍作为隐藏兼容入口，统一调用同一个 P3 预测核心。

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

导入接受记录数组或 `{ "records": [...] }`。记录按期号排序并去重；同一期号数据冲突、日期无效、号码不是三个 `0..9` 数字或彩种不是 `pl3` 时会拒绝整批导入。单次最多保留 1000 期，新数据与旧缓存合并后再按 `--limit` 截取。

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
- 默认缓存目录是 `.lotterymcp-data/`，预测账本为 `pl3-predictions.json`。
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
