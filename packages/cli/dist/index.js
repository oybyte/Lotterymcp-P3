#!/usr/bin/env node
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { McpApiError, applyLegacyPl3Migration, applyPl3SchemaMigration, backupPl3Database, createLotteryMcpClient, createPl3Experiment, createPl3PredictionService, evaluatePl3ExperimentFrozen, formatMcpApiError, generatePl3ExperimentReport, hasPl3Database, normalizePl3Records, openPl3Store, previewLegacyPl3Migration, previewPl3SchemaMigration, inspectPl3Experiment, PL3_DATABASE_LATEST_SCHEMA_VERSION, resolvePl3DatabasePath, restorePl3Database, runPl3Experiment, writeJsonAtomically, } from 'lotterymcp-core';
import { MCP_SERVER_TOOLS, MCP_SERVER_TRANSPORT, startLotteryMcpStdioServer } from 'lotterymcp-server';
import { DEFAULT_API_BASE_URL, DEFAULT_PERIODS, getConfigPath, maskToken, renderMcpConfigSnippet, resolveConfig, saveLocalConfig, validateConfig, } from './config.js';
import { renderNbcpBanner, shouldShowBanner } from './banner.js';
import { exportPl3Store, importPl3FileToStore } from './data-files.js';
import { applyPl3RawGcPlan, createPl3RawGcPlan } from './data-gc.js';
import { syncOfficialFile, syncOfficialPl3, syncOfficialPl3ToStore } from './official-sync.js';
const WEBSITE_URL = 'https://www.neuxsbot.com';
const MEMBER_CENTER_URL = 'https://www.neuxsbot.com/member';
const TOKEN_PAGE_URL = 'https://www.neuxsbot.com/member/api-keys';
const MENU_TEXT = `请选择操作：
  1. 注册/登录并获取 Token
  2. 配置数据模式和默认期数
  3. 生成 MCP 配置片段
  4. 检查当前配置和网站连通性
  5. 启动 MCP 服务
  6. 生成排列3预测与回测
  7. 同步官方公开开奖数据
  0. 退出`;
