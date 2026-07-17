import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PL3_DEFAULT_PERIODS, PL3_MAX_PERIODS, PL3_MIN_RECORDS, Pl3PredictionError, getPl3PredictionLedgerSummary, predictPl3, settlePl3Predictions, upsertPl3Prediction, } from './pl3-prediction.js';
export * from './pl3-prediction.js';
export const LOTTERY_MCP_PROVIDER = 'remote';
export const LOTTERY_MCP_TOOLS = [
    'lottery.latest',
    'lottery.history',
    'lottery.periods',
    'lottery.summary',
];
export class McpApiError extends Error {
    statusCode;
    code;
    upgradeUrl;
    displayMode;
    action;
    data;
    constructor(input) {
        super(input.message);
        this.name = 'McpApiError';
        this.statusCode = input.statusCode;
        this.code = input.code;
        this.upgradeUrl = input.upgradeUrl;
        this.displayMode = input.displayMode;
        this.action = input.action;
        this.data = input.data;
    }
}
const DEFAULT_PERIODS = '100';
const DEFAULT_DATA_DIR = '.lotterymcp-data';
export const SUPPORTED_LOTTERY_TYPE = 'pl3';
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_BASE_DELAY_MS = 1000;
const RATE_LIMIT_MAX_DELAY_MS = 5000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const getRateLimitDelayMs = (response, attempt) => {
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) {
        const parsed = Number(retryAfter);
        if (Number.isFinite(parsed) && parsed >= 0) {
            return Math.min(parsed * 1000, RATE_LIMIT_MAX_DELAY_MS);
        }
    }
    return Math.min(RATE_LIMIT_BASE_DELAY_MS * 2 ** Math.max(attempt - 1, 0), RATE_LIMIT_MAX_DELAY_MS);
};
export const normalizeApiBaseUrl = (value) => String(value || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api\/v1\/mcp$/i, '')
    .replace(/\/api\/v1$/i, '')
    .replace(/\/api$/i, '');
