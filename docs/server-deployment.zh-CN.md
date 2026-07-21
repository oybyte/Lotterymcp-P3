# Lotterymcp P3 私有服务器部署说明

本文面向个人研究服务器。第一阶段不要求公网域名，不开放 Web 到公网，通过 SSH 隧道访问中文只读研究台。

## 1. 服务器准备

推荐目录：

```bash
sudo mkdir -p /opt/lotterymcp-p3/{app,data,secrets,backups,web-state}
sudo chown -R lotterymcp:lotterymcp /opt/lotterymcp-p3
```

建议先把阿里云普通公网 IP 转为 EIP，再部署长期服务。保留 root 密钥恢复通道，验证普通 sudo 用户可登录后再收紧 SSH。

## 2. 本机创建数据迁移包

不要直接复制 `.lotterymcp-data/` 目录。SQLite 使用 WAL 时直接复制目录可能得到不一致数据。

```bash
lotterymcp data status
lotterymcp data migrate --dry-run
lotterymcp data migrate --apply
lotterymcp data bundle create --output transfer-bundle
lotterymcp data bundle verify --bundle transfer-bundle
```

把 `transfer-bundle/` 上传到服务器后执行：

```bash
cd /opt/lotterymcp-p3/app
node packages/cli/dist/index.js data bundle verify --bundle /path/to/transfer-bundle
node packages/cli/dist/index.js data bundle restore --bundle /path/to/transfer-bundle
```

## 3. Docker Compose 部署

在服务器 `/opt/lotterymcp-p3/app` 放置项目代码后：

```bash
cd /opt/lotterymcp-p3/app
docker compose up -d --build
docker compose ps
```

首次手动跑一遍：

```bash
docker compose exec worker node packages/cli/dist/index.js data status
docker compose exec worker node packages/cli/dist/index.js ops run-once --migrate
```

Compose 默认只发布宿主机 `127.0.0.1:4317`，公网无法直接访问报告服务。reports 容器只读挂载 P3 数据目录，Web 登录状态单独写入 `/opt/lotterymcp-p3/web-state`。

## 4. 远程访问研究台

本机打开 SSH 隧道：

```powershell
ssh -i C:\Users\lcz\.ssh\codex5.6.pem `
  -N -L 4317:127.0.0.1:4317 `
  -o ExitOnForwardFailure=yes `
  -o ServerAliveInterval=30 `
  lotterymcp@120.26.133.230
```

浏览器访问：

```text
http://127.0.0.1:4317/
```

研究台包含总览、历史日报、回测分析、数据质量和运行状态。页面只读取 `/api/v1/*`，不提供同步、预测、迁移或实验执行按钮。

## 5. 公网访问准备

只有确认阿里云公网 IP 已转为固定 EIP 后，才建议开放公网入口。公网模式必须先初始化 Web 认证：

```bash
cd /opt/lotterymcp-p3/app
export LOTTERYMCP_WEB_AUTH_PASSWORD='请换成足够长的访问口令'
docker compose --profile auth-admin run --rm auth-admin
```

命令会输出 TOTP Secret 和 10 个一次性恢复码。TOTP Secret 加入认证器应用，恢复码离线保存。认证配置写入 `/opt/lotterymcp-p3/secrets/web-auth.json`，会话、限流和审计写入 `/opt/lotterymcp-p3/web-state/web-auth.sqlite`。

随后设置：

```bash
export LOTTERYMCP_WEB_ACCESS_MODE=public
docker compose up -d reports
```

公网模式应放在 HTTPS 反向代理之后。没有固定 EIP 或 HTTPS 证书前，继续使用 SSH 隧道。

## 6. 企业微信通知

在服务器 shell 或 Compose `.env` 设置：

```bash
export LOTTERYMCP_WECHAT_WEBHOOK='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...'
docker compose up -d
```

Webhook、云厂商 AccessKey、备份加密密钥不要提交到 Git。

## 7. 数据策略

- 普通每日预测允许使用 `single_source` 数据，但复盘状态只能是 `provisional`。
- 双官方来源一致后，复盘才升级为 `confirmed`。
- 确认值与暂定值不一致时进入 `disputed`，需要人工核验。
- confirmatory 实验、Shadow 计数和模型晋级只允许使用 confirmed 数据。

## 8. 日常操作

查看状态：

```bash
docker compose exec worker node packages/cli/dist/index.js doctor
docker compose exec worker node packages/cli/dist/index.js ops reports
docker compose logs --tail=100 worker
```

手动跑一次预测：

```bash
docker compose exec worker node packages/cli/dist/index.js ops run-once --migrate
```

创建可下载备份包：

```bash
docker compose exec worker node packages/cli/dist/index.js data bundle create --output /backups/transfer-bundle
docker compose exec worker node packages/cli/dist/index.js data bundle verify --bundle /backups/transfer-bundle
```

OSS 加密备份建议在服务器侧用独立脚本读取 `/backups/transfer-bundle` 后上传。当前仓库不保存 OSS AccessKey 或加密口令。
