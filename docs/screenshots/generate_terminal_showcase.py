from html import escape
from pathlib import Path


OUTPUT_DIR = Path(__file__).resolve().parent

SCREENSHOTS = {
    "terminal-help.svg": {
        "title": "Lotterymcp 排列3菜单",
        "command": "npx --yes lotterymcp@latest",
        "lines": [
            "支持彩种: 排列3 (pl3)",
            "1. 注册/登录并获取 Token",
            "2. 配置接口地址、Token、默认期数",
            "3. 生成 MCP 配置片段",
            "4. 检查配置、缓存和预测账本",
            "5. 启动 MCP 服务",
            "6. 生成排列3预测与回测",
            "7. 同步公开开奖数据",
            "0. 退出",
        ],
    },
    "terminal-pl3.svg": {
        "title": "排列3预测与 Walk-forward 回测",
        "command": "lotterymcp predict --periods 200 --tickets 10 --play mixed",
        "lines": [
            "截止期号: 26187",
            "训练记录: 200",
            "模型版本: weighted-frequency-v1",
            "玩法/注数: mixed / 10",
            "",
            "候选票:",
            "  1. direct  086  score=0.184512",
            "  2. direct  685  score=0.181204",
            "  3. direct  142  score=0.177891",
            "  4. direct  352  score=0.175223",
            "  5. group3  665  score=0.169843",
            "  6. group3  885  score=0.168104",
            "  7. group3  225  score=0.166882",
            "  8. group3  448  score=0.164311",
            "  9. group6  058  score=0.161204",
            " 10. group6  256  score=0.159876",
            "",
            "回测: 100 期 | 成本 2000 | 返回 1730 | ROI -0.135",
            "score 仅用于排序；奖金与 ROI 为历史模拟。",
        ],
    },
}


def render_terminal_svg(title: str, command: str, lines: list[str]) -> str:
    width = 1500
    line_height = 38
    height = max(720, 220 + len(lines) * line_height)
    body = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        f'<rect width="{width}" height="{height}" fill="#08090b"/>',
        f'<rect x="32" y="32" width="{width - 64}" height="{height - 64}" rx="8" fill="#111318" stroke="#343942" stroke-width="2"/>',
        '<circle cx="76" cy="72" r="8" fill="#ff5f57"/>',
        '<circle cx="104" cy="72" r="8" fill="#febc2e"/>',
        '<circle cx="132" cy="72" r="8" fill="#28c840"/>',
        f'<text x="174" y="82" fill="#f3f5f7" font-size="29" font-family="Consolas, Microsoft YaHei UI, monospace">{escape(title)}</text>',
        f'<text x="72" y="132" fill="#7ee787" font-size="24" font-family="Consolas, Microsoft YaHei UI, monospace">$ {escape(command)}</text>',
        f'<line x1="64" y1="154" x2="{width - 64}" y2="154" stroke="#2a2e35"/>',
    ]
    y = 194
    for line in lines:
        if not line:
            y += line_height // 2
            continue
        color = "#d9dde3"
        if line.startswith("支持彩种:") or line.startswith("截止期号:"):
            color = "#f2cc60"
        elif line.startswith("候选票:"):
            color = "#8ab4ff"
        elif line.startswith("回测:"):
            color = "#c4b5fd"
        elif line.startswith("score"):
            color = "#9da5b4"
        body.append(
            f'<text x="72" y="{y}" fill="{color}" font-size="24" font-family="Consolas, Microsoft YaHei UI, monospace">{escape(line)}</text>'
        )
        y += line_height
    body.append("</svg>")
    return "\n".join(body)


def write_showcase() -> None:
    for filename, payload in SCREENSHOTS.items():
        with (OUTPUT_DIR / filename).open("w", encoding="utf-8", newline="\n") as output:
            output.write(render_terminal_svg(payload["title"], payload["command"], payload["lines"]))


if __name__ == "__main__":
    write_showcase()