const buildSearchParams = (query) => {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(query || {})) {
        if (value === undefined || value === null || value === '') {
            continue;
        }
        searchParams.set(key, String(value));
    }
    return searchParams;
};
const parseJsonSafely = (rawText) => {
    if (!rawText) {
        return {};
    }
    try {
        return JSON.parse(rawText);
    }
    catch {
        return {
            message: rawText,
        };
    }
};
const createApiError = (statusCode, payload) => new McpApiError({
    statusCode,
    message: String(payload?.message || '网站接口请求失败'),
    code: typeof payload?.code === 'string' ? payload.code : undefined,
    upgradeUrl: typeof payload?.upgradeUrl === 'string' ? payload.upgradeUrl : undefined,
    displayMode: typeof payload?.displayMode === 'string' ? payload.displayMode : undefined,
    action: payload?.action && typeof payload.action === 'object'
        ? payload.action
        : undefined,
    data: payload,
});
const normalizeDataMode = (value) => String(value || '').trim().toLowerCase() === 'official' ? 'official' : 'remote';
export const normalizeLotteryType = (value = SUPPORTED_LOTTERY_TYPE) => {
    const lotteryType = String(value || SUPPORTED_LOTTERY_TYPE).trim().toLowerCase();
    if (lotteryType !== SUPPORTED_LOTTERY_TYPE) {
        throw new McpApiError({
            statusCode: 400,
            code: 'LOTTERYMCP_ONLY_PL3_SUPPORTED',
            message: `当前版本只支持排列3(pl3)，不支持 ${lotteryType || '(空)'}。`,
        });
    }
    return SUPPORTED_LOTTERY_TYPE;
};
const resolveOfficialDataDir = (value) => {
    const dataDir = String(value || DEFAULT_DATA_DIR).trim() || DEFAULT_DATA_DIR;
    return path.resolve(dataDir);
};
const normalizeLimit = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};
const normalizePage = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
};
const readOfficialCache = async (dataDir, lotteryType) => {
    const normalizedLotteryType = normalizeLotteryType(lotteryType);
    const cachePath = path.join(dataDir, `${normalizedLotteryType}.json`);
    let rawText = '';
    try {
        rawText = await readFile(cachePath, 'utf8');
    }
    catch {
        throw new McpApiError({
            statusCode: 404,
            code: 'LOTTERYMCP_OFFICIAL_CACHE_MISSING',
            message: '未找到排列3(pl3)官方数据缓存，请先运行 lotterymcp sync --source official。',
            data: { cachePath },
        });
    }
    const parsed = parseJsonSafely(rawText);
    const records = Array.isArray(parsed) ? parsed : parsed?.records;
    if (!Array.isArray(records)) {
        throw new McpApiError({
            statusCode: 422,
            code: 'LOTTERYMCP_OFFICIAL_CACHE_INVALID',
            message: `${normalizedLotteryType} 的官方数据缓存格式无效。`,
            data: { cachePath },
        });
    }
    return records
        .map((record) => ({
        ...(record && typeof record === 'object' ? record : {}),
        lotteryType: String(record?.lotteryType || normalizedLotteryType),
        period: String(record?.period || ''),
        drawDate: String(record?.drawDate || ''),
        numbers: String(record?.numbers || ''),
        numbersList: Array.isArray(record?.numbersList)
            ? record.numbersList.map((item) => Number(item)).filter((item) => Number.isFinite(item))
            : String(record?.numbers || '')
                .split(/[,\s]+/)
                .filter(Boolean)
                .map((item) => Number(item))
                .filter((item) => Number.isFinite(item)),
    }))
        .filter((record) => record.period)
        .sort((a, b) => String(b.period).localeCompare(String(a.period)));
};
const filterOfficialRecords = (records, query) => {
    const period = String(query.period || '').trim();
    const fromDate = String(query.fromDate || '').trim();
    const toDate = String(query.toDate || '').trim();
    return records.filter((record) => {
        if (period && record.period !== period) {
            return false;
        }
        if (fromDate && record.drawDate && record.drawDate < fromDate) {
            return false;
        }
        if (toDate && record.drawDate && record.drawDate > toDate) {
            return false;
        }
        return true;
    });
};
export const createOfficialLocalProvider = (config = {}) => {
    const dataDir = resolveOfficialDataDir(config.dataDir);
    const fallbackLimit = normalizeLimit(config.defaultPeriods, Number(DEFAULT_PERIODS));
    const createMeta = (extra = {}) => ({
        plan: 'public',
        provider: 'official',
        apiKeyUsed: false,
        requestLimit: null,
        generatedAt: new Date().toISOString(),
        ...extra,
    });
    return {
        getHealth: async () => ({
            ok: true,
            service: 'lotterymcp-official-local',
            transport: 'local-json',
            provider: 'official',
            dataDir,
            tools: [...LOTTERY_MCP_TOOLS],
        }),
        getLatest: async (query) => {
            const records = await readOfficialCache(dataDir, query.lotteryType || SUPPORTED_LOTTERY_TYPE);
            return {
                data: records[0] || null,
                meta: createMeta(),
            };
        },
        getHistory: async (query) => {
            const lotteryType = normalizeLotteryType(query.lotteryType);
            const records = filterOfficialRecords(await readOfficialCache(dataDir, lotteryType), query);
            const page = normalizePage(query.page);
            const limit = normalizeLimit(query.limit, fallbackLimit);
            const offset = (page - 1) * limit;
            const data = records.slice(offset, offset + limit);
            return {
                data,
                meta: createMeta({
                    page,
                    limit,
                    total: records.length,
                    hasMore: offset + data.length < records.length,
                }),
            };
        },
        getPeriods: async (query) => {
            const records = await readOfficialCache(dataDir, query.lotteryType || SUPPORTED_LOTTERY_TYPE);
            const page = normalizePage(query.page);
            const limit = normalizeLimit(query.limit, fallbackLimit);
            const offset = (page - 1) * limit;
            const periods = records.map((record) => ({
                lotteryType: record.lotteryType,
                period: record.period,
                drawDate: record.drawDate,
            }));
            const data = periods.slice(offset, offset + limit);
            return {
                data,
                meta: createMeta({
                    page,
                    limit,
                    total: periods.length,
                    hasMore: offset + data.length < periods.length,
                }),
            };
        },
        getSummary: async (query) => {
            const lotteryType = normalizeLotteryType(query.lotteryType);
            const records = await readOfficialCache(dataDir, lotteryType);
            return {
                data: {
                    lotteryType,
                    total: records.length,
                    latestPeriod: records[0]?.period || null,
                    latestDrawDate: records[0]?.drawDate || null,
                    dataDir,
                },
                meta: createMeta(),
            };
        },
    };
};
export const formatMcpApiError = (error) => {
    if (!(error instanceof McpApiError)) {
        return error instanceof Error ? error.message : String(error);
    }
    const lines = [error.message];
    if (error.statusCode === 429) {
        lines.push('建议先稍后重试，或降低默认期数/调用频率后再试。');
    }
    if (error.code) {
        lines.push(`错误代码: ${error.code}`);
    }
    if (error.action?.url) {
        lines.push(`处理链接: ${error.action.url}`);
    }
    else if (error.upgradeUrl) {
        lines.push(`升级页面: ${error.upgradeUrl}`);
    }
    return lines.join('\n');
};
export const createLotteryMcpClient = (config) => {
    if (normalizeDataMode(config.dataMode) === 'official') {
        const provider = createOfficialLocalProvider(config);
        return {
            apiBaseUrl: '',
            token: '',
            defaultPeriods: String(config.defaultPeriods || DEFAULT_PERIODS).trim() || DEFAULT_PERIODS,
            ...provider,
        };
    }
    const apiBaseUrl = normalizeApiBaseUrl(config.apiBaseUrl);
    const token = String(config.token || '').trim();
    const defaultPeriods = String(config.defaultPeriods || DEFAULT_PERIODS).trim() || DEFAULT_PERIODS;
    const fetchImpl = config.fetchImpl || fetch;
    const request = async (path, query) => {
        if (!apiBaseUrl) {
            throw new McpApiError({
                statusCode: 400,
                code: 'NBCP_CONFIG_MISSING_API_BASE_URL',
                message: '未配置 API_BASE_URL',
            });
        }
        const url = new URL(`/api/v1/mcp/${path.replace(/^\/+/, '')}`, `${apiBaseUrl}/`);
        url.search = buildSearchParams(query).toString();
        let response;
        for (let attempt = 1; attempt <= RATE_LIMIT_RETRIES + 1; attempt += 1) {
            try {
                response = await fetchImpl(url, {
                    method: 'GET',
                    headers: {
                        accept: 'application/json',
                        ...(token ? { 'x-api-key': token } : {}),
                    },
                });
            }
            catch (error) {
                throw new McpApiError({
                    statusCode: 503,
                    code: 'NBCP_NETWORK_ERROR',
                    message: error instanceof Error ? `无法连接网站接口: ${error.message}` : '无法连接网站接口',
                    data: error,
                });
            }
            if (response.status === 429 && attempt <= RATE_LIMIT_RETRIES) {
                await sleep(getRateLimitDelayMs(response, attempt));
                continue;
            }
            break;
        }
        if (!response) {
            throw new McpApiError({
                statusCode: 503,
                code: 'NBCP_NETWORK_ERROR',
                message: '无法连接网站接口',
            });
        }
        const rawText = await response.text();
        const payload = parseJsonSafely(rawText);
        if (!response.ok) {
            throw createApiError(response.status, payload);
        }
        return payload;
    };
    return {
        apiBaseUrl,
        token,
        defaultPeriods,
        getHealth: () => request('health'),
        getLatest: async (query) => request('lottery/latest', {
            ...query,
            lotteryType: normalizeLotteryType(query.lotteryType),
        }),
        getHistory: async (query) => request('lottery/history', {
            ...query,
            lotteryType: normalizeLotteryType(query.lotteryType),
        }),
        getPeriods: async (query) => request('lottery/periods', {
            ...query,
            lotteryType: normalizeLotteryType(query.lotteryType),
        }),
        getSummary: async (query) => request('lottery/summary', {
            ...query,
            lotteryType: normalizeLotteryType(query.lotteryType),
        }),
    };
};
const toPredictionApiError = (error) => {
    if (error instanceof McpApiError)
        return error;
    if (error instanceof Pl3PredictionError) {
        return new McpApiError({
            statusCode: error.code === 'LOTTERYMCP_PL3_INSUFFICIENT_DATA' ? 422 : 400,
            code: error.code,
            message: error.message,
            data: error.details,
        });
    }
    return error;
};
const resolvePredictionPeriods = (queryValue, defaultValue) => {
    const parsed = Number(queryValue ?? defaultValue ?? PL3_DEFAULT_PERIODS);
    if (!Number.isInteger(parsed) || parsed < PL3_MIN_RECORDS || parsed > PL3_MAX_PERIODS) {
        throw new McpApiError({
            statusCode: 400,
            code: 'LOTTERYMCP_PL3_INVALID_PERIODS',
            message: `排列3预测期数必须是 ${PL3_MIN_RECORDS}-${PL3_MAX_PERIODS} 的整数。`,
        });
    }
    return parsed;
};
export const createPl3PredictionService = (client, config = {}) => {
    const dataDir = resolveOfficialDataDir(config.dataDir);
    const ledgerPath = path.join(dataDir, 'pl3-predictions.json');
    const fetchHistory = async (periods) => {
        const records = [];
        const pageSize = Math.min(500, periods);
        let page = 1;
        let meta;
        while (records.length < periods) {
            const envelope = await client.getHistory({
                lotteryType: SUPPORTED_LOTTERY_TYPE,
                page,
                limit: Math.min(pageSize, periods - records.length),
            });
            const rows = Array.isArray(envelope.data) ? envelope.data : [];
            records.push(...rows);
            meta = envelope.meta;
            if (rows.length === 0 || !envelope.meta?.hasMore)
                break;
            page += 1;
        }
        return { records: records.slice(0, periods), meta };
    };
    const settleWithRecords = async (records) => {
        try {
            const result = await settlePl3Predictions(ledgerPath, records);
            return { settledCount: result.settledCount };
        }
        catch (error) {
            throw toPredictionApiError(error);
        }
    };
    return {
        ledgerPath,
        predict: async (query = {}) => {
            try {
                normalizeLotteryType(query.lotteryType);
                const periods = resolvePredictionPeriods(query.periods, config.defaultPeriods);
                const { records, meta } = await fetchHistory(periods);
                await settleWithRecords(records);
                const prediction = predictPl3(records, {
                    ...query,
                    lotteryType: SUPPORTED_LOTTERY_TYPE,
                    periods,
                    payouts: { ...(config.payouts || {}), ...(query.payouts || {}) },
                });
                await upsertPl3Prediction(ledgerPath, prediction);
                return {
                    data: prediction,
                    meta: {
                        plan: meta?.plan || 'public',
                        provider: meta?.provider || 'remote',
                        apiKeyUsed: meta?.apiKeyUsed,
                        requestLimit: meta?.requestLimit ?? null,
                        generatedAt: prediction.generatedAt,
                        total: prediction.training.recordCount,
                    },
                };
            }
            catch (error) {
                throw toPredictionApiError(error);
            }
        },
        settle: async () => {
            const periods = resolvePredictionPeriods(config.defaultPeriods, PL3_DEFAULT_PERIODS);
            const { records } = await fetchHistory(periods);
            return settleWithRecords(records);
        },
        getLedgerSummary: () => getPl3PredictionLedgerSummary(ledgerPath),
    };
};
/** @deprecated Use createLotteryMcpClient instead. */
export const createLotteryApiClient = createLotteryMcpClient;
