# Lotterymcp P3 私有服务器部署说明

本文面向个人研究服务器。第一阶段不要求公网域名，不开放 Web 到公网，通过 SSH 隧道访问本地报告。

## 1. 服务器准备

推荐目录：

```bash
sudo mkdir -p /opt/lotterymcp-p3/{app,data,secrets,backups}
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

Compose 只发布宿主机 `127.0.0.1:4317`，公网无法直接访问报告服务。

## 4. 远程访问报告

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

## 5. 企业微信通知

在服务器 shell 或 Compose `.env` 设置：

```bash
export LOTTERYMCP_WECHAT_WEBHOOK='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...'
docker compose up -d
```

Webhook、云厂商 AccessKey、备份加密密钥不要提交到 Git。

## 6. 数据策略

- 普通每日预测允许使用 `single_source` 数据，但复盘状态只能是 `provisional`。
- 双官方来源一致后，复盘才升级为 `confirmed`。
- 确认值与暂定值不一致时进入 `disputed`，需要人工核验。
- confirmatory 实验、Shadow 计数和模型晋级只允许使用 confirmed 数据。

## 7. 日常操作

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
