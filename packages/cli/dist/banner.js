const WORDMARK_LINES = [
    '███╗   ██╗███████╗██╗   ██╗██╗  ██╗███████╗██████╗  ██████╗ ████████╗',
    '████╗  ██║██╔════╝██║   ██║╚██╗██╔╝██╔════╝██╔══██╗██╔═══██╗╚══██╔══╝',
    '██╔██╗ ██║█████╗  ██║   ██║ ╚███╔╝ ███████╗██████╔╝██║   ██║   ██║   ',
    '██║╚██╗██║██╔══╝  ██║   ██║ ██╔██╗ ╚════██║██╔══██╗██║   ██║   ██║   ',
    '██║ ╚████║███████╗╚██████╔╝██╔╝ ██╗███████║██████╔╝╚██████╔╝   ██║   ',
    '╚═╝  ╚═══╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═════╝  ╚═════╝    ╚═╝   ',
];
const SUBTITLE_LINE = 'Lotterymcp 中文命令行入口';
const WEBSITE_LINE = 'www.neuxsbot.com';
const shadowify = (value) => value.replace(/[^\s]/g, '█');
const centerText = (value, width) => {
    const padding = Math.max(0, Math.floor((width - value.length) / 2));
    return `${' '.repeat(padding)}${value}`;
};
export const shouldShowBanner = (command, stream = process.stdout) => {
    if (command === 'serve') {
        return false;
    }
    if (process.env.NBCP_DISABLE_BANNER === '1') {
        return false;
    }
    if (process.env.NBCP_FORCE_BANNER === '1') {
        return true;
    }
    return Boolean(stream.isTTY);
};
export const renderNbcpBanner = (_stream = process.stdout) => {
    const maxWidth = Math.max(...WORDMARK_LINES.map((line) => line.length), SUBTITLE_LINE.length, WEBSITE_LINE.length);
    const renderedLines = WORDMARK_LINES.flatMap((line) => [
        ` ${shadowify(line)}`,
        line,
    ]);
    return [
        '',
        ...renderedLines,
        '',
        centerText(SUBTITLE_LINE, maxWidth),
        centerText(WEBSITE_LINE, maxWidth),
        '',
    ].join('\n');
};
