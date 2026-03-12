---
name: china-stock-report
description: 生成 A 股当日推荐 HTML 报告，并维护与之配套的抓数、校验、截图、HTML 组装链路。用于用户要求“生成今天的股票报告”“输出 stock_report_YYYYMMDD.html”“验证股票报告数据源或截图链路”“维护这套 A 股日报工具”时。必须以 `china-stock-analysis` 的当日原始输出作为唯一分析来源；拿不到当日 raw output 时必须失败停止，禁止复用历史报告、旧截图或手工整理结果。
---

# China Stock Report

## 发布版约定

- 本 skill 安装后即可直接作为默认工作区使用；默认以 skill 根目录作为运行根目录。
- 如果用户已有独立工作区，可通过环境变量 `CHINA_STOCK_REPORT_ROOT` 指向该目录；如配置文件不在默认位置，可再设置 `CHINA_STOCK_REPORT_CONFIG`。
- 运行前先读取 `config/report.config.json`，再按需读取 `references/stock-report-spec.md`、`references/stock-summary-spec.md`、`references/raw-generation-spec.md`。
- 正式产物默认写入 `reports/stock_report_YYYYMMDD.html`；截图默认写入 `assets/YYYYMMDD/`；分析中间结果默认写入 `data/analysis/`。
- 本 skill 依赖 `china-stock-analysis` 先产出当天 raw 文件；没有当天 raw 文件时，禁止继续拼装 HTML。

## 标准流程

1. 先确认本机绝对日期与时间；如果用户要求“今天/当天”，必须在最终结果中使用绝对日期。
2. 先读取 `references/stock-summary-spec.md`，检查是否存在已满 5 个交易日且尚未复盘的历史报告。
3. 读取 `references/stock-report-spec.md` 的 `2.6`、`2.7`、`2.8`、`4.1.1`、`4.1.2`、`8.1`、`9.3`、`9.4`，并读取 `references/raw-generation-spec.md`，确认今天的 raw 文件格式、筛选边界和失败处理规则。
4. 调用 `china-stock-analysis` 生成当天 raw 文件，文件名必须为 `data/raw/china_stock_analysis_raw_YYYYMMDD.json`。
5. 运行 `node scripts/verify_raw.js --date YYYYMMDD`，确认 raw 文件确实来自当天脚本输出，且没有混入 LLM 编造数字。
6. 运行 `node scripts/build_analysis_from_raw.js --date YYYYMMDD`，使用 `fetch_data.js` 补齐当天行情与财务字段，生成 `data/analysis/analysis_result_YYYYMMDD.json`。
7. 运行 `node scripts/screenshot.js --date YYYYMMDD --concurrency 3 --stocks '[...]'`，为正式入选股票重新抓取当天 K 线截图。
8. 运行 `node scripts/generate_report_html.js --date YYYYMMDD`，生成正式 HTML。
9. 回复用户时默认只输出 3 件事：最终 HTML 路径、实际使用了哪些 skill、以及一句简要说明。

## 强制规则

- 所有行情、涨幅、估值、截图时间都必须来自本次实际执行结果，并明确绝对日期。
- 默认只接受 `stock_report_YYYYMMDD.html` 作为正式交付物；JSON、Markdown、临时脚本输出只能作为中间产物。
- HTML 中的股票名单、推荐理由、分析段落、催化与风险，必须全部来自当天 `china-stock-analysis` 的 raw output 与后续补数结果。
- 禁止直接复用旧报告名单；`references/stock-report-spec.md` 的 `9.3` 观察池只可用于候选跟踪和交叉检查。
- 近 5 日涨幅大于等于 `20%` 或近 10 日涨幅大于等于 `30%` 的股票直接排除；无法核对时必须标注“待验证”或停止继续。
- 同一行业最多保留 2 只，优先保证行业分散和风险分散。
- 如果 `china-stock-analysis`、东方财富接口或 Playwright 截图任一关键步骤失败，必须停止正式报告生成并向用户汇报失败点。
- 除非用户明确表达“暂停生成”“先只看预览结果/股票清单/来源”，否则命中本 skill 后必须直接执行到最终 HTML，不能追问“要不要继续”。
- 禁止把结构化数据、候选池、历史报告或旧截图当作默认交付物或默认兜底数据。

## 资源

### `config/report.config.json`

- 运行时配置入口。
- 默认使用 skill 根目录下的相对路径；可通过 `CHINA_STOCK_REPORT_ROOT` 切到外部工作区。

### `scripts/fetch_data.js`

- 抓取东方财富延迟行情与财务数据。
- 输出 JSON 到标准输出，供分析底稿构建脚本调用。

### `scripts/verify_raw.js`

- 校验当天 raw 文件是否来自 `china-stock-analysis` 的真实脚本输出。
- 强制检查 `_sourceProof`、当天时间戳，以及禁止出现在 raw 中的 `quote.*` 字段。

### `scripts/build_analysis_from_raw.js`

- 从 `china-stock-analysis` 的当天 raw 文件生成正式 `analysis_result_YYYYMMDD.json`。
- 运行时调用 `fetch_data.js` 补齐当天行情和财务字段。

### `scripts/screenshot.js`

- 批量截取东方财富日 K 线图片。
- 默认把图片写入 `assets/YYYYMMDD`。
- 会优先加载当前环境的 `playwright`，加载不到时回退到 `CHINA_STOCK_REPORT_ROOT/node_modules/playwright`，也支持 `STOCK_PLAYWRIGHT_PATH`。

### `scripts/generate_report_html.js`

- 根据 `analysis_result_YYYYMMDD.json` 和当天截图生成正式 HTML。
- 只接受 `china-stock-analysis` 当天 raw output 构建出的分析结果作为输入。

### `references/stock-report-spec.md`

- 正式报告规范、页面结构、命名规则和工具链顺序。

### `references/stock-summary-spec.md`

- 历史复盘规范与教训清单。

### `references/raw-generation-spec.md`

- raw 文件生成规范，定义脚本锚定字段、LLM 可写字段和交叉验证要求。
