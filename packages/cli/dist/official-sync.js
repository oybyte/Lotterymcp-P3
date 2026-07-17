import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizePl3Records, settlePl3Predictions, writeJsonAtomically, } from 'lotterymcp-core';
const OFFICIAL_PL3 = {
    gameNo: '35',
    fallbackLotteryId: '283',
    fallbackSourceUrl: 'https://www.zhcw.com/kjxx/pl3/',
    sourceUrl: 'https://www.lottery.gov.cn/zst/pls/',
    referer: 'https://www.lottery.gov.cn/',
};
const DEFAULT_DATA_DIR = '.lotterymcp-data';
const MAX_LIMIT = 1000;
const PAGE_SIZE = 30;
const PAGE_DELAY_MS = 300;
const normalizeLimit = (value) => Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), MAX_LIMIT) : 500;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const splitNumbers = (value) => String(value || '')
    .trim()
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((item) => Number(item));
export const parseJsonOrJsonp = (rawText) => {
    const trimmed = rawText.trim();
    const jsonText = trimmed.startsWith('{') || trimmed.startsWith('[')
        ? trimmed
        : trimmed.replace(/^[^(]*\(/, '').replace(/\);\s*$/, '').replace(/\)\s*$/, '');
    return JSON.parse(jsonText);
};
const fetchPayload = async (url, referer, fetchImpl) => {
    const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
            accept: 'application/json,text/plain,*/*',
            referer,
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
        },
    });
    const rawText = await response.text();
    if (!response.ok) {
        throw new Error(`公开数据请求失败: HTTP ${response.status} ${response.statusText} (${url.toString()})`);
    }
    try {
        return parseJsonOrJsonp(rawText);
    }
    catch {
        throw new Error(`公开数据返回了无法解析的内容 (${url.toString()})`);
    }
};
const normalizeSportteryRows = (payload) => {
    const rows = Array.isArray(payload?.value?.list) ? payload.value.list : [];
    return rows.map((row) => {
        const numbersList = splitNumbers(row.lotteryDrawResult);
        return {
            lotteryType: 'pl3',
            period: String(row.lotteryDrawNum || ''),
            drawDate: String(row.lotteryDrawTime || row.lotteryDrawDate || '').slice(0, 10),
            numbers: numbersList.join(','),
            numbersList,
            source: 'official',
            sourceUrl: OFFICIAL_PL3.sourceUrl,
            rawProvider: 'sporttery',
        };
    });
};
const normalizeZhcwRows = (payload) => {
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return rows.map((row) => {
        const numbersList = [...splitNumbers(row.frontWinningNum), ...splitNumbers(row.backWinningNum)];
        return {
            lotteryType: 'pl3',
            period: String(row.issue || ''),
            drawDate: String(row.openTime || '').slice(0, 10),
            numbers: numbersList.join(','),
            numbersList,
            source: 'official',
            sourceUrl: OFFICIAL_PL3.fallbackSourceUrl,
            rawProvider: 'zhcw',
        };
    });
};
const validateSyncRecords = (records) => {
    const sourceByPeriod = new Map();
    records.forEach((record) => sourceByPeriod.set(String(record.period || '').trim(), record));
    return normalizePl3Records(records).map((record) => {
        const source = sourceByPeriod.get(record.period);
        return {
            ...record,
            ...(typeof source?.source === 'string' ? { source: source.source } : {}),
            ...(typeof source?.sourceUrl === 'string' ? { sourceUrl: source.sourceUrl } : {}),
            ...(typeof source?.rawProvider === 'string' ? { rawProvider: source.rawProvider } : {}),
        };
    });
};
const fetchPaginated = async (limit, fetchPage, pageDelayMs) => {
    const records = [];
    const fingerprints = new Set();
    let page = 1;
    while (records.length < limit) {
        const pageSize = PAGE_SIZE;
        const pageRecords = await fetchPage(page, pageSize);
        if (pageRecords.length === 0)
            break;
        const fingerprint = pageRecords.map((record) => record.period).join('|');
        if (fingerprints.has(fingerprint)) {
            throw new Error(`公开数据源在第 ${page} 页返回了重复页面`);
        }
        fingerprints.add(fingerprint);
        records.push(...pageRecords);
        if (pageRecords.length < pageSize)
            break;
        page += 1;
        if (records.length < limit && pageDelayMs > 0)
            await delay(pageDelayMs);
    }
    return records.slice(0, limit);
};
const fetchSportteryRecords = async (limit, fetchImpl) => {
    const baseUrl = process.env.LOTTERYMCP_SPORTTERY_API_URL ||
        'https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry';
    return fetchPaginated(limit, async (page, pageSize) => {
        const url = new URL(baseUrl);
        url.search = new URLSearchParams({
            gameNo: OFFICIAL_PL3.gameNo,
            provinceId: '0',
            pageSize: String(pageSize),
            isVerify: '1',
            pageNo: String(page),
        }).toString();
        return normalizeSportteryRows(await fetchPayload(url, OFFICIAL_PL3.referer, fetchImpl));
    }, fetchImpl === fetch ? PAGE_DELAY_MS : 0);
};
const fetchZhcwRecords = async (limit, fetchImpl) => {
    const baseUrl = process.env.LOTTERYMCP_ZHCW_API_URL || 'https://jc.zhcw.com/port/client_json.php';
    return fetchPaginated(limit, async (page, pageSize) => {
        const url = new URL(baseUrl);
        url.search = new URLSearchParams({
            transactionType: '10001001',
            lotteryId: OFFICIAL_PL3.fallbackLotteryId,
            issueCount: String(limit),
            startIssue: '',
            endIssue: '',
            startDate: '',
            endDate: '',
            type: '0',
            pageNum: String(page),
            pageSize: String(pageSize),
            callback: 'callback',
        }).toString();
        return normalizeZhcwRows(await fetchPayload(url, OFFICIAL_PL3.fallbackSourceUrl, fetchImpl));
    }, fetchImpl === fetch ? PAGE_DELAY_MS : 0);
};
export const fetchOfficialPl3Records = async (limit, fetchImpl = fetch) => {
    const normalizedLimit = normalizeLimit(limit);
    let primaryError;
    try {
        const records = await fetchSportteryRecords(normalizedLimit, fetchImpl);
        if (records.length === 0)
            throw new Error('中国体彩网没有返回可用记录');
        return validateSyncRecords(records).reverse();
    }
    catch (error) {
        primaryError = error;
    }
    try {
        const records = await fetchZhcwRecords(normalizedLimit, fetchImpl);
        if (records.length === 0)
            throw new Error('中彩网没有返回可用记录');
        return validateSyncRecords(records).reverse();
    }
    catch (fallbackError) {
        throw new Error(`排列3公开数据源均不可用。体彩网: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}；` +
            `中彩网: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
    }
};
const readExistingRecords = async (outputPath) => {
    try {
        const parsed = JSON.parse(await readFile(outputPath, 'utf8'));
        return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.records) ? parsed.records : [];
    }
    catch (error) {
        if (error?.code === 'ENOENT')
            return [];
        throw new Error(`现有排列3缓存格式无效: ${outputPath}`);
    }
};
const mergeRecords = (existing, incoming, limit) => {
    const sourceByPeriod = new Map();
    for (const record of [...existing, ...incoming]) {
        sourceByPeriod.set(String(record.period || ''), record);
    }
    const normalized = validateSyncRecords([...sourceByPeriod.values()]).slice(-limit).reverse();
    return normalized.map((record) => {
        const source = sourceByPeriod.get(record.period);
        return {
            ...record,
            source: String(source?.source || 'official'),
            sourceUrl: String(source?.sourceUrl || OFFICIAL_PL3.sourceUrl),
            rawProvider: String(source?.rawProvider || 'import'),
        };
    });
};
const writeCache = async (dataDir, incoming, limit, sourceUrl) => {
    const normalizedLimit = normalizeLimit(limit);
    const resolvedDataDir = path.resolve(dataDir || DEFAULT_DATA_DIR);
    const outputPath = path.join(resolvedDataDir, 'pl3.json');
    const existing = await readExistingRecords(outputPath);
    const records = mergeRecords(existing, incoming, normalizedLimit);
    const warnings = records.length < normalizedLimit
        ? [`请求 ${normalizedLimit} 期，当前有效缓存为 ${records.length} 期。`]
        : [];
    await writeJsonAtomically(outputPath, {
        provider: 'official',
        lotteryType: 'pl3',
        sourceUrl,
        generatedAt: new Date().toISOString(),
        recordCount: records.length,
        latestPeriod: records[0]?.period || null,
        records,
    });
    const settlement = await settlePl3Predictions(path.join(resolvedDataDir, 'pl3-predictions.json'), records);
    return {
        lotteryType: 'pl3',
        records,
        outputPath,
        sourceUrl,
        warnings,
        settledCount: settlement.settledCount,
    };
};
export const syncOfficialPl3 = async (options) => {
    const records = await fetchOfficialPl3Records(options.limit, options.fetchImpl);
    const sourceUrl = String(records[0]?.sourceUrl || OFFICIAL_PL3.sourceUrl);
    return writeCache(options.dataDir, records, options.limit, sourceUrl);
};
export const syncOfficialFile = async (options) => {
    const filePath = path.resolve(options.filePath);
    let parsed;
    try {
        parsed = JSON.parse(await readFile(filePath, 'utf8'));
    }
    catch (error) {
        throw new Error(`无法读取排列3 JSON 文件: ${filePath} (${error instanceof Error ? error.message : String(error)})`);
    }
    const records = Array.isArray(parsed) ? parsed : parsed?.records;
    if (!Array.isArray(records))
        throw new Error('导入文件必须是记录数组或包含 records 数组的对象。');
    validateSyncRecords(records);
    return writeCache(options.dataDir, records, options.limit, filePath);
};
