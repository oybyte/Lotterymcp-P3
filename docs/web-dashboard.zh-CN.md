# Lotterymcp P3 Web 研究台

本文说明 `0.7.0` 新增的中文只读 Web 研究台。它面向个人远程查看，不替代 CLI、MCP 或实验命令。

## 定位

研究台只展示排列3数据、预测、复盘和运行状态：

- 总览：最新候选、数据可信状态和当前复盘。
- 历史日报：按北京时间日期和 `runId` 查看不可变日报。
- 回测分析：展示 walk-forward 历史模拟口径。
- 数据质量：展示 confirmed、single_source 和 conflict 状态。
- 运行状态：展示每日预测运行、系统事件和失败原因。

Web 页面不提供同步、预测、迁移、冲突处理、实验运行或模型晋级按钮。所有会改变数据或模型状态的操作继续通过 SSH 下的 CLI 执行。

## 访问模式

`LOTTERYMCP_WEB_ACCESS_MODE` 支持：

| 模式 | 默认 | 认证 | 推荐场景 |
|---|---|---|---|
| `tunnel` | 是 | 不启用 Web 登录 | SSH 隧道访问 `127.0.0.1:4317` |
| `public` | 否 | 口令 + TOTP | 固定 EIP、HTTPS 反向代理后公网访问 |

没有固定 EIP 或 HTTPS 证书前，继续使用 `tunnel`。

## 数据和状态目录

Compose 默认目录：

```text
/opt/lotterymcp-p3/data/pl3.sqlite
/opt/lotterymcp-p3/data/reports/
/opt/lotterymcp-p3/web-state/web-auth.sqlite
/opt/lotterymcp-p3/secrets/web-auth.json
```

- reports 容器只读挂载 `/data`。
- worker 容器读写 `/data`，但不挂载 Web 认证 secret。
- Web 会话、登录限流、TOTP 重放防护和认证审计写入 `/web-state/web-auth.sqlite`。
- Web 认证配置写入 `/secrets/web-auth.json`，只在 public 模式和 auth-admin 一次性任务中读取。

## 初始化公网认证

通过 SSH 在服务器执行：

```bash
cd /opt/lotterymcp-p3/app
export LOTTERYMCP_WEB_AUTH_PASSWORD='请换成足够长的访问口令'
docker compose --profile auth-admin run --rm auth-admin
```

命令会输出：

- TOTP Secret：加入认证器应用。
- 10 个一次性恢复码：离线保存。

公网模式使用 scrypt 口令哈希、HttpOnly SameSite Strict Cookie、8 小时闲置会话、24 小时绝对会话、登录限流、TOTP 重放防护和审计表。恢复码当前只生成和保存哈希，重置仍通过 SSH 重新执行 `ops auth init`。

## 日报存储

`ops run-once` 生成不可变日报：

```text
reports/daily/YYYY-MM-DD/RUN_ID/report.json
reports/daily/YYYY-MM-DD/RUN_ID/report.md
reports/daily/YYYY-MM-DD/RUN_ID/index.html
reports/index.json
reports/latest.json
```

`YYYY-MM-DD` 按北京时间分组。`report.json` 保留当时的 `snapshotSettlement`；Web API 会按 `predictionId` 动态读取 `pl3-predictions.json`，展示 `currentSettlement`。

## 只读 API

`ops serve-reports` 提供：

| 路由 | 说明 |
|---|---|
| `GET /healthz` | 进程健康检查 |
| `GET /readyz` | P3 SQLite 是否存在 |
| `GET /api/v1/session` | 当前访问模式和登录状态 |
| `POST /api/v1/auth/login` | public 模式登录 |
| `POST /api/v1/auth/logout` | public 模式退出 |
| `GET /api/v1/overview` | 最新预测、数据质量、账本和工具清单 |
| `GET /api/v1/reports?limit=20` | 日报索引 |
| `GET /api/v1/reports/:runId` | 单个不可变日报详情 |
| `GET /api/v1/operations?limit=20` | 运行记录和系统事件 |

除健康、ready、session 和登录退出外，public 模式下所有 API 都需要已登录会话。

## 本地验证

```bash
npm run build
npm test
node packages/cli/dist/index.js ops run-once --migrate --no-notify
node packages/cli/dist/index.js ops serve-reports --host 127.0.0.1 --port 4317
```

浏览器访问：

```text
http://127.0.0.1:4317/
```

公网验证必须先确认固定 EIP、HTTPS 反向代理和 Web 认证均已配置，再开放外部访问。
