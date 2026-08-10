import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { openPl3Store, writeJsonAtomically } from 'lotterymcp-core';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const resolveFormat = (filePath, value) => {
    const format = String(value || path.extname(filePath).slice(1))
        .trim()
        .toLowerCase();
    if (format !== 'json' && format !== 'csv') {
        throw new Error(`不支持的排列3文件格式: ${format || '(空)'}，只支持 json/csv。`);
    }
    return format;
};
const writeAtomically = async (outputPath, content) => {
    await mkdir(path.dirname(outputPath), { recursive: true });
    const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, content);
    await rename(temporaryPath, outputPath);
};
const parseJsonRecords = (rawText) => {
    const parsed = JSON.parse(rawText);
    const records = Array.isArray(parsed) ? parsed : parsed?.records;
    if (!Array.isArray(records))
        throw new Error('JSON 必须是记录数组或包含 records 数组的对象。');
    return records;
};
const parseCsvRecords = (rawText) => {
    const rows = parse(rawText, {
        bom: true,
        columns: true,
        skip_empty_lines: true,
        trim: true,
    });
    return rows.map((row) => {
        const numbers = row.numbers || [row.d1, row.d2, row.d3].filter((item) => item !== undefined).join(',');
        return {
            lotteryType: row.lotteryType || 'pl3',
            period: row.period,
            drawDate: row.drawDate,
            numbers,
            sourceUrl: row.sourceUrl,
        };
    });
};
export const importPl3FileToStore = async (input) => {
    const filePath = path.resolve(input.filePath);
    const format = resolveFormat(filePath, input.format);
    let raw;
    try {
        raw = await readFile(filePath);
    }
    catch (error) {
        throw new Error(`无法读取排列3导入文件: ${filePath} (${error instanceof Error ? error.message : String(error)})`, {
            cause: error,
        });
    }
    const rawText = raw.toString('utf8');
    const records = format === 'json' ? parseJsonRecords(rawText) : parseCsvRecords(rawText);
    const contentHash = sha256(raw);
    const year = new Date().toISOString().slice(0, 4);
    const relativeRawPath = path.join('raw', 'file-import', year, `${contentHash}.${format}.gz`);
    const rawPath = path.join(path.resolve(input.dataDir), relativeRawPath);
    if (!existsSync(rawPath))
        await writeAtomically(rawPath, gzipSync(raw));
    const store = openPl3Store({ dataDir: input.dataDir });
    try {
        const imported = store.importRecords(records, {
            provider: 'file-import',
            sourceUrl: `file-import:${path.basename(filePath)}`,
            rawPath: relativeRawPath.replaceAll('\\', '/'),
            rawContentHash: contentHash,
            metadata: { format, fileName: path.basename(filePath) },
        });
        return {
            filePath,
            format,
            rawPath,
            databasePath: store.databasePath,
            ...imported,
        };
    }
    finally {
        store.close();
    }
};
export const exportPl3Store = async (input) => {
    const outputPath = path.resolve(input.outputPath);
    const format = resolveFormat(outputPath, input.format);
    const store = openPl3Store({ dataDir: input.dataDir, readonly: true, fileMustExist: true });
    try {
        const count = store.getRecordCount();
        const records = store.getRecords({ page: 1, limit: Math.max(count, 1) });
        if (format === 'json') {
            await writeJsonAtomically(outputPath, {
                schemaVersion: 1,
                lotteryType: 'pl3',
                generatedAt: new Date().toISOString(),
                recordCount: records.length,
                records,
            });
        }
        else {
            const csv = stringify(records.map((record) => ({
                lotteryType: record.lotteryType,
                period: record.period,
                drawDate: record.drawDate,
                numbers: record.numbers,
                status: record.status,
                provider: record.provider,
                sourceUrl: record.sourceUrl || '',
                observedAt: record.observedAt,
            })), { header: true });
            await writeAtomically(outputPath, csv);
        }
        return { databasePath: store.databasePath, outputPath, format, recordCount: records.length };
    }
    finally {
        store.close();
    }
};
