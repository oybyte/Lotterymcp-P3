import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { PL3_LOTTERY_TYPE } from './pl3-prediction.js';
export const PL3_FEATURE_VERSION = 'pl3-features-v1';
export const PL3_DEFAULT_FEATURE_WINDOWS = [10, 30, 50, 100, 200, 500];
const canonicalize = (value) => {
    if (value === undefined)
        return 'null';
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map((item) => canonicalize(item)).join(',')}]`;
    return `{${Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
        .join(',')}}`;
};
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const round = (value) => Number(value.toFixed(12));
const zeroes = (length) => Array.from({ length }, () => 0);
const frequencies = (counts, denominator) => counts.map((count) => denominator > 0 ? round(count / denominator) : 0);
const numberType = (numbers) => {
    const unique = new Set(numbers).size;
    return unique === 1 ? 'triple' : unique === 2 ? 'group3' : 'group6';
};
const buildPositionCounts = (records) => {
    const counts = [zeroes(10), zeroes(10), zeroes(10)];
    records.forEach((record) => record.numbersList.forEach((digit, position) => {
        counts[position][digit] += 1;
    }));
    return counts;
};
const entropy = (distribution) => round(distribution.reduce((total, probability) => probability > 0 ? total - probability * Math.log(probability) : total, 0));
const concentration = (distribution) => round(distribution.reduce((total, probability) => total + probability ** 2, 0));
const jsDivergence = (left, right) => {
    const epsilon = 1e-12;
    const normalize = (values) => {
        const adjusted = values.map((value) => value + epsilon);
        const total = adjusted.reduce((sum, value) => sum + value, 0);
        return adjusted.map((value) => value / total);
    };
    const p = normalize(left);
    const q = normalize(right);
    const midpoint = p.map((value, index) => (value + q[index]) / 2);
    const kl = (source) => source.reduce((total, value, index) => total + value * Math.log(value / midpoint[index]), 0);
    return round((kl(p) + kl(q)) / 2);
};
const buildMeanIntervals = (records) => {
    const positions = Array.from({ length: 3 }, () => Array.from({ length: 10 }, () => []));
    records.forEach((record, index) => record.numbersList.forEach((digit, position) => {
        positions[position][digit].push(index);
    }));
    return positions.map((digits) => digits.map((indices) => {
        if (indices.length < 2)
            return null;
        let total = 0;
        for (let index = 1; index < indices.length; index += 1)
            total += indices[index] - indices[index - 1];
        return round(total / (indices.length - 1));
    }));
};
const buildCurrentOmission = (records) => {
    const omission = Array.from({ length: 3 }, () => zeroes(10).map(() => records.length));
    records.forEach((record, index) => record.numbersList.forEach((digit, position) => {
        omission[position][digit] = records.length - 1 - index;
    }));
    return omission;
};
const buildWindowFeatures = (records, window) => {
    const recent = records.slice(-window);
    const previous = records.slice(Math.max(0, records.length - window * 2), Math.max(0, records.length - window));
    const positionCounts = buildPositionCounts(recent);
    const positionFrequency = positionCounts.map((counts) => frequencies(counts, recent.length));
    const globalDigitCounts = zeroes(10);
    const sumCounts = zeroes(28);
    const spanCounts = zeroes(10);
    const oddCountCounts = zeroes(4);
    const numberTypeCounts = { triple: 0, group3: 0, group6: 0 };
    recent.forEach((record) => {
        record.numbersList.forEach((digit) => { globalDigitCounts[digit] += 1; });
        const sum = record.numbersList.reduce((total, digit) => total + digit, 0);
        const span = Math.max(...record.numbersList) - Math.min(...record.numbersList);
        const oddCount = record.numbersList.filter((digit) => digit % 2 === 1).length;
        sumCounts[sum] += 1;
        spanCounts[span] += 1;
        oddCountCounts[oddCount] += 1;
        numberTypeCounts[numberType(record.numbersList)] += 1;
    });
    const previousFrequency = previous.length > 0
        ? buildPositionCounts(previous).map((counts) => frequencies(counts, previous.length))
        : null;
    return {
        requestedWindow: window,
        availableCount: recent.length,
        previousAvailableCount: previous.length,
        positionCounts,
        positionFrequency,
        globalDigitCounts,
        globalDigitFrequency: frequencies(globalDigitCounts, recent.length * 3),
        sumCounts,
        sumFrequency: frequencies(sumCounts, recent.length),
        spanCounts,
        spanFrequency: frequencies(spanCounts, recent.length),
        oddCountCounts,
        oddCountFrequency: frequencies(oddCountCounts, recent.length),
        numberTypeCounts,
        numberTypeFrequency: {
            triple: recent.length > 0 ? round(numberTypeCounts.triple / recent.length) : 0,
            group3: recent.length > 0 ? round(numberTypeCounts.group3 / recent.length) : 0,
            group6: recent.length > 0 ? round(numberTypeCounts.group6 / recent.length) : 0,
        },
        meanIntervals: buildMeanIntervals(recent),
        positionEntropy: positionFrequency.map(entropy),
        positionConcentration: positionFrequency.map(concentration),
        positionFrequencyChange: previousFrequency
            ? positionFrequency.map((distribution, position) => distribution.map((value, digit) => round(value - previousFrequency[position][digit])))
            : null,
        positionJsDivergence: previousFrequency
            ? positionFrequency.map((distribution, position) => jsDivergence(distribution, previousFrequency[position]))
            : null,
    };
};
const decodeStoredSnapshot = (stored) => {
    const raw = gunzipSync(stored.payloadGzip).toString('utf8');
    if (sha256(raw) !== stored.payloadHash)
        throw new Error(`特征 snapshot payload 校验失败: ${stored.featureSnapshotId}`);
    const payload = JSON.parse(raw);
    return {
        featureSnapshotId: stored.featureSnapshotId,
        datasetSnapshotId: stored.datasetSnapshotId,
        afterPeriod: stored.afterPeriod,
        featureVersion: stored.featureVersion,
        windows: JSON.parse(stored.windowsJson),
        windowConfigHash: stored.windowConfigHash,
        payloadHash: stored.payloadHash,
        codeCommit: stored.codeCommit,
        createdAt: stored.createdAt,
        payload,
    };
};
export const createPl3FeatureSnapshot = (store, input) => {
    if (store.getSchemaVersion() < 2)
        throw new Error('排列3数据库尚未应用 M002，请先运行 data migrate --apply。');
    const featureVersion = input.featureVersion || PL3_FEATURE_VERSION;
    if (featureVersion !== PL3_FEATURE_VERSION)
        throw new Error(`不支持的排列3特征版本: ${featureVersion}`);
    const windows = [...new Set(input.windows || PL3_DEFAULT_FEATURE_WINDOWS)]
        .map(Number)
        .sort((left, right) => left - right);
    if (windows.length === 0 || windows.some((window) => !Number.isInteger(window) || window < 1 || window > 5000)) {
        throw new Error('排列3特征窗口必须是 1-5000 的整数。');
    }
    const records = store.getDatasetSnapshotRecords(input.datasetSnapshotId, input.afterPeriod);
    if (records.length === 0 || records.at(-1).period !== input.afterPeriod) {
        throw new Error(`afterPeriod ${input.afterPeriod} 不是 dataset snapshot 中的有效期号。`);
    }
    const windowConfigHash = sha256(canonicalize(windows));
    const featureSnapshotId = sha256(canonicalize({
        schemaVersion: 1,
        datasetSnapshotId: input.datasetSnapshotId,
        afterPeriod: input.afterPeriod,
        featureVersion,
        windowConfigHash,
    }));
    const existing = store.getFeatureSnapshot(featureSnapshotId);
    if (existing)
        return decodeStoredSnapshot(existing);
    const payload = {
        schemaVersion: 1,
        lotteryType: PL3_LOTTERY_TYPE,
        datasetSnapshotId: input.datasetSnapshotId,
        afterPeriod: input.afterPeriod,
        featureVersion,
        windows,
        recordCount: records.length,
        currentOmission: buildCurrentOmission(records),
        windowFeatures: Object.fromEntries(windows.map((window) => [String(window), buildWindowFeatures(records, window)])),
    };
    const payloadJson = canonicalize(payload);
    const stored = store.saveFeatureSnapshot({
        featureSnapshotId,
        datasetSnapshotId: input.datasetSnapshotId,
        afterPeriod: input.afterPeriod,
        featureVersion,
        windowsJson: canonicalize(windows),
        windowConfigHash,
        payloadGzip: gzipSync(Buffer.from(payloadJson, 'utf8')),
        payloadHash: sha256(payloadJson),
        codeCommit: input.codeCommit || null,
        createdAt: new Date().toISOString(),
    });
    return decodeStoredSnapshot(stored);
};
export const getPl3FeatureSnapshot = (store, featureSnapshotId) => {
    const stored = store.getFeatureSnapshot(featureSnapshotId);
    return stored ? decodeStoredSnapshot(stored) : null;
};
