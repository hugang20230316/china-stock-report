# Raw 文件生成规范（方向 A：脚本锚定 + LLM 加工）

> 本规范约束 `china_stock_analysis_raw_YYYYMMDD.json` 的生成流程。
> 核心原则：所有数字字段来自脚本，LLM 只写文字字段。
>
> 文中 `<workspace-root>` 指运行时工作区。默认等于安装后的 `china-stock-report` skill 根目录；如果设置了 `CHINA_STOCK_REPORT_ROOT`，则指向该目录。
> 文中 `<codex-home>` 指 Codex 主目录，例如 `~/.codex`。

---

## 整体流程

```text
Phase 1  sector_analyzer.py + stock_screener.py
           ↓ 输出真实行情数字（不可跳过）
Phase 2  LLM 从脚本输出中选 6 只股票，填写叙述字段
           ↓ 数字字段只能从 Phase 1 复制，不得发明
Phase 3  verify_raw.js 交叉验证
           ↓ 验证通过才能继续
Phase 4  build_analysis_from_raw.js（已有流程不变）
```

---

## Phase 1：脚本执行（强制，不可跳过）

### 1a. 板块热度

```bash
python "<codex-home>/skills/china-stock-analysis/scripts/sector_analyzer.py" \
  --mode recommend --top 15 \
  --output "<workspace-root>/data/tmp/sector_{date}.json"
```

验收条件：
- 文件存在
- `analysis_time` 在当天日期内
- `top_sectors` 非空

### 1b. 候选股票池

```bash
python "<codex-home>/skills/china-stock-analysis/scripts/stock_screener.py" \
  --scope hs300 \
  --pe-min 5 --pe-max 60 \
  --market-cap-min 500 \
  --top 40 \
  --output "<workspace-root>/data/tmp/candidates_{date}.json"
```

验收条件：
- 文件存在
- `screen_time` 在当天日期内
- `count` >= 6

两个文件必须存在，验收通过后才能进入 Phase 2。

---

## Phase 2：LLM 加工（数字字段受限）

LLM 读取 Phase 1 的两个输出文件，按以下规则生成 raw 文件。

### 选股规则

1. 从 `candidates_{date}.json` 的 `results` 数组里选 6 只
2. 优先选 `板块名称` 与 `sector_{date}.json` 的 `top_sectors` 有交集的股票
3. 6 只股票至少覆盖 3 个不同行业
4. 同行业最多 2 只

### 数字字段：只能复制，不能发明

以下字段必须从 candidates 文件原样复制，不得修改、估算、四舍五入：

| raw 文件字段 | 来源 candidates 字段 |
|---|---|
| `code` | `代码` |
| `name` | `名称` |
| `_sourceProof.rawPrice` | `最新价` |
| `_sourceProof.rawPe` | `市盈率` |
| `_sourceProof.rawMcap` | `总市值(亿)` |

注意：`quote.price`、`quote.changePct`、`quote.peTtm`、`quote.mcapYi` 这四个字段不在 raw 文件中填写。它们由 `build_analysis_from_raw.js` 调用 `fetch_data.js` 在运行时从东方财富获取并写入 `analysis_result`。

注意：`quote.change5dPct`、`quote.change10dPct` 不在 raw 文件中填写。这两个字段历史上曾被 LLM 编造，现已从 raw 文件格式中移除。

### 文字字段：LLM 撰写，但数字必须一致

以下字段由 LLM 根据行情逻辑撰写：

- `reason`：推荐理由（1-2句）
- `analysis.core`：核心逻辑
- `analysis.earnings`：盈利分析
- `analysis.valuation`：估值分析，必须包含 price/PE 实际数值，且与 candidates 一致
- `analysis.catalyst`：催化因素
- `analysis.risk`：风险提示

规则：所有文字中引用的价格、PE、涨跌幅数字，必须与 candidates 文件一致，不得自行编造。

### `_sourceProof` 字段（强制）

每个 top6 项必须包含以下溯源字段：

```json
"_sourceProof": {
  "candidatesFile": "data/tmp/candidates_20260312.json",
  "screenTime": "2026-03-12T10:30:00",
  "rawCode": "600089",
  "rawPrice": 30.6,
  "rawPe": 21.14,
  "rawMcap": 1546.0
}
```

这些值直接从 candidates 文件的对应行复制，用于 Phase 3 交叉验证。

### 完整 top6 单项格式

```json
{
  "rank": 1,
  "code": "600089",
  "market": "SH",
  "name": "特变电工",
  "industry": "特高压/新能源装备",
  "rating": "★★★★★",
  "cycle": ["中期"],
  "score": 23,
  "reason": "...",
  "analysis": {
    "core": "...",
    "earnings": "...",
    "valuation": "...",
    "catalyst": "...",
    "risk": "..."
  },
  "sources": [
    { "title": "东方财富行情页", "url": "https://quote.eastmoney.com/sh600089.html" },
    { "title": "东方财富财务接口", "url": "https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew?type=1&code=SH600089" }
  ],
  "_sourceProof": {
    "candidatesFile": "data/tmp/candidates_20260312.json",
    "screenTime": "2026-03-12T10:30:00",
    "rawCode": "600089",
    "rawPrice": 30.6,
    "rawPe": 21.14,
    "rawMcap": 1546.0
  }
}
```

不填写：`quote.*`

---

## Phase 3：交叉验证

运行 `scripts/verify_raw.js`：

```bash
node scripts/verify_raw.js \
  --raw "data/raw/china_stock_analysis_raw_{date}.json" \
  --candidates "data/tmp/candidates_{date}.json"
```

验证逻辑：

1. 每只股票的 `code` 在 candidates `results` 中存在
2. `_sourceProof.rawPrice` 与 candidates 中该 code 的 `最新价` 误差 < 0.01
3. `_sourceProof.rawPe` 与 candidates 中该 code 的 `市盈率` 误差 < 0.01
4. `_sourceProof.rawMcap` 与 candidates 中该 code 的 `总市值(亿)` 误差 < 0.01
5. `_sourceProof.screenTime` 在当天日期内
6. raw 文件的 `quote.*` 字段不存在

验证失败则退出，不得继续执行 Phase 4。

---

## Phase 4：已有流程

```bash
node scripts/build_analysis_from_raw.js --date {date}
node scripts/screenshot.js --date {date} ...
node scripts/generate_report_html.js --date {date}
```

---

## 违规识别清单

以下任何一项出现，说明 LLM 跳过了脚本步骤：

| 症状 | 说明 |
|---|---|
| raw 文件中存在 `quote.price` / `quote.changePct` | LLM 提前填入了未经 fetch 的数字 |
| raw 文件中存在 `quote.change5dPct` / `quote.change10dPct` | LLM 编造了多日涨幅 |
| `_sourceProof` 缺失或 `screenTime` 不在当天 | LLM 使用了旧数据或伪造溯源 |
| top6 与前一天重合 4 只以上，且无新 `candidates` 文件 | LLM 复用了历史结果 |
| `data/tmp/candidates_{date}.json` 不存在 | Phase 1 被跳过 |

---

## 备注：5 日/10 日涨幅后续升级方案

`fetch_data.js` 当前抓取字段中无多日涨幅。如需恢复，在 `fetchQuote()` 的 fields 参数中添加对应字段，并同步更新 `build_analysis_from_raw.js` 中的 `normalizeQuote()`。
