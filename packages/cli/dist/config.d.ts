export type LotteryMcpConfig = {
    apiBaseUrl: string;
    token: string;
    defaultPeriods: string;
    dataMode?: 'remote' | 'official';
    dataDir?: string;
};
/** @deprecated Use LotteryMcpConfig instead. */
export type NbcpConfig = LotteryMcpConfig;
export declare const DEFAULT_API_BASE_URL = "https://www.neuxsbot.com";
export declare const DEFAULT_PERIODS = "100";
export declare const DEFAULT_DATA_MODE = "remote";
export declare const DEFAULT_DATA_DIR = ".lotterymcp-data";
export declare const CONFIG_DIRNAME = ".neuxsbot";
export declare const CONFIG_FILENAME = "cp.config.json";
export declare const getConfigPath: () => string;
export declare const loadLocalConfig: () => Promise<Partial<LotteryMcpConfig>>;
export declare const resolveConfig: () => Promise<Partial<LotteryMcpConfig>>;
export declare const saveLocalConfig: (config: LotteryMcpConfig) => Promise<void>;
export declare const validateConfig: (config: Partial<LotteryMcpConfig>) => string[];
export declare const maskToken: (token: string) => string;
export declare const renderMcpConfigSnippet: (config: LotteryMcpConfig) => string;
