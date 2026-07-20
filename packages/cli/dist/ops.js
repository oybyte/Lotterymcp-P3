import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { applyPl3SchemaMigration, backupPl3Database, createLotteryMcpClient, createPl3PredictionService, hasPl3Database, openPl3Store, previewPl3SchemaMigration, resolvePl3DatabasePath, restorePl3Database, writeJsonAtomically, } from 'lotterymcp-core';
import { syncOfficialPl3ToStore } from './official-sync.js';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const safeRelativePath = (value) => {
    const normalized = value.replaceAll('\\', '/').replace(/^\/+/, '');
    if (!normalized || normalized.includes('..'))
        throw new Error(`不安全的相对路径: ${value}`);
    return normalized;
};
const readFileHash = async (filePath) => sha256(await readFile(filePath));
const copyIfExists = async (source, target) => {
    if (!existsSync(source))
        return null;
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    return target;
};
const atomicWriteText = async (targetPath, text) => {
    await mkdir(path.dirname(targetPath), { recursive: true });
    const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, text, 'utf8');
    await rename(temporaryPath, targetPath);
};
export const createPl3DataBundle = async (input) => {
    const dataDir = path.resolve(input.dataDir);
    if (!hasPl3Database(dataDir))
        throw new Error('尚未启用 SQLite，无法创建迁移 bundle。');
    const outputDir = path.resolve(input.outputDir);
    await mkdir(outputDir, { recursive: true });
    const backup = await backupPl3Database(dataDir);
    const databaseTarget = path.join(outputDir, 'pl3.sqlite');
    await copyFile(backup.backupPath, databaseTarget);
    const ledgerSource = path.join(dataDir, 'pl3-predictions.json');
    const ledgerTarget = await copyIfExists(ledgerSource, path.join(outputDir, 'pl3-predictions.json'));
    const databaseStat = await stat(databaseTarget);
    const manifest = {
        version: 1,
        createdAt: new Date().toISOString(),
        dataDir,
        database: {
            file: 'pl3.sqlite',
            sha256: await readFileHash(databaseTarget),
            bytes: databaseStat.size,
        },
        ...(ledgerTarget ? {
            ledger: {
                file: 'pl3-predictions.json',
                sha256: await readFileHash(ledgerTarget),
                bytes: (await stat(ledgerTarget)).size,
            },
        } : {}),
    };
    await writeJsonAtomically(path.join(outputDir, 'manifest.json'), manifest);
    return { outputDir, manifest, sourceBackupPath: backup.backupPath };
};
export const verifyPl3DataBundle = async (bundleDir) => {
    const resolvedBundleDir = path.resolve(bundleDir);
    const manifestPath = path.join(resolvedBundleDir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.version !== 1)
        throw new Error(`不支持的 bundle 版本: ${manifest.version}`);
    const databasePath = path.join(resolvedBundleDir, safeRelativePath(manifest.database.file));
    const databaseHash = await readFileHash(databasePath);
    const databaseStat = await stat(databasePath);
    const checks = [{
            file: manifest.database.file,
            expectedSha256: manifest.database.sha256,
            actualSha256: databaseHash,
            expectedBytes: manifest.database.bytes,
            actualBytes: databaseStat.size,
            valid: databaseHash === manifest.database.sha256 && databaseStat.size === manifest.database.bytes,
        }];
    if (manifest.ledger) {
        const ledgerPath = path.join(resolvedBundleDir, safeRelativePath(manifest.ledger.file));
        const ledgerHash = await readFileHash(ledgerPath);
        const ledgerStat = await stat(ledgerPath);
        checks.push({
            file: manifest.ledger.file,
            expectedSha256: manifest.ledger.sha256,
            actualSha256: ledgerHash,
            expectedBytes: manifest.ledger.bytes,
            actualBytes: ledgerStat.size,
            valid: ledgerHash === manifest.ledger.sha256 && ledgerStat.size === manifest.ledger.bytes,
        });
    }
    return {
        bundleDir: resolvedBundleDir,
        manifest,
        valid: checks.every((item) => item.valid),
        checks,
    };
};
export const restorePl3DataBundle = async (input) => {
    const verification = await verifyPl3DataBundle(input.bundleDir);
    if (!verification.valid)
        throw new Error('bundle 校验失败，拒绝恢复。');
    const dataDir = path.resolve(input.dataDir);
    const databasePath = path.join(verification.bundleDir, verification.manifest.database.file);
    const restored = await restorePl3Database(dataDir, databasePath);
    let ledgerRestoredPath = null;
    if (verification.manifest.ledger) {
        const source = path.join(verification.bundleDir, verification.manifest.ledger.file);
        const target = path.join(dataDir, 'pl3-predictions.json');
        if (existsSync(target)) {
            await copyFile(target, path.join(dataDir, `pl3-predictions.${Date.now()}.json.bak`));
        }
        await copyFile(source, target);
        ledgerRestoredPath = target;
    }
    return { ...restored, ledgerRestoredPath, verification };
};
const renderMarkdownReport = (input) => [
    '# Lotterymcp P3 Daily Report',
    '',
    `Generated at: ${input.generatedAt}`,
    `After period: ${input.prediction.afterPeriod}`,
    `Prediction ID: ${input.prediction.predictionId}`,
    `Training records: ${input.prediction.training.recordCount}`,
    `Play/tickets: ${input.prediction.query.playType}/${input.prediction.query.tickets}`,
    `Settlement: ${input.prediction.settlement.status}`,
    '',
    '## Tickets',
    '',
    ...input.prediction.tickets.map((ticket) => `- ${ticket.rank}. ${ticket.playType} ${ticket.display} score=${ticket.score}`),
    '',
    '## Backtest',
    '',
    input.prediction.backtest.status === 'complete'
        ? `Cost ${input.prediction.backtest.totalCost}, return ${input.prediction.backtest.totalReturn}, ROI ${input.prediction.backtest.roi}.`
        : 'Insufficient data for backtest.',
    input.prediction.payouts.note,
    '',
    ...(input.sync ? [
        '## Sync',
        '',
        `Provider: ${input.sync.provider}`,
        `Records: ${input.sync.records.length}`,
        `Confirmed/single-source/conflict: ${input.sync.confirmedRecords}/${input.sync.singleSourceRecords}/${input.sync.conflictRecords}`,
    ] : []),
    '',
].join('\n');
const renderHtmlReport = (markdown) => {
    const escaped = markdown
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lotterymcp P3 Daily Report</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #172026; background: #f6f7f9; }
    main { max-width: 920px; margin: 0 auto; background: #fff; border: 1px solid #d7dde5; border-radius: 8px; padding: 24px; }
    pre { white-space: pre-wrap; line-height: 1.55; font-size: 14px; }
  </style>
</head>
<body><main><pre>${escaped}</pre></main></body>
</html>
`;
};
export const writePl3DailyReport = async (input) => {
    const generatedAt = new Date().toISOString();
    const day = generatedAt.slice(0, 10);
    const reportDir = path.join(path.resolve(input.dataDir), 'reports', 'daily', day);
    const markdown = renderMarkdownReport({ generatedAt, prediction: input.prediction, sync: input.sync });
    const payload = {
        generatedAt,
        prediction: input.prediction,
        sync: input.sync ? {
            provider: input.sync.provider,
            records: input.sync.records.length,
            confirmedRecords: input.sync.confirmedRecords,
            singleSourceRecords: input.sync.singleSourceRecords,
            conflictRecords: input.sync.conflictRecords,
            warnings: input.sync.warnings,
        } : null,
    };
    await mkdir(reportDir, { recursive: true });
    await atomicWriteText(path.join(reportDir, 'report.md'), markdown);
    await writeJsonAtomically(path.join(reportDir, 'report.json'), payload);
    await atomicWriteText(path.join(reportDir, 'index.html'), renderHtmlReport(markdown));
    await atomicWriteText(path.join(path.resolve(input.dataDir), 'reports', 'index.html'), renderHtmlReport(markdown));
    const reportHash = sha256(JSON.stringify(payload));
    return { reportDir, reportPath: path.join(reportDir, 'report.json'), markdownPath: path.join(reportDir, 'report.md'), htmlPath: path.join(reportDir, 'index.html'), reportHash };
};
const sendEnterpriseWechat = async (input) => {
    const webhookUrl = input.webhookUrl || process.env.LOTTERYMCP_WECHAT_WEBHOOK || process.env.WECOM_BOT_WEBHOOK;
    if (!webhookUrl)
        return { skipped: true, channel: 'enterprise-wechat' };
    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msgtype: 'markdown', markdown: { content: input.text } }),
    });
    const rawText = await response.text();
    const ok = response.ok && /"errcode"\s*:\s*0/.test(rawText);
    if (hasPl3Database(input.dataDir)) {
        const store = openPl3Store({ dataDir: input.dataDir });
        try {
            if (store.getSchemaVersion() >= 3) {
                store.recordNotificationDelivery({
                    channel: 'enterprise-wechat',
                    dedupeKey: input.dedupeKey,
                    status: ok ? 'success' : 'failed',
                    target: new URL(webhookUrl).origin,
                    messageHash: sha256(input.text),
                    errorMessage: ok ? null : rawText.slice(0, 500),
                });
            }
        }
        finally {
            store.close();
        }
    }
    if (!ok)
        throw new Error(`企业微信通知失败: HTTP ${response.status} ${rawText.slice(0, 200)}`);
    return { skipped: false, channel: 'enterprise-wechat' };
};
export const runPl3DailyOnce = async (input) => {
    const dataDir = path.resolve(String(input.config.dataDir || '.lotterymcp-data'));
    const runId = `p3-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    let syncResult;
    let storeOpened = false;
    if (input.sync !== false) {
        syncResult = await syncOfficialPl3ToStore({
            dataDir,
            limit: Math.max(input.periods || 500, 500),
            full: false,
            provider: 'auto',
            resume: true,
        });
    }
    if (hasPl3Database(dataDir)) {
        const preview = previewPl3SchemaMigration(dataDir);
        if (preview.migrationRequired) {
            if (!input.migrate) {
                throw new Error(`每日任务需要 schema ${preview.targetVersion}，请先运行 data migrate --apply，或本命令追加 --migrate。`);
            }
            await applyPl3SchemaMigration(dataDir);
        }
        const store = openPl3Store({ dataDir });
        try {
            storeOpened = true;
            store.recordOnlinePredictionRun({
                runId,
                status: 'running',
                dataMode: input.config.dataMode || 'official',
            });
        }
        finally {
            store.close();
        }
    }
    try {
        const client = createLotteryMcpClient({
            apiBaseUrl: input.config.apiBaseUrl,
            token: input.config.token,
            defaultPeriods: input.config.defaultPeriods,
            dataMode: input.config.dataMode || 'official',
            dataDir,
        });
        const service = createPl3PredictionService(client, {
            dataDir,
            defaultPeriods: input.periods || 200,
        });
        const envelope = await service.predict({
            periods: input.periods,
            tickets: input.tickets,
            playType: input.playType,
        });
        const report = await writePl3DailyReport({
            dataDir,
            prediction: envelope.data,
            sync: syncResult,
        });
        if (storeOpened) {
            const store = openPl3Store({ dataDir });
            try {
                store.recordOnlinePredictionRun({
                    runId,
                    predictionId: envelope.data.predictionId,
                    status: 'success',
                    dataMode: input.config.dataMode || 'official',
                    afterPeriod: envelope.data.afterPeriod,
                    targetPeriod: envelope.data.settlement.targetPeriod || null,
                    reportPath: path.relative(dataDir, report.reportPath).replaceAll('\\', '/'),
                    reportHash: report.reportHash,
                    completedAt: new Date().toISOString(),
                });
                store.recordOperationalEvent({
                    level: 'info',
                    eventType: 'daily-run-success',
                    message: `每日排列3预测完成，截止期号 ${envelope.data.afterPeriod}。`,
                    details: { predictionId: envelope.data.predictionId, reportPath: report.reportPath },
                });
            }
            finally {
                store.close();
            }
        }
        const notification = input.notify === false ? { skipped: true } : await sendEnterpriseWechat({
            dataDir,
            dedupeKey: envelope.data.predictionId,
            text: [
                '### Lotterymcp P3 每日预测完成',
                `> 截止期号: ${envelope.data.afterPeriod}`,
                `> 预测ID: ${envelope.data.predictionId}`,
                `> 注数: ${envelope.data.query.tickets}`,
                `> 报告: ${report.reportPath}`,
            ].join('\n'),
        });
        return { runId, prediction: envelope.data, report, sync: syncResult, notification };
    }
    catch (error) {
        if (storeOpened) {
            const store = openPl3Store({ dataDir });
            try {
                store.recordOnlinePredictionRun({
                    runId,
                    status: 'failed',
                    dataMode: input.config.dataMode || 'official',
                    errorMessage: error instanceof Error ? error.message : String(error),
                    completedAt: new Date().toISOString(),
                });
                store.recordOperationalEvent({
                    level: 'error',
                    eventType: 'daily-run-failed',
                    message: error instanceof Error ? error.message : String(error),
                });
            }
            finally {
                store.close();
            }
        }
        throw error;
    }
};
const contentTypeFor = (filePath) => {
    if (filePath.endsWith('.html'))
        return 'text/html; charset=utf-8';
    if (filePath.endsWith('.json'))
        return 'application/json; charset=utf-8';
    if (filePath.endsWith('.md'))
        return 'text/markdown; charset=utf-8';
    if (filePath.endsWith('.svg'))
        return 'image/svg+xml';
    return 'text/plain; charset=utf-8';
};
export const servePl3Reports = async (input) => {
    const reportsDir = path.join(path.resolve(input.dataDir), 'reports');
    await mkdir(reportsDir, { recursive: true });
    const host = input.host || '127.0.0.1';
    const port = input.port || 4317;
    const server = http.createServer(async (request, response) => {
        try {
            const requested = decodeURIComponent(new URL(request.url || '/', `http://${host}`).pathname);
            const relative = safeRelativePath(requested === '/' ? 'index.html' : requested);
            const filePath = path.resolve(reportsDir, relative);
            if (!filePath.startsWith(path.resolve(reportsDir)))
                throw new Error('越界路径');
            const body = await readFile(filePath);
            response.writeHead(200, { 'content-type': contentTypeFor(filePath) });
            response.end(body);
        }
        catch {
            response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            response.end('Not found');
        }
    });
    await new Promise((resolve) => server.listen(port, host, resolve));
    return { server, url: `http://${host}:${port}/`, reportsDir };
};
export const listReportDays = async (dataDir) => {
    const dailyDir = path.join(path.resolve(dataDir), 'reports', 'daily');
    if (!existsSync(dailyDir))
        return [];
    return (await readdir(dailyDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
        .reverse();
};
export const getPl3DatabasePathForOps = (dataDir) => resolvePl3DatabasePath(dataDir);
