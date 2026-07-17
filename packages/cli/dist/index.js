#!/usr/bin/env node
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { McpApiError, createLotteryMcpClient, createPl3PredictionService, formatMcpApiError, normalizePl3Records, writeJsonAtomically, } from 'lotterymcp-core';
import { MCP_SERVER_TOOLS, MCP_SERVER_TRANSPORT, startLotteryMcpStdioServer } from 'lotterymcp-server';
import { DEFAULT_API_BASE_URL, DEFAULT_PERIODS, getConfigPath, maskToken, renderMcpConfigSnippet, resolveConfig, saveLocalConfig, validateConfig, } from './config.js';
import { renderNbcpBanner, shouldShowBanner } from './banner.js';
import { syncOfficialFile, syncOfficialPl3 } from './official-sync.js';
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
    return existsSync(path.join(dataDir, 'pl3.json'));
};
const getOfficialCacheSummary = (dataDir) => {
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
    console.error(`未找到排列3官方数据缓存，请先运行 lotterymcp sync --source official。数据目录: ${dataDir}`);
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
        if (config.dataMode === 'official') {
            const cache = getOfficialCacheSummary(String(config.dataDir || '.lotterymcp-data'));
            if (!cache.valid) {
                console.error(`排列3缓存无效: ${cache.error || cache.cachePath}`);
                return 1;
            }
            console.log(`排列3缓存: ${cache.recordCount} 期，最新 ${cache.latestPeriod || '未知'}，更新 ${cache.generatedAt || '未知'}`);
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
