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

## Remote 模式

```bash
lotterymcp init --mode remote --api-base-url https://www.neuxsbot.com --token YOUR_TOKEN --periods 200
lotterymcp doctor
lotterymcp predict --periods 200 --tickets 10 --play mixed
```

## Official 模式

```bash
lotterymcp init --mode official --data-dir .lotterymcp-data --periods 200
lotterymcp sync --source official --limit 500
lotterymcp doctor
lotterymcp predict --periods 200 --tickets 10 --play mixed
```

official 模式不需要 Token。配置会保存到用户目录，MCP 与 CLI 都读取 `.lotterymcp-data/pl3.json`。

## 预测和回测

```bash
lotterymcp predict --periods 200 --tickets 10 --play mixed
```

候选分数不是中奖概率，历史回测不代表未来收益。

## MCP

完整配置见 [MCP 接入说明](mcp-usage.zh-CN.md)。接入后可调用最新开奖、历史、期号、摘要和预测五个工具。

更多示例见 [分析问题示例](prompt-templates.zh-CN.md)。
