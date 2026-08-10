import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizePl3Records, openPl3Store, settlePl3Predictions, writeJsonAtomically, } from 'lotterymcp-core';
const OFFICIAL_PL3 = {
    gameNo: '35',
    fallbackLotteryId: '283',
    fallbackSourceUrl: 'https://www.zhcw.com/kjxx/pl3/',
    sourceUrl: 'https://www.lottery.gov.cn/zst/pls/',
    referer: 'https://www.lottery.gov.cn/',
};
const DEFAULT_DATA_DIR = '.lotterymcp-data';
const MAX_LIMIT = 1000;
const MAX_ARCHIVE_LIMIT = 10000;
const PAGE_SIZE = 30;
const PAGE_DELAY_MS = 300;
const normalizeLimit = (value) => Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), MAX_LIMIT) : 500;
const normalizeArchiveLimit = (value) => Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), MAX_ARCHIVE_LIMIT) : MAX_ARCHIVE_LIMIT;
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
        : trimmed
            .replace(/^[^(]*\(/, '')
            .replace(/\);\s*$/, '')
            .replace(/\)\s*$/, '');
    return JSON.parse(jsonText);
};
const fetchPayload = async (url, referer, fetchImpl, context, onResponse) => {
    const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
            accept: 'application/json,text/plain,*/*',
            referer,
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
        },
    });
    const rawText = await response.text();
    onResponse?.({
        ...context,
        url: url.toString(),
        statusCode: response.status,
        statusText: response.statusText,
        fetchedAt: new Date().toISOString(),
        contentType: response.headers.get('content-type'),
        rawText,
    });
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
    const value = payload?.value;
    const rows = Array.isArray(value?.list) ? value.list : [];
    return rows.map((entry) => {
        const row = (entry ?? {});
        const numbersList = splitNumbers(row.lotteryDrawResult);
        return {
            lotteryType: 'pl3',
            period: String(row.lotteryDrawNum ?? ''),
            drawDate: String(row.lotteryDrawTime ?? row.lotteryDrawDate ?? '').slice(0, 10),
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
    return rows.map((entry) => {
        const row = (entry ?? {});
        const numbersList = [...splitNumbers(row.frontWinningNum), ...splitNumbers(row.backWinningNum)];
        return {
            lotteryType: 'pl3',
            period: String(row.issue ?? ''),
            drawDate: String(row.openTime ?? '').slice(0, 10),
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
const fetchSportteryRecords = async (limit, fetchImpl, onResponse) => {
    const baseUrl = process.env.LOTTERYMCP_SPORTTERY_API_URL || 'https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry';
    let authoritativeTotal = null;
    const records = await fetchPaginated(limit, async (page, pageSize) => {
        const url = new URL(baseUrl);
        url.search = new URLSearchParams({
            gameNo: OFFICIAL_PL3.gameNo,
            provinceId: '0',
            pageSize: String(pageSize),
            isVerify: '1',
            pageNo: String(page),
        }).toString();
        const payload = await fetchPayload(url, OFFICIAL_PL3.referer, fetchImpl, { provider: 'lottery-gov-cn', page }, onResponse);
        const reportedTotal = Number(payload?.value?.total);
        if (Number.isInteger(reportedTotal) && reportedTotal > 0)
            authoritativeTotal = reportedTotal;
        return normalizeSportteryRows(payload);
    }, fetchImpl === fetch ? PAGE_DELAY_MS : 0);
    return { records, authoritativeTotal };
};
const fetchZhcwRecords = async (limit, fetchImpl, onResponse) => {
    const baseUrl = process.env.LOTTERYMCP_ZHCW_API_URL || 'https://jc.zhcw.com/port/client_json.php';
    let reportedTotal = null;
    const records = await fetchPaginated(limit, async (page, pageSize) => {
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
        const payload = await fetchPayload(url, OFFICIAL_PL3.fallbackSourceUrl, fetchImpl, { provider: 'zhcw', page }, onResponse);
        const total = Number(payload?.total);
        if (Number.isInteger(total) && total > 0)
            reportedTotal = total;
        return normalizeZhcwRows(payload);
    }, fetchImpl === fetch ? PAGE_DELAY_MS : 0);
    return {
        records,
        authoritativeTotal: reportedTotal !== null && reportedTotal < limit ? reportedTotal : null,
    };
};
export const fetchOfficialPl3Archive = async (limit, fetchImpl = fetch, provider = 'auto') => {
    const normalizedLimit = normalizeArchiveLimit(limit);
    const rawResponses = [];
    let primaryError;
    const normalizeArchiveRecords = (records) => {
        const normalized = validateSyncRecords(records).reverse();
        const warnings = normalized.length === records.length
            ? []
            : [
                `来源返回 ${records.length} 条记录，按期号规范化后为 ${normalized.length} 条，存在 ${records.length - normalized.length} 条重复或被合并记录。`,
            ];
        return { normalized, warnings };
    };
    if (provider === 'zhcw') {
        const result = await fetchZhcwRecords(normalizedLimit, fetchImpl, (response) => rawResponses.push(response));
        if (result.records.length === 0)
            throw new Error('中彩网没有返回可用记录');
        const normalized = normalizeArchiveRecords(result.records);
        return {
            records: normalized.normalized,
            provider: 'zhcw',
            sourceUrl: OFFICIAL_PL3.fallbackSourceUrl,
            authoritativeTotal: result.authoritativeTotal,
            rawResponses,
            warnings: normalized.warnings,
        };
    }
    try {
        const result = await fetchSportteryRecords(normalizedLimit, fetchImpl, (response) => rawResponses.push(response));
        if (result.records.length === 0)
            throw new Error('中国体彩网没有返回可用记录');
        const normalized = normalizeArchiveRecords(result.records);
        return {
            records: normalized.normalized,
            provider: 'lottery-gov-cn',
            sourceUrl: OFFICIAL_PL3.sourceUrl,
            authoritativeTotal: result.authoritativeTotal,
            rawResponses,
            warnings: normalized.warnings,
        };
    }
    catch (error) {
        primaryError = error;
        if (provider === 'lottery-gov-cn') {
            throw new Error(`中国体彩网排列3数据不可用: ${error instanceof Error ? error.message : String(error)}`, {
                cause: error,
            });
        }
    }
    try {
        const result = await fetchZhcwRecords(normalizedLimit, fetchImpl, (response) => rawResponses.push(response));
        if (result.records.length === 0)
            throw new Error('中彩网没有返回可用记录');
        const normalized = normalizeArchiveRecords(result.records);
        return {
            records: normalized.normalized,
            provider: 'zhcw',
            sourceUrl: OFFICIAL_PL3.fallbackSourceUrl,
            authoritativeTotal: result.authoritativeTotal,
            rawResponses,
            warnings: [
                `中国体彩网整批同步失败，已切换中彩网: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}`,
                ...normalized.warnings,
            ],
        };
    }
    catch (fallbackError) {
        throw new Error(`排列3公开数据源均不可用。体彩网: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}；` +
            `中彩网: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`, { cause: fallbackError });
    }
};
export const fetchOfficialPl3Records = async (limit, fetchImpl = fetch) => {
    const normalizedLimit = normalizeLimit(limit);
    return (await fetchOfficialPl3Archive(normalizedLimit, fetchImpl)).records;
};
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const writeBufferAtomically = async (outputPath, content) => {
    await mkdir(path.dirname(outputPath), { recursive: true });
    const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, content);
    try {
        await rename(temporaryPath, outputPath);
    }
    catch (error) {
        if (error?.code === 'EEXIST' && existsSync(outputPath)) {
            await import('node:fs/promises').then(({ unlink }) => unlink(temporaryPath).catch(() => undefined));
            return;
        }
        throw error;
    }
};
class CheckpointArchiveError extends Error {
    pages;
    checkpointPath;
    constructor(message, pages, checkpointPath, cause) {
        super(message, cause === undefined ? undefined : { cause });
        this.name = 'CheckpointArchiveError';
        this.pages = pages;
        this.checkpointPath = checkpointPath;
    }
}
const checkpointMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
const getProviderConfig = (provider) => provider === 'lottery-gov-cn'
    ? {
        sourceUrl: OFFICIAL_PL3.sourceUrl,
        apiUrl: process.env.LOTTERYMCP_SPORTTERY_API_URL ||
            'https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry',
        referer: OFFICIAL_PL3.referer,
    }
    : {
        sourceUrl: OFFICIAL_PL3.fallbackSourceUrl,
        apiUrl: process.env.LOTTERYMCP_ZHCW_API_URL || 'https://jc.zhcw.com/port/client_json.php',
        referer: OFFICIAL_PL3.fallbackSourceUrl,
    };
const buildProviderPageUrl = (provider, apiUrl, page, pageSize, limit) => {
    const url = new URL(apiUrl);
    url.search =
        provider === 'lottery-gov-cn'
            ? new URLSearchParams({
                gameNo: OFFICIAL_PL3.gameNo,
                provinceId: '0',
                pageSize: String(pageSize),
                isVerify: '1',
                pageNo: String(page),
            }).toString()
            : new URLSearchParams({
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
    return url;
};
const persistCheckpointRawResponse = async (dataDir, response) => {
    const contentHash = sha256(response.rawText);
    const relativePath = path
        .join('raw', response.provider, response.fetchedAt.slice(0, 4), `${contentHash}.json.gz`)
        .replaceAll('\\', '/');
    const outputPath = path.join(dataDir, relativePath);
    if (!existsSync(outputPath)) {
        await writeBufferAtomically(outputPath, gzipSync(Buffer.from(response.rawText, 'utf8')));
    }
    return { contentHash, relativePath };
};
const archiveCheckpoint = async (checkpointPath, reason) => {
    if (!existsSync(checkpointPath))
        return;
    const archivedPath = `${checkpointPath}.${reason}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await rename(checkpointPath, archivedPath);
};
const loadCheckpoint = async (checkpointPath, expected) => {
    if (!existsSync(checkpointPath))
        return null;
    try {
        const checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8'));
        const updatedAt = new Date(checkpoint.updatedAt).getTime();
        const matches = checkpoint.schemaVersion === 1 &&
            checkpoint.requestHash === expected.requestHash &&
            checkpoint.provider === expected.provider &&
            checkpoint.sourceUrl === expected.sourceUrl &&
            checkpoint.apiUrl === expected.apiUrl &&
            checkpoint.limit === expected.limit &&
            checkpoint.pageSize === expected.pageSize &&
            Number.isFinite(updatedAt) &&
            Date.now() - updatedAt <= checkpointMaxAgeMs &&
            Array.isArray(checkpoint.pages) &&
            Array.isArray(checkpoint.fingerprints);
        if (!matches) {
            await archiveCheckpoint(checkpointPath, 'stale');
            return null;
        }
        for (const page of checkpoint.pages) {
            if (page.parseStatus === 'parsed')
                validateSyncRecords(page.records);
        }
        return checkpoint;
    }
    catch {
        await archiveCheckpoint(checkpointPath, 'invalid');
        return null;
    }
};
const saveCheckpoint = async (checkpointPath, checkpoint) => {
    checkpoint.updatedAt = new Date().toISOString();
    await writeJsonAtomically(checkpointPath, checkpoint);
};
const fetchProviderArchiveWithCheckpoint = async (input) => {
    const config = getProviderConfig(input.provider);
    const requestHash = sha256(JSON.stringify({
        provider: input.provider,
        sourceUrl: config.sourceUrl,
        apiUrl: config.apiUrl,
        limit: input.limit,
        pageSize: PAGE_SIZE,
    }));
    const checkpointPath = path.join(input.dataDir, 'raw', 'checkpoints', `${input.provider}-${requestHash}.json`);
    if (input.restart)
        await unlink(checkpointPath).catch(() => undefined);
    const resumed = input.resume && !input.restart
        ? await loadCheckpoint(checkpointPath, {
            requestHash,
            provider: input.provider,
            sourceUrl: config.sourceUrl,
            apiUrl: config.apiUrl,
            limit: input.limit,
            pageSize: PAGE_SIZE,
        })
        : null;
    const checkpoint = resumed || {
        schemaVersion: 1,
        requestHash,
        provider: input.provider,
        sourceUrl: config.sourceUrl,
        apiUrl: config.apiUrl,
        limit: input.limit,
        pageSize: PAGE_SIZE,
        nextPage: 1,
        authoritativeTotal: null,
        pages: [],
        fingerprints: [],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    const resumedPageCount = checkpoint.pages.filter((page) => page.parseStatus === 'parsed').length;
    const fingerprints = new Set(checkpoint.fingerprints);
    let acceptedCount = checkpoint.pages
        .filter((page) => page.parseStatus === 'parsed')
        .reduce((total, page) => total + page.records.length, 0);
    try {
        while (acceptedCount < input.limit) {
            const pageNumber = checkpoint.nextPage;
            const url = buildProviderPageUrl(input.provider, config.apiUrl, pageNumber, PAGE_SIZE, input.limit);
            let rawResponse;
            let payload;
            try {
                payload = await fetchPayload(url, config.referer, input.fetchImpl, { provider: input.provider, page: pageNumber }, (response) => {
                    rawResponse = response;
                });
            }
            catch (error) {
                if (rawResponse) {
                    const raw = await persistCheckpointRawResponse(input.dataDir, rawResponse);
                    checkpoint.pages.push({
                        provider: input.provider,
                        page: pageNumber,
                        sourceUrl: config.sourceUrl,
                        fetchedAt: rawResponse.fetchedAt,
                        statusCode: rawResponse.statusCode,
                        contentHash: raw.contentHash,
                        rawPath: raw.relativePath,
                        parseStatus: 'failed',
                        records: [],
                        metadata: { requestUrl: rawResponse.url, error: error instanceof Error ? error.message : String(error) },
                        fingerprint: null,
                        statusText: rawResponse.statusText,
                        contentType: rawResponse.contentType,
                    });
                    await saveCheckpoint(checkpointPath, checkpoint);
                }
                throw error;
            }
            const raw = await persistCheckpointRawResponse(input.dataDir, rawResponse);
            let pageRecords;
            let fingerprint;
            try {
                const pageSourceRecords = input.provider === 'lottery-gov-cn' ? normalizeSportteryRows(payload) : normalizeZhcwRows(payload);
                pageRecords = validateSyncRecords(pageSourceRecords);
                fingerprint = pageRecords.map((record) => record.period).join('|');
                if (pageRecords.length > 0 && fingerprints.has(fingerprint)) {
                    throw new Error(`公开数据源在第 ${pageNumber} 页返回了重复页面`);
                }
            }
            catch (error) {
                checkpoint.pages.push({
                    provider: input.provider,
                    page: pageNumber,
                    sourceUrl: config.sourceUrl,
                    fetchedAt: rawResponse.fetchedAt,
                    statusCode: rawResponse.statusCode,
                    contentHash: raw.contentHash,
                    rawPath: raw.relativePath,
                    parseStatus: 'failed',
                    records: [],
                    metadata: { requestUrl: rawResponse.url, error: error instanceof Error ? error.message : String(error) },
                    fingerprint: null,
                    statusText: rawResponse.statusText,
                    contentType: rawResponse.contentType,
                });
                await saveCheckpoint(checkpointPath, checkpoint);
                throw error;
            }
            const remaining = input.limit - acceptedCount;
            const acceptedRecords = pageRecords.slice(0, remaining);
            checkpoint.pages.push({
                provider: input.provider,
                page: pageNumber,
                sourceUrl: config.sourceUrl,
                fetchedAt: rawResponse.fetchedAt,
                statusCode: rawResponse.statusCode,
                contentHash: raw.contentHash,
                rawPath: raw.relativePath,
                parseStatus: 'parsed',
                records: acceptedRecords,
                metadata: { requestUrl: rawResponse.url, contentType: rawResponse.contentType },
                fingerprint,
                statusText: rawResponse.statusText,
                contentType: rawResponse.contentType,
            });
            if (fingerprint) {
                fingerprints.add(fingerprint);
                checkpoint.fingerprints.push(fingerprint);
            }
            const totals = (payload ?? {});
            const reportedTotal = Number(input.provider === 'lottery-gov-cn' ? totals.value?.total : totals.total);
            if (Number.isInteger(reportedTotal) && reportedTotal > 0) {
                checkpoint.authoritativeTotal =
                    input.provider === 'lottery-gov-cn' || reportedTotal < input.limit ? reportedTotal : null;
            }
            acceptedCount += acceptedRecords.length;
            checkpoint.nextPage = pageNumber + 1;
            await saveCheckpoint(checkpointPath, checkpoint);
            if (pageRecords.length === 0 || pageRecords.length < PAGE_SIZE)
                break;
            if (acceptedCount < input.limit && input.fetchImpl === fetch)
                await delay(PAGE_DELAY_MS);
        }
        const sourceRecords = checkpoint.pages
            .filter((page) => page.parseStatus === 'parsed')
            .flatMap((page) => page.records);
        if (sourceRecords.length === 0)
            throw new Error(`${config.sourceUrl} 没有返回可用记录`);
        const normalizedRecords = validateSyncRecords(sourceRecords).reverse();
        const warnings = normalizedRecords.length === sourceRecords.length
            ? []
            : [`来源返回 ${sourceRecords.length} 条记录，按期号规范化后为 ${normalizedRecords.length} 条。`];
        return {
            records: normalizedRecords,
            provider: input.provider,
            sourceUrl: config.sourceUrl,
            authoritativeTotal: checkpoint.authoritativeTotal,
            pages: checkpoint.pages,
            checkpointPath,
            resumedPageCount,
            warnings,
        };
    }
    catch (error) {
        throw new CheckpointArchiveError(`${input.provider} 同步失败: ${error instanceof Error ? error.message : String(error)}`, checkpoint.pages, checkpointPath, error);
    }
};
const persistCheckpointManifest = async (dataDir, pages) => {
    const entries = pages.map((page) => ({
        provider: page.provider,
        page: page.page,
        sourceUrl: page.sourceUrl,
        fetchedAt: page.fetchedAt,
        statusCode: page.statusCode,
        parseStatus: page.parseStatus,
        contentHash: page.contentHash,
        rawPath: page.rawPath,
    }));
    const aggregateHash = sha256(JSON.stringify(entries.map((item) => item.contentHash)));
    const relativePath = path.join('raw', 'manifests', `${aggregateHash}.json`).replaceAll('\\', '/');
    const manifestPath = path.join(dataDir, relativePath);
    await writeJsonAtomically(manifestPath, {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        aggregateHash,
        responses: entries,
    });
    return { aggregateHash, manifestPath, relativePath };
};
export const syncOfficialPl3ToStore = async (options) => {
    const resolvedDataDir = path.resolve(options.dataDir || DEFAULT_DATA_DIR);
    const requestedLimit = options.full ? MAX_ARCHIVE_LIMIT : normalizeArchiveLimit(options.limit);
    const fetchImpl = options.fetchImpl || fetch;
    const requestedProvider = options.provider || 'auto';
    const resume = options.resume !== false;
    const restart = Boolean(options.restart);
    let archive;
    const discardedPages = [];
    let primaryWarning;
    if (requestedProvider === 'auto') {
        try {
            archive = await fetchProviderArchiveWithCheckpoint({
                dataDir: resolvedDataDir,
                provider: 'lottery-gov-cn',
                limit: requestedLimit,
                fetchImpl,
                resume,
                restart,
            });
        }
        catch (error) {
            if (error instanceof CheckpointArchiveError)
                discardedPages.push(...error.pages);
            primaryWarning = `中国体彩网整批同步失败，已切换中彩网: ${error instanceof Error ? error.message : String(error)}`;
            archive = await fetchProviderArchiveWithCheckpoint({
                dataDir: resolvedDataDir,
                provider: 'zhcw',
                limit: requestedLimit,
                fetchImpl,
                resume,
                restart,
            });
        }
    }
    else {
        archive = await fetchProviderArchiveWithCheckpoint({
            dataDir: resolvedDataDir,
            provider: requestedProvider,
            limit: requestedLimit,
            fetchImpl,
            resume,
            restart,
        });
    }
    const raw = await persistCheckpointManifest(resolvedDataDir, archive.pages);
    const store = openPl3Store({ dataDir: resolvedDataDir });
    try {
        if (discardedPages.length > 0)
            store.recordArchivePages(discardedPages);
        const imported = store.importArchivePages(archive.pages, {
            authoritativeTotal: archive.authoritativeTotal || undefined,
        });
        const status = store.getStatus();
        const records = store
            .getRecords({ page: 1, limit: Math.max(status.usableRecords, 1) })
            .map((record) => ({
            lotteryType: record.lotteryType,
            period: record.period,
            drawDate: record.drawDate,
            numbers: record.numbers,
            numbersList: record.numbersList,
            source: 'official',
            sourceUrl: record.sourceUrl,
            rawProvider: record.provider,
        }));
        const settlement = await settlePl3Predictions(path.join(resolvedDataDir, 'pl3-predictions.json'), records);
        const warnings = [...(primaryWarning ? [primaryWarning] : []), ...archive.warnings];
        if (archive.records.length < requestedLimit && archive.authoritativeTotal === null) {
            warnings.push(`请求最多 ${requestedLimit} 期，来源返回 ${archive.records.length} 期，权威完整率仍为 unknown。`);
        }
        try {
            await unlink(archive.checkpointPath);
        }
        catch (error) {
            if (error?.code !== 'ENOENT')
                warnings.push(`同步成功，但无法删除 checkpoint: ${archive.checkpointPath}`);
        }
        return {
            lotteryType: 'pl3',
            records,
            outputPath: store.databasePath,
            databasePath: store.databasePath,
            sourceUrl: archive.sourceUrl,
            provider: archive.provider,
            authoritativeTotal: archive.authoritativeTotal,
            warnings,
            settledCount: settlement.settledCount,
            rawResponseCount: archive.pages.length,
            rawManifestPath: raw.manifestPath,
            confirmedRecords: imported.confirmedRecords,
            singleSourceRecords: imported.singleSourceRecords,
            conflictRecords: imported.conflictRecords,
            checkpointPath: archive.checkpointPath,
            resumedPageCount: archive.resumedPageCount,
        };
    }
    finally {
        store.close();
    }
};
const readExistingRecords = async (outputPath) => {
    try {
        const parsed = JSON.parse(await readFile(outputPath, 'utf8'));
        if (Array.isArray(parsed))
            return parsed;
        const container = parsed && typeof parsed === 'object' ? parsed : null;
        return Array.isArray(container?.records) ? container.records : [];
    }
    catch (error) {
        if (error?.code === 'ENOENT')
            return [];
        throw new Error(`排列3官方数据格式无效: ${outputPath}`, { cause: error });
    }
};
const mergeRecords = (existing, incoming, limit) => {
    const sourceByPeriod = new Map();
    for (const record of [...existing, ...incoming]) {
        sourceByPeriod.set(String(record.period || ''), record);
    }
    const normalized = validateSyncRecords([...sourceByPeriod.values()])
        .slice(-limit)
        .reverse();
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
    const warnings = records.length < normalizedLimit ? [`请求 ${normalizedLimit} 期，当前有效缓存为 ${records.length} 期。`] : [];
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
        throw new Error(`无法读取排列3 JSON 文件: ${filePath} (${error instanceof Error ? error.message : String(error)})`, { cause: error });
    }
    const records = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray(parsed.records)
            ? parsed.records
            : [];
    if (!Array.isArray(records))
        throw new Error('导入文件必须是记录数组或包含 records 数组的对象。');
    validateSyncRecords(records);
    return writeCache(options.dataDir, records, options.limit, filePath);
};
