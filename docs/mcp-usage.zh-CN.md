# MCP 接入说明

Lotterymcp 只提供排列3（`pl3`）数据和确定性预测回测。

## Remote 模式

在 [NEUXSBOT 官网](https://www.neuxsbot.com) 登录后，从[个人中心](https://www.neuxsbot.com/member)取得自己的 MCP 密钥：

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

环境变量优先于 `~/.neuxsbot/cp.config.json`。CI 或多人机器建议只通过环境变量注入 Token。

## Official 模式

先同步排列3公开数据：

```bash
lotterymcp init --mode official --data-dir .lotterymcp-data --periods 200
lotterymcp sync --source official --limit 500
lotterymcp doctor
```

如果公开网站限制自动请求，可导入规范化 JSON：

```bash
lotterymcp sync --source file --file history.json --limit 500
```

导入文件可以是记录数组，也可以是以下结构：

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

- `lotteryType` 可省略，显式值只能是 `pl3`。
- `period` 必须是 5 到 12 位数字；`drawDate` 必须是有效的 `YYYY-MM-DD` 日期。
- `numbers` 或 `numbersList` 必须包含三个 `0..9` 整数。
- 同一期号完全相同的数据会去重；号码或日期冲突会拒绝整批导入。
- 新旧缓存先合并再截取最新 `--limit` 期，最大值为 1000。

然后使用：

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

official 模式不需要 Token，不调用或破解 NEUXSBOT 受控接口。

## 工具

- `lottery.latest`：最新开奖。
- `lottery.history`：历史开奖和日期筛选。
- `lottery.periods`：历史期号。
- `lottery.summary`：缓存摘要。
- `lottery.predict`：候选排序和 walk-forward 回测。

五个工具共同接受可选的 `lotteryType: "pl3"`；省略时默认使用 `pl3`。MCP Schema 会直接拒绝其他值。

`lottery.predict` 其他参数：

- `periods`：`100..1000`，默认 200。
- `tickets`：`1..100`，默认 10。
- `playType`：`direct`、`group3`、`group6` 或 `mixed`。

预测 score 只是排序分，不是概率。奖金和 ROI 是按配置计算的历史模拟。

## 排查

```bash
lotterymcp doctor
```

doctor 会检查数据模式、接口连通性、缓存记录数、最新期号、缓存更新时间和预测账本状态。

- `401/403`：remote Token 无效或权限不足。
- `429`：降低调用频率或期数后重试。
- `LOTTERYMCP_OFFICIAL_CACHE_MISSING`：先同步或导入 `pl3.json`。
- `LOTTERYMCP_PL3_INSUFFICIENT_DATA`：预测至少需要 100 条有效记录。
