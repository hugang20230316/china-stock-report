# China Stock Report

基于当天 `china-stock-analysis` raw 输出，生成 A 股正式推荐 HTML，并附带可直接查看的 PNG 预览图。

这套 skill 的重点不是“把股票渲染成网页”，而是把**当天选股、数据校验、截图、交付、复盘**串成一条可信流程。

## 成品预览

### 总览页

![stock report overview](assets/readme/stock_report_overview.png)

### 展开详情页

![stock report detail](assets/readme/stock_report_detail.png)

对应正式产物：

- HTML：`reports/stock_report_20260312.html`
- 预览图：`assets/20260312/report_preview.png`

## 这份报告怎么选出 6 只股票

正式报告不会直接复用旧名单，而是依赖当天脚本输出重新筛选：

1. 用 `sector_analyzer.py` 先确定当天强势板块和资金主线
2. 用 `stock_screener.py` 生成候选池，控制估值、规模和流动性
3. 从当天候选池里选 6 只，保证行业分散
4. 通过 `verify_raw.js` 校验 raw 文件里的数字字段是否来自当天脚本
5. 再用 `fetch_data.js` 补齐当天行情和财务字段
6. 最后重抓当天 K 线截图，组装 HTML

核心过滤规则：

- 近 5 个交易日涨幅 `>= 20%` 直接排除
- 近 10 个交易日涨幅 `>= 30%` 直接排除
- 同一行业最多保留 2 只
- 倾向估值合理、逻辑清楚、风险可解释的标的

## 为什么会推荐这些股票

一只股票进入正式报告，不是因为它“今天涨得最多”，而是因为它在当天市场环境里更适合被正式跟踪：

- 行业方向和当天主线一致
- 估值没有被明显透支
- 财务或盈利趋势能支撑推荐理由
- 有催化因素，不只是静态便宜
- 风险能够清楚写出来

也就是说，最终输出的是“当天最值得写进正式报告的 6 只”，而不是单纯的涨幅榜。

## 复盘与反思功能

这套 skill 还内置了复盘逻辑：

- 每次生成新报告前，先扫描历史 `stock_report_*.html`
- 对已满 5 个交易日且未复盘的报告，自动纳入复盘
- 计算推荐后涨跌幅
- 对亏损案例总结原因
- 把总结出来的教训写回规则，影响下一轮筛选

它的价值在于持续回答这些问题：

- 是不是经常追高
- 是不是在某些板块重复踩坑
- 哪类推荐理由更容易失效
- 哪类股票更适合进入正式池

## 最短使用路径

1. 生成当天 raw：`data/raw/china_stock_analysis_raw_YYYYMMDD.json`
2. 校验 raw：`node scripts/verify_raw.js --date YYYYMMDD`
3. 生成分析底稿：`node scripts/build_analysis_from_raw.js --date YYYYMMDD`
4. 重抓 K 线截图：`node scripts/screenshot.js --date YYYYMMDD --concurrency 3 --stocks '[...]'`
5. 生成正式 HTML：`node scripts/generate_report_html.js --date YYYYMMDD`
6. 生成成品预览：`node scripts/capture_report_preview.js --date YYYYMMDD`

## 默认交付

- 正式 HTML：`reports/stock_report_YYYYMMDD.html`
- 成品预览：`assets/YYYYMMDD/report_preview.png`

如果当天 raw、行情补数、截图任一步失败，必须立即停止，不能回填旧数据交付。
