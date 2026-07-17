# Lotterymcp GitHub 快速开始

Lotterymcp 当前只支持排列3（P3）。

## 安装

```bash
npx --yes lotterymcp@latest
```

长期使用：

```bash
npm i -g lotterymcp
```

## 使用公开数据

```bash
lotterymcp sync --source official --lottery pl3 --limit 500
```

设置 `LOTTERYMCP_DATA_MODE=official` 和可选的 `LOTTERYMCP_DATA_DIR` 后，MCP 与 CLI 都读取本地缓存。

## 预测和回测

```bash
lotterymcp predict --periods 200 --tickets 10 --play mixed
```

兼容命令：

```bash
lotterymcp analyze pl3 --periods 200 --tickets 10
```

候选分数不是中奖概率，历史回测不代表未来收益。

## MCP

完整配置见 [MCP 接入说明](mcp-usage.zh-CN.md)。接入后可调用最新开奖、历史、期号、摘要和预测五个工具。

更多示例见 [分析问题示例](prompt-templates.zh-CN.md)。
