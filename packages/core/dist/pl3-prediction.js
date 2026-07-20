import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const PL3_LOTTERY_TYPE = 'pl3';
export class Pl3PredictionError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.name = 'Pl3PredictionError';
        this.code = code;
        this.details = details;
    }
}
export const PL3_MODEL_VERSION = 'weighted-frequency-v1';
export const PL3_MIN_RECORDS = 100;
export const PL3_DEFAULT_PERIODS = 200;
export const PL3_MAX_PERIODS = 1000;
export const PL3_DEFAULT_TICKETS = 10;
export const PL3_MAX_TICKETS = 100;
export const PL3_MODEL_WEIGHTS = {
    positionFrequency: 0.3,
    digitFrequency: 0.2,
    sumFrequency: 0.2,
    oddEvenFrequency: 0.15,
    spanFrequency: 0.1,
    numberTypeFrequency: 0.05,
};
export const PL3_DEFAULT_PAYOUTS = {
    stake: 2,
    direct: 1040,
    group3: 346,
    group6: 173,
};
const PLAY_TYPES = ['direct', 'group3', 'group6'];
const MIXED_RATIOS = {
    direct: 0.4,
    group3: 0.4,
    group6: 0.2,
};
const round = (value, digits = 6) => Number(value.toFixed(digits));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const comparePeriods = (left, right) => left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' });
export const isValidPl3DrawDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const parseNumbers = (record) => {
    const raw = Array.isArray(record.numbersList)
        ? record.numbersList
        : Array.isArray(record.numbers_list)
            ? record.numbers_list
            : String(record.numbers || '').split(/[,\s]+/).filter(Boolean);
    const values = raw.map((item) => Number(item));
    if (values.length !== 3 || values.some((item) => !Number.isInteger(item) || item < 0 || item > 9)) {
        return null;
    }
    return values;
};
export const normalizePl3Records = (records) => {
    const byPeriod = new Map();
    for (const sourceRecord of records) {
        if (!sourceRecord || typeof sourceRecord !== 'object') {
            throw new Pl3PredictionError('LOTTERYMCP_PL3_INVALID_RECORD', '排列3历史数据包含无效记录。');
        }
        const lotteryType = String(sourceRecord.lotteryType || PL3_LOTTERY_TYPE).trim().toLowerCase();
        if (lotteryType !== PL3_LOTTERY_TYPE) {
            throw new Pl3PredictionError('LOTTERYMCP_ONLY_PL3_SUPPORTED', `当前版本只支持排列3(pl3)，不支持 ${lotteryType || '(空)'}。`);
        }
        const period = String(sourceRecord.period || '').trim();
        const drawDate = String(sourceRecord.drawDate || '').trim().slice(0, 10);
        const numbersList = parseNumbers(sourceRecord);
        if (!period || !/^\d{5,12}$/.test(period)) {
            throw new Pl3PredictionError('LOTTERYMCP_PL3_INVALID_PERIOD', `排列3历史数据包含无效期号: ${period || '(空)'}`);
        }
        if (!numbersList) {
            throw new Pl3PredictionError('LOTTERYMCP_PL3_INVALID_NUMBERS', `排列3第 ${period} 期必须包含三个 0-9 数字。`);
        }
        if (!isValidPl3DrawDate(drawDate)) {
            throw new Pl3PredictionError('LOTTERYMCP_PL3_INVALID_DRAW_DATE', `排列3第 ${period} 期的开奖日期无效: ${drawDate || '(空)'}`);
        }
        const normalized = {
            lotteryType: PL3_LOTTERY_TYPE,
            period,
            drawDate,
            numbers: numbersList.join(','),
            numbersList,
        };
        const previous = byPeriod.get(period);
        if (previous && (previous.numbers !== normalized.numbers || previous.drawDate !== normalized.drawDate)) {
            throw new Pl3PredictionError('LOTTERYMCP_PL3_DUPLICATE_PERIOD', `排列3第 ${period} 期存在冲突的重复记录。`, { previous, current: normalized });
        }
        byPeriod.set(period, normalized);
    }
    return [...byPeriod.values()].sort((left, right) => comparePeriods(left.period, right.period));
};
const numberType = (numbers) => {
    const unique = new Set(numbers).size;
    return unique === 1 ? 'leopard' : unique === 2 ? 'group3' : 'group6';
};
const permutations = (numbers) => {
    const result = new Set();
    for (let i = 0; i < numbers.length; i += 1) {
        for (let j = 0; j < numbers.length; j += 1) {
            for (let k = 0; k < numbers.length; k += 1) {
                if (i !== j && i !== k && j !== k) {
                    result.add(`${numbers[i]}${numbers[j]}${numbers[k]}`);
                }
            }
        }
    }
    return [...result];
};
const scoreDirectCombinations = (records) => {
    const total = records.length;
    const positionCounts = Array.from({ length: 3 }, () => Array(10).fill(0));
    const digitCounts = Array(10).fill(0);
    const sumCounts = Array(28).fill(0);
    const oddCounts = Array(4).fill(0);
    const spanCounts = Array(10).fill(0);
    const typeCounts = { leopard: 0, group3: 0, group6: 0 };
    for (const record of records) {
        const numbers = record.numbersList;
        numbers.forEach((digit, index) => {
            positionCounts[index][digit] += 1;
            digitCounts[digit] += 1;
        });
        sumCounts[numbers[0] + numbers[1] + numbers[2]] += 1;
        oddCounts[numbers.filter((digit) => digit % 2 === 1).length] += 1;
        spanCounts[Math.max(...numbers) - Math.min(...numbers)] += 1;
        typeCounts[numberType(numbers)] += 1;
    }
    const combinations = [];
    for (let hundred = 0; hundred <= 9; hundred += 1) {
        for (let ten = 0; ten <= 9; ten += 1) {
            for (let unit = 0; unit <= 9; unit += 1) {
                const numbers = [hundred, ten, unit];
                const sum = hundred + ten + unit;
                const oddCount = numbers.filter((digit) => digit % 2 === 1).length;
                const span = Math.max(...numbers) - Math.min(...numbers);
                const positionFrequency = numbers.reduce((value, digit, index) => value + positionCounts[index][digit] / total, 0) / 3;
                const digitFrequency = numbers.reduce((value, digit) => value + digitCounts[digit] / (total * 3), 0) / 3;
                const score = positionFrequency * PL3_MODEL_WEIGHTS.positionFrequency +
                    digitFrequency * PL3_MODEL_WEIGHTS.digitFrequency +
                    (sumCounts[sum] / total) * PL3_MODEL_WEIGHTS.sumFrequency +
                    (oddCounts[oddCount] / total) * PL3_MODEL_WEIGHTS.oddEvenFrequency +
                    (spanCounts[span] / total) * PL3_MODEL_WEIGHTS.spanFrequency +
                    (typeCounts[numberType(numbers)] / total) * PL3_MODEL_WEIGHTS.numberTypeFrequency;
                combinations.push({ numbers, display: `${hundred}${ten}${unit}`, score: round(score) });
            }
        }
    }
    return combinations.sort((left, right) => right.score - left.score || left.display.localeCompare(right.display));
};
const buildTicketPools = (records) => {
    const directScores = scoreDirectCombinations(records);
    const scoreByDisplay = new Map(directScores.map((item) => [item.display, item.score]));
    const direct = directScores.map((item, index) => ({
        rank: index + 1,
        playType: 'direct',
        numbers: item.numbers,
        display: item.display,
        score: item.score,
    }));
    const group3 = [];
    for (let pairDigit = 0; pairDigit <= 9; pairDigit += 1) {
        for (let singleDigit = 0; singleDigit <= 9; singleDigit += 1) {
            if (pairDigit === singleDigit)
                continue;
            const variants = permutations([pairDigit, pairDigit, singleDigit]);
            const score = variants.reduce((value, item) => value + (scoreByDisplay.get(item) || 0), 0) / variants.length;
            group3.push({
                rank: 0,
                playType: 'group3',
                numbers: [pairDigit, pairDigit, singleDigit],
                display: `${pairDigit}${pairDigit}${singleDigit}`,
                score: round(score),
                pairDigit,
                singleDigit,
            });
        }
    }
    group3.sort((left, right) => right.score - left.score || left.display.localeCompare(right.display));
    group3.forEach((ticket, index) => { ticket.rank = index + 1; });
    const group6 = [];
    for (let first = 0; first <= 7; first += 1) {
        for (let second = first + 1; second <= 8; second += 1) {
            for (let third = second + 1; third <= 9; third += 1) {
                const variants = permutations([first, second, third]);
                const score = variants.reduce((value, item) => value + (scoreByDisplay.get(item) || 0), 0) / variants.length;
                group6.push({
                    rank: 0,
                    playType: 'group6',
                    numbers: [first, second, third],
                    display: `${first}${second}${third}`,
                    score: round(score),
                });
            }
        }
    }
    group6.sort((left, right) => right.score - left.score || left.display.localeCompare(right.display));
    group6.forEach((ticket, index) => { ticket.rank = index + 1; });
    return { direct, group3, group6 };
};
export const scorePl3TicketPools = (sourceRecords) => buildTicketPools(normalizePl3Records(sourceRecords));
const allocateMixedTickets = (tickets) => {
    const allocation = { direct: 0, group3: 0, group6: 0 };
    const fractions = PLAY_TYPES.map((playType, index) => {
        const exact = tickets * MIXED_RATIOS[playType];
        const floor = Math.floor(exact);
        allocation[playType] = floor;
        return { playType, fraction: exact - floor, index };
    });
    let remaining = tickets - Object.values(allocation).reduce((sum, value) => sum + value, 0);
    fractions.sort((left, right) => right.fraction - left.fraction || left.index - right.index);
    for (const item of fractions) {
        if (remaining <= 0)
            break;
        allocation[item.playType] += 1;
        remaining -= 1;
    }
    return allocation;
};
const generateTickets = (records, tickets, playType) => {
    const pools = buildTicketPools(records);
    if (playType !== 'mixed') {
        return pools[playType].slice(0, tickets).map((ticket, index) => ({ ...ticket, rank: index + 1 }));
    }
    const allocation = allocateMixedTickets(tickets);
    const selected = PLAY_TYPES.flatMap((type) => pools[type].slice(0, allocation[type]));
    return selected.map((ticket, index) => ({ ...ticket, rank: index + 1 }));
};
const multisetOverlap = (left, right) => {
    const remaining = [...right];
    let matches = 0;
    for (const value of left) {
        const index = remaining.indexOf(value);
        if (index >= 0) {
            matches += 1;
            remaining.splice(index, 1);
        }
    }
    return matches;
};
const ticketWins = (ticket, actual) => {
    if (ticket.playType === 'direct') {
        return ticket.numbers.every((value, index) => value === actual[index]);
    }
    if (ticket.playType === 'group3' && numberType(actual) !== 'group3')
        return false;
    if (ticket.playType === 'group6' && numberType(actual) !== 'group6')
        return false;
    return [...ticket.numbers].sort().join('') === [...actual].sort().join('');
};
const resolvePayouts = (value) => {
    const result = { ...PL3_DEFAULT_PAYOUTS, ...(value || {}) };
    for (const [key, amount] of Object.entries(result)) {
        if (!Number.isFinite(amount) || amount < 0) {
            throw new Pl3PredictionError('LOTTERYMCP_PL3_INVALID_PAYOUT', `无效的排列3奖金参数: ${key}`);
        }
    }
    return result;
};
const payoutForTicket = (ticket, payouts) => payouts[ticket.playType];
export const backtestPl3 = (sourceRecords, options = {}) => {
    const records = normalizePl3Records(sourceRecords);
    const tickets = normalizeTicketCount(options.tickets);
    const playType = normalizePlayType(options.playType);
    const payouts = resolvePayouts(options.payouts);
    const testCount = Math.min(100, Math.max(records.length - PL3_MIN_RECORDS, 0));
    const emptyPlayMetrics = () => ({
        ticketsPerDraw: playType === 'mixed' ? allocateMixedTickets(tickets).direct : playType === 'direct' ? tickets : 0,
        winningTickets: 0,
        winningDraws: 0,
        hitRate: 0,
        returnAmount: 0,
    });
    const plays = {
        direct: emptyPlayMetrics(),
        group3: emptyPlayMetrics(),
        group6: emptyPlayMetrics(),
    };
    const allocation = playType === 'mixed'
        ? allocateMixedTickets(tickets)
        : { direct: playType === 'direct' ? tickets : 0, group3: playType === 'group3' ? tickets : 0, group6: playType === 'group6' ? tickets : 0 };
    PLAY_TYPES.forEach((type) => { plays[type].ticketsPerDraw = allocation[type]; });
    if (testCount === 0) {
        return {
            status: 'insufficient_data',
            minimumTrainingRecords: PL3_MIN_RECORDS,
            testCount: 0,
            totalCost: 0,
            totalReturn: 0,
            profit: 0,
            roi: null,
            positionTwoDigitDraws: 0,
            unorderedTwoDigitDraws: 0,
            plays,
            baseline: {
                perTicketHitProbability: { direct: 0.001, group3: 0.003, group6: 0.006 },
                expectedWinningTickets: 0,
                expectedReturn: 0,
                expectedRoi: null,
            },
            cases: [],
        };
    }
    let positionTwoDigitDraws = 0;
    let unorderedTwoDigitDraws = 0;
    let totalReturn = 0;
    const cases = [];
    const startIndex = records.length - testCount;
    for (let index = startIndex; index < records.length; index += 1) {
        const training = records.slice(0, index);
        const target = records[index];
        const generated = generateTickets(training, tickets, playType);
        let winningTickets = 0;
        let caseReturn = 0;
        const wonPlays = new Set();
        for (const ticket of generated) {
            if (ticketWins(ticket, target.numbersList)) {
                winningTickets += 1;
                const payout = payoutForTicket(ticket, payouts);
                caseReturn += payout;
                plays[ticket.playType].winningTickets += 1;
                plays[ticket.playType].returnAmount += payout;
                wonPlays.add(ticket.playType);
            }
        }
        wonPlays.forEach((type) => { plays[type].winningDraws += 1; });
        const directTickets = generated.filter((ticket) => ticket.playType === 'direct');
        if (directTickets.some((ticket) => ticket.numbers.filter((value, position) => value === target.numbersList[position]).length >= 2)) {
            positionTwoDigitDraws += 1;
        }
        if (generated.some((ticket) => multisetOverlap(ticket.numbers, target.numbersList) >= 2)) {
            unorderedTwoDigitDraws += 1;
        }
        totalReturn += caseReturn;
        cases.push({
            targetPeriod: target.period,
            afterPeriod: training.at(-1)?.period || '',
            ticketSignature: generated.map((ticket) => `${ticket.playType}:${ticket.display}`).join('|'),
            winningTickets,
            returnAmount: caseReturn,
        });
    }
    PLAY_TYPES.forEach((type) => {
        plays[type].hitRate = round(plays[type].winningDraws / testCount, 4);
        plays[type].returnAmount = round(plays[type].returnAmount, 2);
    });
    const totalCost = testCount * tickets * payouts.stake;
    const probabilities = { direct: 0.001, group3: 0.003, group6: 0.006 };
    const expectedWinningTickets = PLAY_TYPES.reduce((sum, type) => sum + testCount * allocation[type] * probabilities[type], 0);
    const expectedReturn = PLAY_TYPES.reduce((sum, type) => sum + testCount * allocation[type] * probabilities[type] * payouts[type], 0);
    return {
        status: 'complete',
        minimumTrainingRecords: PL3_MIN_RECORDS,
        testCount,
        totalCost: round(totalCost, 2),
        totalReturn: round(totalReturn, 2),
        profit: round(totalReturn - totalCost, 2),
        roi: totalCost ? round((totalReturn - totalCost) / totalCost, 6) : null,
        positionTwoDigitDraws,
        unorderedTwoDigitDraws,
        plays,
        baseline: {
            perTicketHitProbability: probabilities,
            expectedWinningTickets: round(expectedWinningTickets, 6),
            expectedReturn: round(expectedReturn, 2),
            expectedRoi: totalCost ? round((expectedReturn - totalCost) / totalCost, 6) : null,
        },
        cases,
    };
};
const normalizePeriodCount = (value) => {
    const parsed = Number(value ?? PL3_DEFAULT_PERIODS);
    if (!Number.isInteger(parsed) || parsed < PL3_MIN_RECORDS || parsed > PL3_MAX_PERIODS) {
        throw new Pl3PredictionError('LOTTERYMCP_PL3_INVALID_PERIODS', `排列3预测期数必须是 ${PL3_MIN_RECORDS}-${PL3_MAX_PERIODS} 的整数。`);
    }
    return parsed;
};
const normalizeTicketCount = (value) => {
    const parsed = Number(value ?? PL3_DEFAULT_TICKETS);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > PL3_MAX_TICKETS) {
        throw new Pl3PredictionError('LOTTERYMCP_PL3_INVALID_TICKETS', `排列3预测注数必须是 1-${PL3_MAX_TICKETS} 的整数。`);
    }
    return parsed;
};
const normalizePlayType = (value) => {
    const normalized = String(value || 'mixed').trim().toLowerCase();
    if (!['direct', 'group3', 'group6', 'mixed'].includes(normalized)) {
        throw new Pl3PredictionError('LOTTERYMCP_PL3_INVALID_PLAY_TYPE', `不支持的排列3玩法: ${normalized}`);
    }
    return normalized;
};
export const predictPl3 = (sourceRecords, query = {}) => {
    const lotteryType = String(query.lotteryType || PL3_LOTTERY_TYPE).trim().toLowerCase();
    if (lotteryType !== PL3_LOTTERY_TYPE) {
        throw new Pl3PredictionError('LOTTERYMCP_ONLY_PL3_SUPPORTED', `当前版本只支持排列3(pl3)，不支持 ${lotteryType}。`);
    }
    const periods = normalizePeriodCount(query.periods);
    const tickets = normalizeTicketCount(query.tickets);
    const playType = normalizePlayType(query.playType);
    const payouts = resolvePayouts(query.payouts);
    const normalized = normalizePl3Records(sourceRecords).slice(-periods);
    if (normalized.length < PL3_MIN_RECORDS) {
        throw new Pl3PredictionError('LOTTERYMCP_PL3_INSUFFICIENT_DATA', `排列3预测至少需要 ${PL3_MIN_RECORDS} 条有效历史记录，当前只有 ${normalized.length} 条。`, { required: PL3_MIN_RECORDS, actual: normalized.length });
    }
    const trainingDataHash = sha256(JSON.stringify(normalized.map((record) => [record.period, record.drawDate, record.numbers])));
    const generated = generateTickets(normalized, tickets, playType);
    const generatedAt = query.generatedAt || new Date().toISOString();
    const predictionId = sha256(JSON.stringify({
        modelVersion: PL3_MODEL_VERSION,
        trainingDataHash,
        periods,
        tickets,
        playType,
        payouts,
    }));
    return {
        predictionId,
        lotteryType: PL3_LOTTERY_TYPE,
        generatedAt,
        afterPeriod: normalized.at(-1).period,
        target: 'next-draw',
        training: {
            recordCount: normalized.length,
            fromPeriod: normalized[0].period,
            toPeriod: normalized.at(-1).period,
            trainingDataHash,
        },
        model: {
            name: 'weighted-frequency',
            version: PL3_MODEL_VERSION,
            scoreIsProbability: false,
            weights: PL3_MODEL_WEIGHTS,
        },
        query: { periods, tickets, playType },
        payouts: {
            ...payouts,
            note: '奖金与 ROI 为按当前配置计算的历史模拟，不代表未来收益。',
        },
        tickets: generated,
        backtest: backtestPl3(normalized, { tickets, playType, payouts }),
        settlement: { status: 'pending' },
    };
};
const readLedger = async (ledgerPath) => {
    try {
        const parsed = JSON.parse(await readFile(ledgerPath, 'utf8'));
        if (!Array.isArray(parsed.predictions))
            throw new Error('predictions must be an array');
        return { version: 1, predictions: parsed.predictions };
    }
    catch (error) {
        if (error?.code === 'ENOENT')
            return { version: 1, predictions: [] };
        throw new Pl3PredictionError('LOTTERYMCP_PL3_LEDGER_INVALID', `排列3预测账本格式无效: ${ledgerPath}`, error);
    }
};
export const writeJsonAtomically = async (targetPath, payload) => {
    await mkdir(path.dirname(targetPath), { recursive: true });
    const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    try {
        await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
        for (let attempt = 0;; attempt += 1) {
            try {
                await rename(temporaryPath, targetPath);
                break;
            }
            catch (error) {
                if (!['EACCES', 'EBUSY', 'EPERM'].includes(error?.code) || attempt >= 5)
                    throw error;
                await sleep(50 * 2 ** attempt);
            }
        }
    }
    finally {
        await unlink(temporaryPath).catch(() => undefined);
    }
};
const withLedgerLock = async (ledgerPath, callback) => {
    const lockPath = `${ledgerPath}.lock`;
    await mkdir(path.dirname(ledgerPath), { recursive: true });
    const deadline = Date.now() + 2000;
    let handle;
    while (!handle) {
        try {
            handle = await open(lockPath, 'wx');
            await handle.writeFile(new Date().toISOString(), 'utf8');
        }
        catch (error) {
            if (error?.code !== 'EEXIST')
                throw error;
            try {
                const info = await stat(lockPath);
                if (Date.now() - info.mtimeMs > 120_000) {
                    await unlink(lockPath);
                    continue;
                }
            }
            catch (statError) {
                if (statError?.code === 'ENOENT')
                    continue;
                throw statError;
            }
            if (Date.now() >= deadline) {
                throw new Pl3PredictionError('LOTTERYMCP_PL3_LEDGER_LOCKED', '排列3预测账本正被其他进程更新，请稍后重试。');
            }
            await sleep(50);
        }
    }
    try {
        return await callback();
    }
    finally {
        await handle.close();
        await unlink(lockPath).catch(() => undefined);
    }
};
export const upsertPl3Prediction = async (ledgerPath, prediction) => withLedgerLock(ledgerPath, async () => {
    const ledger = await readLedger(ledgerPath);
    const index = ledger.predictions.findIndex((item) => item.predictionId === prediction.predictionId);
    if (index >= 0) {
        prediction.settlement = ledger.predictions[index].settlement;
        ledger.predictions[index] = prediction;
    }
    else {
        ledger.predictions.push(prediction);
    }
    await writeJsonAtomically(ledgerPath, ledger);
    return prediction;
});
export const settlePl3Predictions = async (ledgerPath, sourceRecords) => withLedgerLock(ledgerPath, async () => {
    const ledger = await readLedger(ledgerPath);
    const records = normalizePl3Records(sourceRecords);
    let settledCount = 0;
    for (const prediction of ledger.predictions) {
        if (prediction.settlement.status === 'settled')
            continue;
        const baseIndex = records.findIndex((record) => record.period === prediction.afterPeriod);
        const target = baseIndex >= 0 ? records[baseIndex + 1] : undefined;
        if (!target)
            continue;
        const winning = prediction.tickets.filter((ticket) => ticketWins(ticket, target.numbersList));
        const returnAmount = winning.reduce((sum, ticket) => sum + prediction.payouts[ticket.playType], 0);
        const cost = prediction.tickets.length * prediction.payouts.stake;
        prediction.settlement = {
            status: 'settled',
            targetPeriod: target.period,
            drawDate: target.drawDate,
            actualNumbers: target.numbersList,
            winningTickets: winning.length,
            returnAmount: round(returnAmount, 2),
            profit: round(returnAmount - cost, 2),
            settledAt: new Date().toISOString(),
        };
        settledCount += 1;
    }
    if (settledCount > 0)
        await writeJsonAtomically(ledgerPath, ledger);
    return { settledCount, ledger };
});
export const getPl3PredictionLedgerSummary = async (ledgerPath) => {
    const ledger = await readLedger(ledgerPath);
    return {
        total: ledger.predictions.length,
        pending: ledger.predictions.filter((item) => item.settlement.status === 'pending').length,
        settled: ledger.predictions.filter((item) => item.settlement.status === 'settled').length,
    };
};