const HELP_TEXT = `临时打开菜单:
  npx --yes lotterymcp@latest

全局安装:
  npm i -g lotterymcp

使用方法:
  1. remote 模式配置官网 Token；official 模式同步公开排列3数据
  2. 运行 init 保存数据模式和默认期数
  3. 运行 doctor 检查排列3数据状态
  4. 复制 MCP 配置片段到支持 MCP 的 AI 工具
  5. 使用 predict 生成排列3候选与回测

可用命令:
  serve            启动 MCP stdio 服务
  init             生成本地配置文件
  doctor           检查当前配置和网站连通性
  login            打开官网账号页并获取 Token
  predict          生成排列3候选与 walk-forward 回测
  analyze          predict 的兼容别名
  sync             同步官方公开开奖数据到本地缓存
  data             管理 SQLite 数据档案、迁移和冲突
  experiment       注册和运行可复现实验

说明:
  predict/analyze 共用内置 TypeScript P3 预测核心。
  sync 命令只访问公开开奖数据源，不调用 NEUXSBOT 受控接口。

当前版本:
  官网: www.neuxsbot.com
  传输方式: ${MCP_SERVER_TRANSPORT}
  彩种: 排列3(pl3)
  工具列表: ${MCP_SERVER_TOOLS.join(', ')}
`;
const TOKEN_TEXT = `注册/登录并获取 Token:
  官网首页: ${WEBSITE_URL}
  官网账号页: ${MEMBER_CENTER_URL}
  密钥页: ${TOKEN_PAGE_URL}

说明:
  1. 登录后进入官网账号页，直接复制 MCP Token。
  2. Token 用于识别会员权限、调用次数、升级状态。
  3. 当前版本仅支持排列3(pl3)数据。
`;
const renderConfigSummary = (config) => `当前配置:
  API_BASE_URL: ${config.apiBaseUrl || '(未设置)'}
  TOKEN: ${config.dataMode === 'official' ? '(official 模式不使用)' : maskToken(config.token || '')}
  DEFAULT_PERIODS: ${config.defaultPeriods || '(未设置)'}
  DATA_MODE: ${config.dataMode || 'remote'}
  DATA_DIR: ${config.dataDir || '.lotterymcp-data'}
`;
const renderAnalyzeUsage = () => {
    return `用法:
  lotterymcp predict --periods 200 --tickets 10 --play mixed

玩法: direct, group3, group6, mixed
`;
};
const renderInitUsage = () => `用法:
  lotterymcp init --mode official --data-dir .lotterymcp-data --periods 200
  lotterymcp init --mode remote --api-base-url https://www.neuxsbot.com --token TOKEN --periods 200

模式: remote, official
`;
const renderDoctorUsage = () => `用法:
  lotterymcp doctor
`;
const renderExperimentUsage = () => `用法:
  lotterymcp experiment create spec.json [--json]
  lotterymcp experiment list [--json]
  lotterymcp experiment inspect EXPERIMENT_ID [--json]
  lotterymcp experiment run EXPERIMENT_ID [--json]
  lotterymcp experiment resume EXPERIMENT_ID [--json]
  lotterymcp experiment report EXPERIMENT_ID [--json]
  lotterymcp experiment evaluate EXPERIMENT_ID --frozen --confirm [--json]

说明:
  实验只读取 immutable dataset snapshot；冻结区只能显式确认后评估一次。
`;
const isPositiveInteger = (value) => /^\d+$/.test(value.trim());
const buildNextConfig = (currentConfig, input) => ({
    apiBaseUrl: input.apiBaseUrl?.trim() || currentConfig.apiBaseUrl || DEFAULT_API_BASE_URL,
    token: input.dataMode === 'official' ? '' : input.token?.trim() || currentConfig.token || '',
    defaultPeriods: input.defaultPeriods?.trim() || currentConfig.defaultPeriods || DEFAULT_PERIODS,
    dataMode: input.dataMode || currentConfig.dataMode || 'remote',
    dataDir: input.dataDir?.trim() || currentConfig.dataDir || '.lotterymcp-data',
});
const toResolvedConfig = (config) => ({
    apiBaseUrl: String(config.apiBaseUrl || '').trim(),
    token: String(config.token || '').trim(),
    defaultPeriods: String(config.defaultPeriods || '').trim(),
    dataMode: config.dataMode === 'official' ? 'official' : 'remote',
    dataDir: String(config.dataDir || '.lotterymcp-data').trim(),
});
const persistConfig = async (nextConfig) => {
    if ((nextConfig.dataMode || 'remote') !== 'official' && !nextConfig.token.trim()) {
        console.error('Token 不能为空。');
        return 1;
    }
    if (!isPositiveInteger(nextConfig.defaultPeriods)) {
        console.error('默认期数必须是正整数。');
        return 1;
    }
    await saveLocalConfig(nextConfig);
    console.log('\n配置已保存。');
    console.log(`配置文件: ${getConfigPath()}`);
    if (nextConfig.token)
        console.log('Token 是敏感信息，请不要分享该配置文件。');
    console.log(renderConfigSummary(nextConfig));
    return 0;
};
const parseInitArgs = (argv) => {
    const parsed = {};
    const readValue = (index, name) => {
        const value = argv[index + 1];
        if (!value || value.startsWith('--'))
            throw new Error(`${name} 缺少参数值。`);
        return value;
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') {
            parsed.help = true;
            continue;
        }
        if (arg === '--mode') {
            const mode = readValue(index, '--mode').toLowerCase();
            if (mode !== 'remote' && mode !== 'official')
                throw new Error(`不支持的数据模式: ${mode}`);
            parsed.mode = mode;
            index += 1;
            continue;
        }
        if (arg === '--api-base-url') {
            parsed.apiBaseUrl = readValue(index, '--api-base-url');
            index += 1;
            continue;
        }
        if (arg === '--token') {
            parsed.token = readValue(index, '--token');
            index += 1;
            continue;
        }
        if (arg === '--periods') {
            parsed.periods = readValue(index, '--periods');
            index += 1;
            continue;
        }
        if (arg === '--data-dir') {
            parsed.dataDir = readValue(index, '--data-dir');
            index += 1;
            continue;
        }
        throw new Error(`未知参数: ${arg}`);
    }
    return parsed;
};
const promptForConfig = async (argv = []) => {
    let options;
    try {
        options = parseInitArgs(argv);
    }
    catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        console.log(renderInitUsage());
        return 1;
    }
    if (options.help) {
        console.log(renderInitUsage());
        return 0;
    }
    const currentConfig = await resolveConfig();
    const hasNamedOptions = argv.length > 0;
    if (!process.stdin.isTTY) {
        const pipedInput = hasNamedOptions ? [] : readFileSync(0, 'utf8').split(/\r?\n/);
        const nextConfig = buildNextConfig(currentConfig, hasNamedOptions ? {
            dataMode: options.mode,
            apiBaseUrl: options.apiBaseUrl,
            token: options.token,
            defaultPeriods: options.periods,
            dataDir: options.dataDir,
        } : {
            dataMode: 'remote',
            apiBaseUrl: pipedInput[0],
            token: pipedInput[1],
            defaultPeriods: pipedInput[2],
        });
        return persistConfig(nextConfig);
    }
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    try {
        const defaultMode = currentConfig.dataMode === 'official' ? 'official' : 'remote';
        const modeInput = options.mode || (await rl.question(`数据模式 remote/official [${defaultMode}]: `)).trim().toLowerCase() || defaultMode;
        if (modeInput !== 'remote' && modeInput !== 'official') {
            console.error(`不支持的数据模式: ${modeInput}`);
            return 1;
        }
        let apiBaseUrlInput = options.apiBaseUrl;
        let tokenInput = options.token;
        let dataDirInput = options.dataDir;
        if (modeInput === 'remote') {
            apiBaseUrlInput ??= (await rl.question(`接口地址 [${currentConfig.apiBaseUrl || DEFAULT_API_BASE_URL}]: `)).trim();
            tokenInput ??= (await rl.question(`Token [${currentConfig.token ? maskToken(currentConfig.token) : '必填'}]: `)).trim();
        }
        else {
            dataDirInput ??= (await rl.question(`数据目录 [${currentConfig.dataDir || '.lotterymcp-data'}]: `)).trim();
        }
        const defaultPeriodsInput = options.periods ?? (await rl.question(`默认期数 [${currentConfig.defaultPeriods || DEFAULT_PERIODS}]: `)).trim();
        const nextConfig = buildNextConfig(currentConfig, {
            dataMode: modeInput,
            apiBaseUrl: apiBaseUrlInput,
            token: tokenInput,
            defaultPeriods: defaultPeriodsInput,
            dataDir: dataDirInput,
        });
        return persistConfig(nextConfig);
    }
    finally {
        rl.close();
    }
};
const canShowInteractiveMenu = (stdin = process.stdin, stdout = process.stdout) => process.env.NBCP_FORCE_MENU === '1' || (Boolean(stdin.isTTY) && Boolean(stdout.isTTY));
const hasOfficialCache = (dataDir) => {
    return hasPl3Database(dataDir) || existsSync(path.join(dataDir, 'pl3.json'));
};
const getOfficialCacheSummary = (dataDir) => {
    if (hasPl3Database(dataDir)) {
        const store = openPl3Store({ dataDir, readonly: true, fileMustExist: true });
        try {
            const status = store.getStatus();
            return {
                exists: true,
                valid: true,
                cachePath: status.databasePath,
                recordCount: status.usableRecords,
                latestPeriod: status.latestPeriod,
                generatedAt: null,
                database: status,
            };
        }
        catch (error) {
            return {
                exists: true,
                valid: false,
                cachePath: resolvePl3DatabasePath(dataDir),
                error: error instanceof Error ? error.message : String(error),
            };
        }
        finally {
            store.close();
        }
    }
    const cachePath = path.join(dataDir, 'pl3.json');
    if (!existsSync(cachePath))
        return { exists: false, cachePath };
    try {
        const parsed = JSON.parse(readFileSync(cachePath, 'utf8'));
        const sourceRecords = Array.isArray(parsed) ? parsed : parsed?.records;
        const records = normalizePl3Records(Array.isArray(sourceRecords) ? sourceRecords : []);
        return {
            exists: true,
            valid: true,
            cachePath,
            recordCount: records.length,
            latestPeriod: records.at(-1)?.period || null,
            generatedAt: parsed?.generatedAt || null,
        };
    }
    catch (error) {
        return {
            exists: true,
            valid: false,
            cachePath,
            error: error instanceof Error ? error.message : String(error),
        };
    }
};
const validateOfficialCache = (config) => {
    if (config.dataMode !== 'official') {
        return true;
    }
    const dataDir = String(config.dataDir || '.lotterymcp-data');
    if (hasOfficialCache(dataDir)) {
        return true;
    }
    console.error(`未找到排列3数据档案，请先运行 lotterymcp sync --source official，已有 JSON 时可运行 lotterymcp data migrate --dry-run。数据目录: ${dataDir}`);
    return false;
};
const printConfigSnippet = async () => {
    const config = await resolveConfig();
    const missing = validateConfig(config);
    if (missing.length > 0) {
        console.error(`未检测到完整配置，请先完成接入向导。缺少: ${missing.join(', ')}`);
        return 1;
    }
    console.log('将下面这段 MCP 配置粘贴到支持 MCP 的 AI 工具中:\n');
    console.log(renderMcpConfigSnippet(config));
    return 0;
};
const renderDoctorSummary = (health) => {
    const tools = Array.isArray(health?.tools) ? health.tools.join(', ') : '未返回';
    const authHeader = health?.auth?.header ? String(health.auth.header) : '未返回';
    const provider = health?.provider ? String(health.provider) : 'remote';
    return [
        provider === 'official' ? '官方本地数据源正常。' : '网站接口正常。',
        `  服务名称: ${health?.service || '未知'}`,
        `  传输方式: ${health?.transport || '未知'}`,
        `  数据来源: ${provider}`,
        ...(health?.dataDir ? [`  数据目录: ${health.dataDir}`] : []),
        ...(provider === 'official' ? [] : [`  鉴权头: ${authHeader}`]),
        `  数据工具: ${tools}`,
        `  本地 MCP 工具: ${MCP_SERVER_TOOLS.join(', ')}`,
    ].join('\n');
};
const runDoctor = async (argv = []) => {
    if (argv.includes('--help') || argv.includes('-h')) {
        console.log(renderDoctorUsage());
        return 0;
    }
    if (argv.length > 0) {
        console.error(`未知参数: ${argv[0]}`);
        console.log(renderDoctorUsage());
        return 1;
    }
    const config = await resolveConfig();
    const missing = validateConfig(config);
    console.log(renderConfigSummary(config));
    if (missing.length > 0) {
        console.log(`缺少: ${missing.join(', ')}`);
        return 1;
    }
    if (!validateOfficialCache(config)) {
        return 1;
    }
    try {
        const client = createLotteryMcpClient(toResolvedConfig(config));
        const health = await client.getHealth();
        console.log(renderDoctorSummary(health));
        const predictionService = createPl3PredictionService(client, {
            dataDir: config.dataDir,
            defaultPeriods: 200,
            payouts: getPredictionPayouts(),
        });
        const ledger = await predictionService.getLedgerSummary();
        console.log(`预测账本: 总计 ${ledger.total}，待结算 ${ledger.pending}，已结算 ${ledger.settled}`);
        const dataDir = String(config.dataDir || '.lotterymcp-data');
        if (hasPl3Database(dataDir)) {
            const store = openPl3Store({ dataDir, readonly: true, fileMustExist: true });
            try {
                const schemaVersion = store.getSchemaVersion();
                const snapshots = store.listDatasetSnapshots({ limit: 100 });
                console.log(`研究数据库: schema ${schemaVersion}/${PL3_DATABASE_LATEST_SCHEMA_VERSION}，snapshot ${snapshots.length}`);
                if (schemaVersion < PL3_DATABASE_LATEST_SCHEMA_VERSION) {
                    console.log('实验基础设施: 待迁移，请先运行 lotterymcp data migrate --dry-run');
                }
                else {
                    const experiments = store.listExperiments({ limit: 100 });
                    const statusCounts = experiments.reduce((counts, experiment) => {
                        counts[experiment.status] = (counts[experiment.status] || 0) + 1;
                        return counts;
                    }, {});
                    const activeLocks = store.listRuntimeLocks().filter((lock) => Date.parse(String(lock.expires_at)) > Date.now());
                    console.log(`实验: ${experiments.length}，状态 ${JSON.stringify(statusCounts)}，活动锁 ${activeLocks.length}`);
                }
            }
            finally {
                store.close();
            }
        }
        if (config.dataMode === 'official') {
            const cache = getOfficialCacheSummary(dataDir);
            if (!cache.valid) {
                console.error(`排列3缓存无效: ${cache.error || cache.cachePath}`);
                return 1;
            }
            console.log(`排列3缓存: ${cache.recordCount} 期，最新 ${cache.latestPeriod || '未知'}，更新 ${cache.generatedAt || '未知'}`);
            if ('database' in cache && cache.database) {
                console.log(`SQLite: schema ${cache.database.schemaVersion}，确认 ${cache.database.confirmedRecords}，单来源 ${cache.database.singleSourceRecords}，冲突 ${cache.database.conflictRecords}`);
                console.log(`完整率: ${cache.database.completenessStatus === 'known' && cache.database.authoritativeCompleteness !== null ? `${(cache.database.authoritativeCompleteness * 100).toFixed(2)}%` : 'unknown'}`);
            }
        }
        return 0;
    }
    catch (error) {
        const message = error instanceof McpApiError
            ? formatMcpApiError(error)
            : error instanceof Error
                ? error.message
                : String(error);
        console.error(`检查失败: ${message}`);
        return 1;
    }
};
const runServe = async () => {
    const config = await resolveConfig();
    const missing = validateConfig(config);
    if (missing.length > 0) {
        console.error(`未检测到完整配置，请先运行 init 或默认菜单完成接入。缺少: ${missing.join(', ')}`);
        return 1;
    }
    if (!validateOfficialCache(config)) {
        return 1;
    }
    try {
        await startLotteryMcpStdioServer({
            ...toResolvedConfig(config),
            predictionPayouts: getPredictionPayouts(),
        });
        await new Promise(() => undefined);
        return 0;
    }
    catch (error) {
        const message = error instanceof McpApiError
            ? formatMcpApiError(error)
            : error instanceof Error
                ? error.message
                : String(error);
        console.error(`MCP 服务启动失败: ${message}`);
        return 1;
    }
};
const getPredictionPayouts = () => {
    const readAmount = (name) => {
        const raw = process.env[name];
        if (raw === undefined || raw.trim() === '')
            return undefined;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed < 0)
            throw new Error(`${name} 必须是非负数字。`);
        return parsed;
    };
    const values = {
        stake: readAmount('LOTTERYMCP_PL3_STAKE'),
        direct: readAmount('LOTTERYMCP_PL3_PAYOUT_DIRECT'),
        group3: readAmount('LOTTERYMCP_PL3_PAYOUT_GROUP3'),
        group6: readAmount('LOTTERYMCP_PL3_PAYOUT_GROUP6'),
    };
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
};
const renderPrediction = (prediction) => {
    const lines = [
        '排列3预测结果',
        `  截止期号: ${prediction.afterPeriod}`,
        `  训练记录: ${prediction.training.recordCount}`,
        `  模型版本: ${prediction.model.version}`,
        `  玩法/注数: ${prediction.query.playType} / ${prediction.query.tickets}`,
        `  预测 ID: ${prediction.predictionId}`,
        '',
        '候选票:',
        ...prediction.tickets.map((ticket) => `  ${String(ticket.rank).padStart(2, ' ')}. ${ticket.playType.padEnd(6, ' ')} ${ticket.display}  score=${ticket.score}`),
        '',
        prediction.backtest.status === 'complete'
            ? `回测: ${prediction.backtest.testCount} 期 | 成本 ${prediction.backtest.totalCost} | 返回 ${prediction.backtest.totalReturn} | ROI ${prediction.backtest.roi}`
            : '回测: 数据仅够生成预测，暂无可用测试期。',
        prediction.payouts.note,
    ];
    return lines.join('\n');
};
const parsePredictionArgs = (argv, allowProgramAlias = false) => {
    const parsed = {};
    const aliases = new Set(['pl3', 'p3', 'pl3_markov']);
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg) {
            continue;
        }
        if (!arg.startsWith('--') && allowProgramAlias && aliases.has(arg.toLowerCase())) {
            continue;
        }
        if (arg === '--periods' || arg === '-p') {
            parsed.periods = Number(argv[index + 1]);
            index += 1;
            continue;
        }
        if (arg === '--tickets' || arg === '-n') {
            parsed.tickets = Number(argv[index + 1]);
            index += 1;
            continue;
        }
        if (arg === '--play') {
            parsed.playType = String(argv[index + 1] || '').trim().toLowerCase();
            index += 1;
            continue;
        }
        if (arg === '--output' || arg === '-o') {
            parsed.outputPath = argv[index + 1];
            index += 1;
            continue;
        }
        throw new Error(`未知参数: ${arg}`);
    }
    return parsed;
};
const runPredictionCommand = async (argv, allowProgramAlias = false) => {
    if (argv.includes('--help') || argv.includes('-h')) {
        console.log(renderAnalyzeUsage());
        return 0;
    }
    let parsed;
    try {
        parsed = parsePredictionArgs(argv, allowProgramAlias);
    }
    catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        console.log(renderAnalyzeUsage());
        return 1;
    }
    const config = await resolveConfig();
    const missing = validateConfig(config);
    if (missing.length > 0) {
        console.error(`未检测到完整配置。缺少: ${missing.join(', ')}`);
        return 1;
    }
    if (!validateOfficialCache(config))
        return 1;
    try {
        const resolvedConfig = toResolvedConfig(config);
        const client = createLotteryMcpClient(resolvedConfig);
        const service = createPl3PredictionService(client, {
            dataDir: resolvedConfig.dataDir,
            defaultPeriods: 200,
            payouts: getPredictionPayouts(),
        });
        const envelope = await service.predict({
            periods: parsed.periods,
            tickets: parsed.tickets,
            playType: parsed.playType,
        });
        console.log(renderPrediction(envelope.data));
        if (parsed.outputPath) {
            const outputPath = path.resolve(parsed.outputPath);
            await writeJsonAtomically(outputPath, envelope);
            console.log(`结果文件: ${outputPath}`);
        }
        return 0;
    }
    catch (error) {
        const message = error instanceof McpApiError ? formatMcpApiError(error) : error instanceof Error ? error.message : String(error);
        console.error(`排列3预测失败: ${message}`);
        return 1;
    }
};
const runPredictionMenu = async () => {
    if (!canShowInteractiveMenu()) {
        console.log(renderAnalyzeUsage());
        return 0;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        const periods = (await rl.question(`历史期数 [200]: `)).trim();
        const tickets = (await rl.question(`候选注数 [10]: `)).trim();
        const play = (await rl.question(`玩法 direct/group3/group6/mixed [mixed]: `)).trim();
        return runPredictionCommand([
            '--periods', periods || '200',
            '--tickets', tickets || '10',
            '--play', play || 'mixed',
        ]);
    }
    finally {
        rl.close();
    }
};
const renderSyncUsage = () => `用法:
  lotterymcp sync --source official --limit 500
  lotterymcp sync --source official --lottery pl3 --limit 500
  lotterymcp sync --source file --file history.json --limit 500

支持彩种: pl3
`;
const parseSyncArgs = (argv) => {
    const parsed = {};
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg) {
            continue;
        }
        if (arg === '--source') {
            parsed.source = argv[index + 1];
            index += 1;
            continue;
        }
        if (arg === '--lottery') {
            const lotteryType = String(argv[index + 1] || '').trim().toLowerCase();
            if (lotteryType !== 'pl3') {
                throw new Error(`未支持的官方彩种: ${lotteryType || '(空)'}`);
            }
            index += 1;
            continue;
        }
        if (arg === '--all') {
            continue;
        }
        if (arg === '--limit' || arg === '-n') {
            parsed.limit = argv[index + 1];
            index += 1;
            continue;
        }
        if (arg === '--file') {
            parsed.filePath = argv[index + 1];
            index += 1;
            continue;
        }
        throw new Error(`未知参数: ${arg}`);
    }
    return parsed;
};
const runSyncCommand = async (argv) => {
    if (argv.includes('--help') || argv.includes('-h')) {
        console.log(renderSyncUsage());
        return 0;
    }
    let parsed;
    try {
        parsed = parseSyncArgs(argv);
    }
    catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        console.log(renderSyncUsage());
        return 1;
    }
    const source = parsed.source || 'official';
    if (source !== 'official' && source !== 'file') {
        console.error(`未支持的数据源: ${parsed.source}`);
        console.log(renderSyncUsage());
        return 1;
    }
    const limit = Number(parsed.limit || '500');
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
        console.error('同步期数必须是 1-1000 的整数。');
        return 1;
    }
    const config = await resolveConfig();
    const dataDir = String(config.dataDir || '.lotterymcp-data');
    if (source === 'file') {
        if (!parsed.filePath) {
            console.error('使用 --source file 时必须提供 --file。');
            console.log(renderSyncUsage());
            return 1;
        }
        try {
            const result = await syncOfficialFile({ filePath: parsed.filePath, limit, dataDir });
            console.log(`写入: ${result.outputPath}`);
            console.log(`记录: ${result.records.length}`);
            result.warnings.forEach((warning) => console.warn(`警告: ${warning}`));
            if (result.settledCount > 0)
                console.log(`已结算预测: ${result.settledCount}`);
            return 0;
        }
        catch (error) {
            console.error(`文件同步失败: ${error instanceof Error ? error.message : String(error)}`);
            return 1;
        }
    }
    try {
        console.log('正在同步 pl3 官方公开开奖数据...');
        const result = await syncOfficialPl3({ limit, dataDir });
        console.log(`  写入: ${result.outputPath}`);
        console.log(`  记录: ${result.records.length}`);
        console.log(`  来源: ${result.sourceUrl}`);
        result.warnings.forEach((warning) => console.warn(`  警告: ${warning}`));
        if (result.settledCount > 0)
            console.log(`  已结算预测: ${result.settledCount}`);
    }
    catch (error) {
        console.error(`pl3 同步失败: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
    console.log('\n同步完成。下一步可运行:');
    console.log('  lotterymcp init --mode official');
    console.log('  lotterymcp predict --periods 200 --tickets 10 --play mixed');
    return 0;
};
const renderDataUsage = () => `用法:
  lotterymcp data status [--json]
  lotterymcp data sync [--limit 500]
  lotterymcp data sync --full [--provider auto|lottery-gov-cn|zhcw] [--reconcile] [--resume|--restart]
  lotterymcp data import --file FILE [--format json|csv]
  lotterymcp data export --output FILE [--format json|csv]
  lotterymcp data migrate --dry-run
  lotterymcp data migrate --apply
  lotterymcp data conflicts [--from-period P] [--to-period P] [--type date|numbers|both] [--json]
  lotterymcp data resolve --period PERIOD --observation-id ID --reason TEXT --evidence-url URL
  lotterymcp data snapshot create [--last 2000 | --from-period P --after-period P] [--allow-single-source]
  lotterymcp data snapshot list
  lotterymcp data snapshot inspect SNAPSHOT_ID
  lotterymcp data snapshot verify SNAPSHOT_ID
  lotterymcp data backup
  lotterymcp data restore --backup FILE
  lotterymcp data gc --dry-run|--apply

说明:
  migrate 使用旁路数据库验证后原子切换，不删除原 pl3.json 和预测账本。
  doctor 和 serve 不会隐式执行数据迁移。
`;
const getArgumentValue = (argv, name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
};
const printDataValue = (value, asJson) => {
    if (asJson)
        console.log(JSON.stringify(value, null, 2));
    else
        console.log(value);
};
const runDataStatus = async (dataDir, asJson) => {
    if (!hasPl3Database(dataDir)) {
        const preview = await previewLegacyPl3Migration(dataDir);
        if (asJson) {
            console.log(JSON.stringify({ storage: 'legacy-json', migrationRequired: preview.historyExists, ...preview }, null, 2));
        }
        else {
            console.log('排列3数据存储: legacy-json');
            console.log(`  历史缓存: ${preview.historyExists ? preview.historyPath : '未找到'}`);
            console.log(`  有效记录: ${preview.recordCount}`);
            console.log(`  最新期号: ${preview.latestPeriod || '未知'}`);
            console.log(`  旧预测数: ${preview.predictionCount}`);
            if (preview.historyExists)
                console.log('  迁移状态: 待执行 data migrate --dry-run');
        }
        return 0;
    }
    const store = openPl3Store({ dataDir, readonly: true, fileMustExist: true });
    try {
        const status = store.getStatus();
        if (asJson)
            console.log(JSON.stringify({ storage: 'sqlite', ...status }, null, 2));
        else {
            console.log('排列3数据存储: sqlite');
            console.log(`  数据库: ${status.databasePath}`);
            console.log(`  Schema: ${status.schemaVersion}`);
            console.log(`  可用记录: ${status.usableRecords}`);
            console.log(`  确认/单来源/冲突: ${status.confirmedRecords}/${status.singleSourceRecords}/${status.conflictRecords}`);
            console.log(`  最新期号: ${status.latestPeriod || '未知'}`);
            console.log(`  权威完整率: ${status.authoritativeCompleteness === null ? 'unknown' : `${(status.authoritativeCompleteness * 100).toFixed(2)}%`}`);
            console.log(`  来源核对覆盖率: ${status.reconciliationCoverage === null ? 'unknown' : `${(status.reconciliationCoverage * 100).toFixed(2)}%`}`);
            console.log(`  双官方来源覆盖率: ${status.dualSourceCoverage === null ? 'unknown' : `${(status.dualSourceCoverage * 100).toFixed(2)}%`}`);
            console.log(`  已保全旧预测: ${status.legacyPredictionCount}`);
        }
        return 0;
    }
    finally {
        store.close();
    }
};
const runDataCommand = async (argv) => {
    if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
        console.log(renderDataUsage());
        return 0;
    }
    const action = argv[0];
    const config = await resolveConfig();
    const dataDir = path.resolve(String(config.dataDir || '.lotterymcp-data'));
    const asJson = argv.includes('--json');
    try {
        if (action === 'status')
            return runDataStatus(dataDir, asJson);
        if (action === 'sync') {
            if (!hasPl3Database(dataDir) && existsSync(path.join(dataDir, 'pl3.json'))) {
                throw new Error('检测到旧 pl3.json，请先执行 data migrate --dry-run 和 data migrate --apply。');
            }
            const full = argv.includes('--full');
            const limit = Number(getArgumentValue(argv, '--limit') || (full ? '10000' : '500'));
            const provider = String(getArgumentValue(argv, '--provider') || 'auto');
            if (!['auto', 'lottery-gov-cn', 'zhcw'].includes(provider)) {
                throw new Error('data sync 的 --provider 只支持 auto、lottery-gov-cn 或 zhcw。');
            }
            if (!Number.isInteger(limit) || limit < 1 || limit > 10000) {
                throw new Error('data sync 的 --limit 必须是 1-10000 的整数。');
            }
            if (argv.includes('--resume') && argv.includes('--restart')) {
                throw new Error('data sync 的 --resume 和 --restart 不能同时使用。');
            }
            const restart = argv.includes('--restart');
            if (!asJson)
                console.log(full ? '正在全量同步排列3公开历史数据...' : '正在增量同步排列3公开历史数据...');
            const result = await syncOfficialPl3ToStore({
                dataDir,
                limit,
                full,
                provider: provider,
                resume: !restart,
                restart,
            });
            const results = [result];
            if (argv.includes('--reconcile') && result.provider !== 'zhcw') {
                if (!asJson)
                    console.log('正在同步中彩网进行独立来源核对...');
                results.push(await syncOfficialPl3ToStore({
                    dataDir,
                    limit,
                    full,
                    provider: 'zhcw',
                    resume: !restart,
                    restart,
                }));
            }
            const finalResult = results.at(-1);
            if (asJson)
                console.log(JSON.stringify({
                    syncs: results.map((item) => ({
                        databasePath: item.databasePath,
                        provider: item.provider,
                        sourceUrl: item.sourceUrl,
                        importedRecordCount: item.records.length,
                        authoritativeTotal: item.authoritativeTotal,
                        rawResponseCount: item.rawResponseCount,
                        rawManifestPath: item.rawManifestPath,
                        checkpointPath: item.checkpointPath,
                        resumedPageCount: item.resumedPageCount,
                        warnings: item.warnings,
                    })),
                    final: {
                        databasePath: finalResult.databasePath,
                        records: finalResult.records.length,
                        confirmedRecords: finalResult.confirmedRecords,
                        singleSourceRecords: finalResult.singleSourceRecords,
                        conflictRecords: finalResult.conflictRecords,
                    },
                }, null, 2));
            else {
                console.log(`同步完成: ${finalResult.databasePath}`);
                results.forEach((item) => {
                    console.log(`  来源: ${item.provider} (${item.sourceUrl})`);
                    console.log(`    原始响应: ${item.rawResponseCount} 页`);
                    console.log(`    Raw manifest: ${item.rawManifestPath}`);
                    if (item.resumedPageCount > 0)
                        console.log(`    已恢复页面: ${item.resumedPageCount}`);
                    console.log(`    来源声明总数: ${item.authoritativeTotal ?? 'unknown'}`);
                    item.warnings.forEach((warning) => console.warn(`    警告: ${warning}`));
                });
                console.log(`  可用记录: ${finalResult.records.length}`);
                console.log(`  确认/单来源/冲突: ${finalResult.confirmedRecords}/${finalResult.singleSourceRecords}/${finalResult.conflictRecords}`);
                const settledCount = results.reduce((total, item) => total + item.settledCount, 0);
                if (settledCount > 0)
                    console.log(`  已结算预测: ${settledCount}`);
            }
            return 0;
        }
        if (action === 'import') {
            if (!hasPl3Database(dataDir) && existsSync(path.join(dataDir, 'pl3.json'))) {
                throw new Error('检测到旧 pl3.json，请先执行 data migrate --dry-run 和 data migrate --apply。');
            }
            const filePath = getArgumentValue(argv, '--file');
            if (!filePath)
                throw new Error('data import 必须提供 --file FILE。');
            const result = await importPl3FileToStore({
                dataDir,
                filePath,
                format: getArgumentValue(argv, '--format'),
            });
            printDataValue(asJson ? result : [
                '排列3文件导入完成。',
                `  数据库: ${result.databasePath}`,
                `  输入记录: ${result.inputCount}`,
                `  新 observation: ${result.insertedObservations}`,
                `  重复 observation: ${result.repeatedObservations}`,
                `  影响期数: ${result.affectedPeriods}`,
                `  原始文件归档: ${result.rawPath}`,
            ].join('\n'), asJson);
            return 0;
        }
        if (action === 'export') {
            if (!hasPl3Database(dataDir))
                throw new Error('尚未启用 SQLite，请先运行 data migrate 或 data sync。');
            const outputPath = getArgumentValue(argv, '--output');
            if (!outputPath)
                throw new Error('data export 必须提供 --output FILE。');
            const result = await exportPl3Store({
                dataDir,
                outputPath,
                format: getArgumentValue(argv, '--format'),
            });
            printDataValue(asJson ? result : `已导出 ${result.recordCount} 条排列3记录: ${result.outputPath}`, asJson);
            return 0;
        }
        if (action === 'migrate') {
            const apply = argv.includes('--apply');
            const dryRun = argv.includes('--dry-run');
            if (apply === dryRun)
                throw new Error('data migrate 必须且只能指定 --dry-run 或 --apply。');
            if (hasPl3Database(dataDir)) {
                if (dryRun) {
                    const preview = previewPl3SchemaMigration(dataDir);
                    printDataValue(asJson ? preview : [
                        '排列3数据库 schema 迁移预检完成。',
                        `  数据库: ${preview.databasePath}`,
                        `  当前版本: ${preview.currentVersion}`,
                        `  目标版本: ${preview.targetVersion}`,
                        `  待执行: ${preview.migrations.map((item) => `M00${item.version} ${item.name}`).join(', ') || '无'}`,
                    ].join('\n'), asJson);
                    return 0;
                }
                const result = await applyPl3SchemaMigration(dataDir);
                printDataValue(asJson ? result : result.applied ? [
                    '排列3数据库 schema 迁移完成。',
                    `  当前版本: ${result.currentVersion}`,
                    `  迁移前备份: ${result.backupPath}`,
                    `  被替换数据库: ${result.replacedPath}`,
                ].join('\n') : `排列3数据库 schema 已是最新版本 ${result.currentVersion}。`, asJson);
                return 0;
            }
            if (dryRun) {
                const preview = await previewLegacyPl3Migration(dataDir);
                printDataValue(asJson ? preview : [
                    '排列3迁移预检通过。',
                    `  数据目录: ${preview.dataDir}`,
                    `  历史记录: ${preview.recordCount}`,
                    `  期号范围: ${preview.oldestPeriod || '未知'}..${preview.latestPeriod || '未知'}`,
                    `  历史哈希: ${preview.recordHash || '无'}`,
                    `  预测记录: ${preview.predictionCount}`,
                    `  目标数据库: ${preview.databasePath}`,
                ].join('\n'), asJson);
                return preview.databaseExists || !preview.historyExists ? 1 : 0;
            }
            const result = await applyLegacyPl3Migration(dataDir);
            printDataValue(asJson ? result : [
                '排列3 SQLite 迁移完成。',
                `  数据库: ${result.databasePath}`,
                `  导入开奖记录: ${result.importedObservations}`,
                `  保全预测记录: ${result.importedPredictions}`,
                `  备份: ${result.backupPaths.join(', ') || '无'}`,
                '  原 JSON 已保留，未启用双写。',
            ].join('\n'), asJson);
            return 0;
        }
        if (action === 'snapshot') {
            if (!hasPl3Database(dataDir))
                throw new Error('尚未启用 SQLite，请先运行 data migrate 或 data sync。');
            const snapshotAction = argv[1];
            if (!snapshotAction)
                throw new Error('data snapshot 需要 create、list、inspect 或 verify。');
            const readonly = snapshotAction !== 'create';
            const store = openPl3Store({ dataDir, readonly, fileMustExist: true });
            try {
                if (snapshotAction === 'create') {
                    const lastValue = getArgumentValue(argv, '--last');
                    const fromPeriod = getArgumentValue(argv, '--from-period');
                    const afterPeriod = getArgumentValue(argv, '--after-period');
                    if (lastValue !== undefined && (fromPeriod || afterPeriod)) {
                        throw new Error('snapshot 的 --last 与显式期号范围不能同时使用。');
                    }
                    const last = lastValue === undefined && !fromPeriod && !afterPeriod ? 2000 :
                        lastValue === undefined ? undefined : Number(lastValue);
                    if (last !== undefined && (!Number.isInteger(last) || last < 1)) {
                        throw new Error('snapshot 的 --last 必须是正整数。');
                    }
                    const snapshot = store.createDatasetSnapshot({
                        last,
                        fromPeriod,
                        afterPeriod,
                        allowSingleSource: argv.includes('--allow-single-source'),
                        codeCommit: process.env.LOTTERYMCP_CODE_COMMIT || process.env.GITHUB_SHA,
                    });
                    printDataValue(asJson ? snapshot : [
                        '排列3数据 snapshot 创建完成。',
                        `  Snapshot ID: ${snapshot.snapshotId}`,
                        `  期号范围: ${snapshot.fromPeriod}..${snapshot.afterPeriod}`,
                        `  记录: ${snapshot.recordCount}`,
                        `  confirmed/single-source: ${snapshot.confirmedCount}/${snapshot.singleSourceCount}`,
                        `  数据哈希: ${snapshot.dataHash}`,
                    ].join('\n'), asJson);
                    return 0;
                }
                if (snapshotAction === 'list') {
                    const snapshots = store.listDatasetSnapshots({
                        page: Number(getArgumentValue(argv, '--page') || 1),
                        limit: Number(getArgumentValue(argv, '--limit') || 20),
                    });
                    if (asJson)
                        console.log(JSON.stringify(snapshots, null, 2));
                    else if (snapshots.length === 0)
                        console.log('当前没有排列3数据 snapshot。');
                    else
                        snapshots.forEach((snapshot) => console.log(`${snapshot.snapshotId}  ${snapshot.fromPeriod}..${snapshot.afterPeriod}  ${snapshot.recordCount}  ${snapshot.quality}`));
                    return 0;
                }
                if (snapshotAction === 'inspect') {
                    const snapshotId = argv[2];
                    if (!snapshotId)
                        throw new Error('snapshot inspect 必须提供 SNAPSHOT_ID。');
                    const snapshot = store.getDatasetSnapshot(snapshotId);
                    if (!snapshot)
                        throw new Error(`排列3数据 snapshot 不存在: ${snapshotId}`);
                    printDataValue(asJson ? snapshot : [
                        `Snapshot: ${snapshot.snapshotId}`,
                        `  期号范围: ${snapshot.fromPeriod}..${snapshot.afterPeriod}`,
                        `  记录: ${snapshot.recordCount}`,
                        `  质量: ${snapshot.quality}`,
                        `  confirmed/single-source: ${snapshot.confirmedCount}/${snapshot.singleSourceCount}`,
                        `  数据哈希: ${snapshot.dataHash}`,
                        `  创建时间: ${snapshot.createdAt}`,
                        `  代码 commit: ${snapshot.codeCommit || '未记录'}`,
                    ].join('\n'), asJson);
                    return 0;
                }
                if (snapshotAction === 'verify') {
                    const snapshotId = argv[2];
                    if (!snapshotId)
                        throw new Error('snapshot verify 必须提供 SNAPSHOT_ID。');
                    const verification = store.verifyDatasetSnapshot(snapshotId);
                    printDataValue(asJson ? verification : [
                        `Snapshot ${snapshotId}: ${verification.valid ? '有效' : '无效'}`,
                        `  记录: ${verification.actualRecordCount}/${verification.expectedRecordCount}`,
                        `  哈希: ${verification.actualDataHash}`,
                    ].join('\n'), asJson);
                    return verification.valid ? 0 : 1;
                }
                throw new Error(`未知 snapshot 子命令: ${snapshotAction}`);
            }
            finally {
                store.close();
            }
        }
        if (action === 'conflicts') {
            if (!hasPl3Database(dataDir))
                throw new Error('尚未启用 SQLite，请先运行 data migrate。');
            const store = openPl3Store({ dataDir, readonly: true, fileMustExist: true });
            try {
                const type = getArgumentValue(argv, '--type');
                if (type && !['date', 'numbers', 'both'].includes(type)) {
                    throw new Error('conflicts 的 --type 只支持 date、numbers 或 both。');
                }
                const conflicts = store.getConflicts({
                    fromPeriod: getArgumentValue(argv, '--from-period'),
                    toPeriod: getArgumentValue(argv, '--to-period'),
                    type: type,
                });
                if (asJson)
                    console.log(JSON.stringify(conflicts, null, 2));
                else if (conflicts.length === 0)
                    console.log('当前没有未解决的排列3数据冲突。');
                else
                    conflicts.forEach((conflict) => {
                        console.log(`第 ${conflict.period} 期 [${conflict.type}]:`);
                        conflict.observations.forEach((item) => console.log(`  #${item.observationId} ${item.provider} ${item.drawDate} ${item.numbers} ${item.sourceUrl || ''}`.trimEnd()));
                    });
                return 0;
            }
            finally {
                store.close();
            }
        }
        if (action === 'resolve') {
            if (!hasPl3Database(dataDir))
                throw new Error('尚未启用 SQLite，请先运行 data migrate。');
            const period = getArgumentValue(argv, '--period');
            const observationId = Number(getArgumentValue(argv, '--observation-id'));
            const reason = getArgumentValue(argv, '--reason');
            const evidenceUrl = getArgumentValue(argv, '--evidence-url');
            if (!period || !Number.isInteger(observationId) || observationId < 1 || !reason || !evidenceUrl) {
                throw new Error('data resolve 需要 --period、--observation-id、--reason 和 --evidence-url。');
            }
            const store = openPl3Store({ dataDir });
            try {
                const record = store.resolveConflict({
                    period,
                    observationId,
                    reason,
                    evidenceUrl,
                });
                printDataValue(asJson ? record : `第 ${period} 期冲突已确认，采用 observation ${observationId}。`, asJson);
                return 0;
            }
            finally {
                store.close();
            }
        }
        if (action === 'backup') {
            const result = await backupPl3Database(dataDir);
            printDataValue(asJson ? result : `排列3数据库备份完成: ${result.backupPath}`, asJson);
            return 0;
        }
        if (action === 'gc') {
            if (!hasPl3Database(dataDir))
                throw new Error('尚未启用 SQLite，无法分析 raw 引用。');
            const apply = argv.includes('--apply');
            const dryRun = argv.includes('--dry-run');
            if (apply === dryRun)
                throw new Error('data gc 必须且只能指定 --dry-run 或 --apply。');
            if (apply) {
                const result = await applyPl3RawGcPlan(dataDir);
                if (asJson)
                    console.log(JSON.stringify(result, null, 2));
                else
                    console.log(`raw GC 完成: 删除 ${result.deletedFiles} 个文件，${result.deletedBytes} 字节。`);
            }
            else {
                const result = await createPl3RawGcPlan(dataDir);
                if (asJson)
                    console.log(JSON.stringify(result, null, 2));
                else
                    console.log(`raw GC 预检: ${result.candidates.length} 个文件，${result.totalBytes} 字节。`);
            }
            return 0;
        }
        if (action === 'restore') {
            const backupPath = getArgumentValue(argv, '--backup');
            if (!backupPath)
                throw new Error('data restore 必须提供 --backup FILE。');
            const result = await restorePl3Database(dataDir, backupPath);
            printDataValue(asJson ? result : `排列3数据库已恢复: ${result.databasePath}`, asJson);
            return 0;
        }
        throw new Error(`未知 data 子命令: ${action}`);
    }
    catch (error) {
        console.error(`排列3数据操作失败: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
};
const resolveExperimentCodeCommit = () => {
    const explicit = String(process.env.LOTTERYMCP_CODE_COMMIT || process.env.GITHUB_SHA || '').trim();
    if (explicit)
        return explicit;
    try {
        const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: process.cwd(),
            encoding: 'utf8',
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
            cwd: process.cwd(),
            encoding: 'utf8',
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        if (!dirty.trim())
            return commit;
        const diff = execFileSync('git', ['diff', '--binary', 'HEAD'], {
            cwd: process.cwd(),
            encoding: 'buffer',
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore'],
            maxBuffer: 32 * 1024 * 1024,
        });
        const untracked = dirty.split(/\r?\n/).filter((line) => line.startsWith('?? ')).sort().join('\n');
        const worktreeHash = createHash('sha256').update(diff).update(untracked).digest('hex').slice(0, 16);
        return `${commit}-dirty-${worktreeHash}`;
    }
    catch {
        return `lotterymcp-${process.env.npm_package_version || '0.5.0'}`;
    }
};
const runExperimentCommand = async (argv) => {
    if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
        console.log(renderExperimentUsage());
        return 0;
    }
    const action = argv[0];
    const asJson = argv.includes('--json');
    const config = await resolveConfig();
    const dataDir = path.resolve(String(config.dataDir || '.lotterymcp-data'));
    try {
        if (!hasPl3Database(dataDir))
            throw new Error('尚未启用 SQLite，请先运行 data migrate 或 data sync。');
        const migration = previewPl3SchemaMigration(dataDir);
        if (migration.migrationRequired) {
            throw new Error(`实验需要 schema ${migration.targetVersion}，请先运行 lotterymcp data migrate --dry-run 和 --apply。`);
        }
        const readonly = action === 'list' || action === 'inspect';
        const store = openPl3Store({ dataDir, readonly, fileMustExist: true });
        try {
            if (action === 'create') {
                const specPath = argv[1];
                if (!specPath || specPath.startsWith('-'))
                    throw new Error('experiment create 必须提供 spec.json。');
                const spec = JSON.parse(readFileSync(path.resolve(specPath), 'utf8'));
                const created = createPl3Experiment(store, spec, resolveExperimentCodeCommit());
                printDataValue(asJson ? created : [
                    `实验已注册: ${created.experiment.experimentId}`,
                    `  模式: ${created.experiment.mode}`,
                    `  Dataset snapshot: ${created.experiment.datasetSnapshotId}`,
                    `  Spec hash: ${created.experiment.specHash}`,
                    `  Code commit: ${created.experiment.codeCommit}`,
                ].join('\n'), asJson);
                return 0;
            }
            if (action === 'list') {
                const experiments = store.listExperiments({ limit: 100 });
                if (asJson)
                    console.log(JSON.stringify(experiments, null, 2));
                else if (experiments.length === 0)
                    console.log('当前没有排列3实验。');
                else
                    experiments.forEach((experiment) => console.log(`${experiment.experimentId}  ${experiment.status}  ${experiment.mode}  ${experiment.name}`));
                return 0;
            }
            const experimentId = argv[1];
            if (!experimentId || experimentId.startsWith('-'))
                throw new Error(`experiment ${action} 必须提供 EXPERIMENT_ID。`);
            if (action === 'inspect') {
                const inspected = inspectPl3Experiment(store, experimentId);
                printDataValue(asJson ? inspected : [
                    `实验: ${inspected.experiment.experimentId}`,
                    `  名称: ${inspected.experiment.name}`,
                    `  状态: ${inspected.experiment.status}`,
                    `  模式: ${inspected.experiment.mode}`,
                    `  Dataset snapshot: ${inspected.experiment.datasetSnapshotId}`,
                    `  已完成折: ${inspected.folds.filter((fold) => fold.status === 'complete').length}`,
                    `  审计记录: ${inspected.audit.length}`,
                    `  报告: ${inspected.experiment.reportPath || '尚未生成'}`,
                ].join('\n'), asJson);
                return 0;
            }
            if (action === 'run' || action === 'resume') {
                const current = store.getExperiment(experimentId);
                if (!current)
                    throw new Error(`排列3实验不存在: ${experimentId}`);
                if (action === 'resume' && current.status !== 'interrupted') {
                    throw new Error(`experiment resume 只接受 interrupted 状态，当前为 ${current.status}。`);
                }
                const result = await runPl3Experiment(store, experimentId);
                printDataValue(asJson ? result : [
                    `实验开发区运行完成: ${experimentId}`,
                    `  报告: ${result.reportPath}`,
                    `  报告哈希: ${result.reportHash}`,
                ].join('\n'), asJson);
                return 0;
            }
            if (action === 'report') {
                const result = await generatePl3ExperimentReport(store, experimentId);
                printDataValue(asJson ? result : [
                    `实验报告已生成: ${result.reportPath}`,
                    `  Markdown: ${result.markdownPath}`,
                    `  报告哈希: ${result.reportHash}`,
                ].join('\n'), asJson);
                return 0;
            }
            if (action === 'evaluate') {
                if (!argv.includes('--frozen') || !argv.includes('--confirm')) {
                    throw new Error('冻结评估必须同时提供 --frozen 和 --confirm。');
                }
                const result = await evaluatePl3ExperimentFrozen(store, experimentId);
                printDataValue(asJson ? result : [
                    `冻结区评估完成: ${experimentId}`,
                    `  报告: ${result.reportPath}`,
                    `  报告哈希: ${result.reportHash}`,
                ].join('\n'), asJson);
                return 0;
            }
            throw new Error(`未知 experiment 子命令: ${action}`);
        }
        finally {
            store.close();
        }
    }
    catch (error) {
        console.error(`排列3实验操作失败: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
};
const runStartupMenu = async () => {
    console.log(MENU_TEXT);
    if (!canShowInteractiveMenu()) {
        console.log('\n当前为非交互环境，请追加 --help 查看完整帮助。');
        return 0;
    }
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    try {
        const selection = (await rl.question('\n请输入数字：')).trim();
        console.log('');
        switch (selection) {
            case '1':
                console.log(TOKEN_TEXT);
                return 0;
            case '2':
                return promptForConfig();
            case '3':
                return printConfigSnippet();
            case '4':
                return runDoctor();
            case '5':
                return runServe();
            case '6':
                return runPredictionMenu();
            case '7':
                return runSyncCommand(['--source', 'official']);
            case '0':
                console.log('已退出。');
                return 0;
            default:
                console.error(`无效选择: ${selection || '(空)'}`);
                return 1;
        }
    }
    finally {
        rl.close();
    }
};
const args = process.argv.slice(2);
const command = args[0];
const main = async () => {
    if (shouldShowBanner(command)) {
        process.stdout.write(renderNbcpBanner());
    }
    if (!command) {
        return runStartupMenu();
    }
    if (command === '--help' || command === '-h') {
        console.log(HELP_TEXT);
        return 0;
    }
    if (command === 'serve') {
        return runServe();
    }
    if (command === 'init') {
        return promptForConfig(args.slice(1));
    }
    if (command === 'doctor') {
        return runDoctor(args.slice(1));
    }
    if (command === 'login') {
        console.log(TOKEN_TEXT);
        return 0;
    }
    if (command === 'analyze') {
        return runPredictionCommand(args.slice(1), true);
    }
    if (command === 'predict') {
        return runPredictionCommand(args.slice(1));
    }
    if (command === 'sync') {
        return runSyncCommand(args.slice(1));
    }
    if (command === 'data') {
        return runDataCommand(args.slice(1));
    }
    if (command === 'experiment') {
        return runExperimentCommand(args.slice(1));
    }
    console.error(`未知命令: ${command}`);
    console.log(HELP_TEXT);
    return 1;
};
try {
    const exitCode = await main();
    process.exitCode = exitCode;
}
catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
