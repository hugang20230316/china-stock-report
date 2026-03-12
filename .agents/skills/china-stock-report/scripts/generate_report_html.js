/**
 * 根据当天分析结果 JSON 生成最终 HTML 报告。
 * 用法：
 *   node scripts/generate_report_html.js --date 20260311
 *   node scripts/generate_report_html.js --input <workspace-root>/data/analysis/analysis_result_20260311.json
 */
const fs = require('fs');
const path = require('path');
const { config, paths, resolvePath, resolvePattern } = require('./lib/report_config');

const HTML_CONFIG = config.htmlGeneration || {};

function parseArgs() {
  const args = process.argv.slice(2);
  let date = '';
  let input = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      date = args[i + 1];
      i++;
    } else if (args[i] === '--input' && args[i + 1]) {
      input = args[i + 1];
      i++;
    }
  }

  if (!input && !date) {
    throw new Error('缺少参数，请传 --date YYYYMMDD 或 --input 文件路径');
  }

  if (!input) {
    input = path.join(
      paths.analysisDir,
      resolvePattern(HTML_CONFIG.inputPattern || 'analysis_result_{date}.json', date)
    );
  }

  if (!date) {
    const match = path.basename(input).match(/(\d{8})/);
    if (!match) throw new Error('无法从输入文件名推导日期');
    date = match[1];
  }

  return { date, input };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isPathInside(baseDir, targetPath) {
  const relative = path.relative(path.resolve(baseDir), path.resolve(targetPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateAnalysisInput(data, inputPath, date) {
  const meta = data.meta || {};
  const errors = [];
  const requiredTopCount = Number(HTML_CONFIG.requiredTopCount) || 6;
  const requiredSourceSkill = HTML_CONFIG.requiredSourceSkill || 'china-stock-analysis';
  const requiredSourceType = HTML_CONFIG.requiredSourceType || 'raw-output';
  const requireRawOutputConfirmed = HTML_CONFIG.requireRawOutputConfirmed !== false;
  const resolvedRawOutputPath = meta.rawOutputPath ? resolvePath(meta.rawOutputPath) : '';
  const resolvedInputPath = path.resolve(inputPath);
  const expectedReportDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const rawFileName = path.basename(resolvedRawOutputPath || '');

  if (!isPathInside(paths.analysisDir, resolvedInputPath)) {
    errors.push('输入文件必须位于 data/analysis 目录下');
  }
  if (data.reportDate !== expectedReportDate) {
    errors.push(`reportDate 必须为 ${expectedReportDate}`);
  }
  if (meta.sourceSkill !== requiredSourceSkill) {
    errors.push(`meta.sourceSkill 必须为 ${requiredSourceSkill}`);
  }
  if (meta.sourceType !== requiredSourceType) {
    errors.push(`meta.sourceType 必须为 ${requiredSourceType}`);
  }
  if (requireRawOutputConfirmed && meta.rawOutputConfirmed !== true) {
    errors.push('meta.rawOutputConfirmed 必须为 true');
  }
  if (!meta.rawOutputPath || typeof meta.rawOutputPath !== 'string') {
    errors.push('meta.rawOutputPath 不能为空');
  } else if (!fs.existsSync(resolvedRawOutputPath)) {
    errors.push('meta.rawOutputPath 指向的原始输出文件不存在');
  } else if (
    HTML_CONFIG.requireRawFileInRawDataDir === true &&
    !isPathInside(paths.rawDataDir, resolvedRawOutputPath)
  ) {
    errors.push('meta.rawOutputPath 必须指向 data/raw 目录下的原始输出文件');
  } else if (!/^china_stock_analysis_raw_\d{8}\.json$/.test(rawFileName)) {
    errors.push('meta.rawOutputPath 必须指向 china_stock_analysis_raw_YYYYMMDD.json');
  } else if (!rawFileName.includes(date)) {
    errors.push(`meta.rawOutputPath 文件名日期必须为 ${date}`);
  }
  if (HTML_CONFIG.rejectHistoricalData !== false && meta.generatedFromHistory === true) {
    errors.push('meta.generatedFromHistory 不能为 true');
  }
  if (!Array.isArray(data.top6) || data.top6.length !== requiredTopCount) {
    errors.push(`top6 必须存在且长度为 ${requiredTopCount}`);
  }

  if (errors.length) {
    throw new Error(
      `拒绝生成 HTML：${path.basename(inputPath)} 未通过 china-stock-analysis 原始输出校验。\n` +
      errors.map((message) => `- ${message}`).join('\n')
    );
  }
}

function imgToBase64(filePath) {
  return fs.readFileSync(filePath).toString('base64');
}

function resolveImagePath(assetDir, item) {
  const exactPath = path.join(assetDir, `${item.rank}_${item.name}_${item.code}.jpeg`);
  if (fs.existsSync(exactPath)) return exactPath;

  const match = fs.readdirSync(assetDir).find((file) =>
    file.endsWith(`_${item.name}_${item.code}.jpeg`)
  );
  if (!match) {
    throw new Error(`未找到截图文件: ${item.name} ${item.code}`);
  }
  return path.join(assetDir, match);
}

function fmtPct(value) {
  const number = Number(value);
  return `${number >= 0 ? '+' : ''}${number.toFixed(2)}%`;
}

function fmtNum(value) {
  return Number(value).toFixed(2).replace(/\.00$/, '');
}

function pctClass(value) {
  return Number(value) >= 0 ? 'up' : 'down';
}

function marketPrefix(market) {
  return String(market).toLowerCase() === 'sh' ? 'sh' : 'sz';
}

function buildTags(cycle) {
  return cycle.map((item) => {
    const cls = item === '短期' ? 'tag-short' : item === '中期' ? 'tag-mid' : 'tag-long';
    return `<span class="tag ${cls}">${item}</span>`;
  }).join('');
}

function buildBars(values, years) {
  const maxAbs = Math.max(...values.map((value) => Math.abs(Number(value)))) || 1;
  return values.map((value, idx) => {
    const number = Number(value);
    const height = Math.max(4, Math.round((Math.abs(number) / maxAbs) * 120));
    return `
<div class="bc-col">
  <div class="bc-val ${number >= 0 ? 'up' : 'down'}">${fmtNum(number)}</div>
  <div class="bc-bar ${number >= 0 ? 'bc-bar-up' : 'bc-bar-dn'}" style="height:${height}px"></div>
  <div class="bc-year">${years[idx]}</div>
</div>`;
  }).join('');
}

function buildSourceLinks(sources) {
  if (!sources || !sources.length) return '';
  return `<div class="sources">来源：${sources.map((source) =>
    `<a href="${source.url}" target="_blank" rel="noreferrer">${source.title}</a>`
  ).join(' | ')}</div>`;
}

function buildRow(item, assetDir) {
  const imagePath = resolveImagePath(assetDir, item);
  const imageBase64 = imgToBase64(imagePath);
  const quote = item.quote;
  const finance = item.finance;
  const analysis = item.analysis;
  const stockUrl = `https://quote.eastmoney.com/${marketPrefix(item.market)}${item.code}.html`;

  return `
<tr class="srow" onclick="toggle(this)">
  <td><span class="ebtn">+</span></td>
  <td>${item.industry}</td>
  <td class="sname"><a href="${stockUrl}" target="_blank" rel="noreferrer">${item.name}</a></td>
  <td>${item.code}</td>
  <td>&yen;${fmtNum(quote.price)}</td>
  <td class="${pctClass(quote.changePct)}">${fmtPct(quote.changePct)}</td>
  <td>${fmtNum(quote.turnoverPct)}%</td>
  <td>${quote.mcapYi}亿</td>
  <td>${quote.peTtm}</td>
  <td class="stars">${item.rating}</td>
  <td class="reason">${item.reason}</td>
</tr>
<tr class="detail-row">
  <td colspan="11">
    <div class="detail-inner">
      <div class="tags">${buildTags(item.cycle)}</div>
      <div class="chart-panel">
        <img class="kline-img" src="data:image/jpeg;base64,${imageBase64}" alt="${item.name}日K线">
        <div class="analysis-box">
          <div class="a-title">核心逻辑</div>
          <div class="a-item">${analysis.core}</div>
          <div class="a-title">业绩亮点</div>
          <div class="a-item">${analysis.earnings}</div>
          <div class="a-title">估值与资金</div>
          <div class="a-item">${analysis.valuation}</div>
          <div class="a-title">关键催化</div>
          <div class="a-item">${analysis.catalyst}</div>
          ${buildSourceLinks(item.sources)}
        </div>
      </div>
      <div class="charts-row">
        <div class="bc">
          <div class="bc-title">归母净利润（亿元）</div>
          <div class="bars">${buildBars(finance.profit, finance.years)}</div>
        </div>
        <div class="bc">
          <div class="bc-title">营业总收入（亿元）</div>
          <div class="bars">${buildBars(finance.revenue, finance.years)}</div>
        </div>
      </div>
      <div class="risk"><b>风险提示：</b>${analysis.risk}</div>
    </div>
  </td>
</tr>`;
}

function buildHtml(data, date) {
  const assetDir = path.join(paths.assetsDir, date);
  const displayDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const rows = data.top6.map((item) => buildRow(item, assetDir)).join('');
  const themes = (data.marketThemes || []).map((tag) => `<span class="theme-chip">${tag}</span>`).join('');
  const footerSources = (data.summarySources || []).map((source) =>
    `<a href="${source.url}" target="_blank" rel="noreferrer">${source.title}</a>`
  ).join(' | ');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TOP6 值得关注个股深度汇总 - ${displayDate.replace(/-/g, '.')}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"Microsoft YaHei",sans-serif;background:#0a0e17;color:#e0e0e0;padding:24px;max-width:1260px;margin:0 auto}
h1{text-align:center;color:#fff;font-size:26px;margin-bottom:6px;letter-spacing:2px;text-shadow:0 0 20px rgba(0,212,255,.3)}
.subtitle{text-align:center;color:#7a8ba8;font-size:13px;margin-bottom:18px;letter-spacing:1px;line-height:1.8}
.theme-wrap{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:24px}
.theme-chip{padding:6px 12px;border-radius:999px;background:linear-gradient(135deg,#10203b,#132a4f);border:1px solid rgba(0,212,255,.18);color:#8fd8ff;font-size:12px}
table.summary{width:100%;border-collapse:separate;border-spacing:0;font-size:14px;margin-bottom:20px;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.4)}
table.summary th{background:linear-gradient(180deg,#1e2d50,#162040);color:#7ab8ff;padding:12px 10px;text-align:center;border-bottom:2px solid #2a3f6a;white-space:nowrap;font-size:13px;font-weight:600;letter-spacing:.5px}
table.summary td{padding:12px 10px;border-bottom:1px solid rgba(30,42,66,.6);text-align:center;vertical-align:middle;font-size:14px;color:#c8d6e5}
table.summary tr.srow{cursor:pointer;transition:all .2s ease;background:rgba(13,17,23,.5)}
table.summary tr.srow:nth-child(4n+1){background:rgba(20,27,45,.5)}
table.summary tr.srow:hover{background:rgba(0,212,255,.08);box-shadow:inset 0 0 0 1px rgba(0,212,255,.15)}
table.summary td.reason{text-align:left;font-size:12px;color:#8899aa;max-width:280px;line-height:1.6}
td.sname a{color:#00d4ff;text-decoration:none;font-weight:bold;font-size:15px;text-shadow:0 0 8px rgba(0,212,255,.3)}
td.sname a:hover{text-decoration:underline;color:#5be0ff}
.up{color:#ff4d4f;font-weight:bold}.down{color:#52c41a;font-weight:bold}
.stars{color:#faad14;letter-spacing:2px;font-size:15px;text-shadow:0 0 6px rgba(250,173,20,.3)}
.ebtn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#1a2340,#243050);color:#00d4ff;font-size:15px;font-weight:bold;border:1px solid #2a3a5a;margin-right:4px;transition:all .25s}
tr.srow:hover .ebtn{border-color:#00d4ff;box-shadow:0 0 8px rgba(0,212,255,.3)}
tr.srow.open .ebtn{transform:rotate(45deg);background:linear-gradient(135deg,#0a3a5a,#00506a);border-color:#00d4ff}
tr.detail-row{display:none;background:#080c14}
tr.detail-row.open{display:table-row}
tr.detail-row td{padding:0 12px 12px;text-align:left}
.detail-inner{background:linear-gradient(180deg,#111827,#0d1321);border-radius:12px;padding:20px;border:1px solid #1e2a42;box-shadow:0 4px 16px rgba(0,0,0,.3)}
.tags{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.tag{padding:3px 10px;border-radius:12px;font-size:11px;font-weight:bold}
.tag-short{background:rgba(255,77,79,.15);color:#ff4d4f;border:1px solid rgba(255,77,79,.3)}
.tag-mid{background:rgba(0,212,255,.15);color:#00d4ff;border:1px solid rgba(0,212,255,.3)}
.tag-long{background:rgba(114,46,209,.15);color:#b37feb;border:1px solid rgba(114,46,209,.3)}
.risk{background:linear-gradient(135deg,#1a1215,#1f1520);border:1px solid #3a1520;border-radius:8px;padding:10px 14px;font-size:12px;color:#ff7875;margin-top:12px;line-height:1.6}
.risk b{color:#ff4d4f}
.charts-row{display:flex;gap:20px;margin:14px 0;flex-wrap:wrap}
.bc{flex:1;background:linear-gradient(180deg,#0f1829,#0a1020);border-radius:10px;padding:14px 12px 10px;border:1px solid rgba(30,42,66,.5);min-width:280px}
.bc-title{font-size:14px;font-weight:bold;color:#7ab8ff;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid rgba(30,42,66,.5)}
.bars{display:flex;height:160px;gap:6px;align-items:stretch}
.bc-col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;min-width:0}
.bc-val{font-size:13px;color:#fff;white-space:nowrap;margin-bottom:3px;font-weight:bold;text-shadow:0 1px 3px rgba(0,0,0,.5)}
.bc-bar{width:80%;max-width:50px;border-radius:4px 4px 0 0;min-height:4px;margin:0 auto;box-shadow:0 0 8px rgba(0,212,255,.15)}
.bc-bar-up{background:linear-gradient(180deg,#00d4ff,#0055aa)}
.bc-bar-dn{background:linear-gradient(180deg,#cc2020,#ff4d4f)}
.bc-year{font-size:12px;color:#7a8ba8;margin-top:4px;font-weight:500}
.chart-panel{display:flex;gap:20px;padding:12px 0;align-items:flex-start;flex-wrap:wrap}
.chart-panel .kline-img{width:480px;max-width:100%;border-radius:10px;border:1px solid #1e2a42;flex-shrink:0;box-shadow:0 2px 12px rgba(0,0,0,.3)}
.analysis-box{flex:1;min-width:280px}
.analysis-box .a-title{font-size:13px;font-weight:bold;color:#faad14;margin-bottom:5px;margin-top:10px}
.analysis-box .a-title:first-child{margin-top:0}
.analysis-box .a-item{font-size:12px;color:#b0bec5;line-height:1.7;padding-left:10px;border-left:2px solid #2a3f6a;margin-bottom:8px}
.sources{margin-top:10px;font-size:11px;color:#7a8ba8;line-height:1.7}
.sources a{color:#62d8ff;text-decoration:none}
.footer{margin-top:28px;padding:18px;border-top:1px solid rgba(30,42,66,.6);font-size:12px;color:#7a8ba8;line-height:1.8}
.footer a{color:#62d8ff;text-decoration:none}
@media (max-width:900px){
  body{padding:12px}
  table.summary{display:block;overflow-x:auto}
  .chart-panel{flex-direction:column}
  .analysis-box,.bc{min-width:unset}
}
</style>
</head>
<body>
<h1>TOP6 值得关注个股深度汇总</h1>
<div class="subtitle">数据日期：${displayDate} | 生成时间：${data.generatedAt} | 分析来源：china-stock-analysis 当天流程 + 东方财富行情/财务接口</div>
<div class="theme-wrap">${themes}</div>
<table class="summary">
<thead><tr>
<th></th><th>行业</th><th>股票</th><th>代码</th><th>股价</th><th>今日涨幅</th><th>换手率</th><th>总市值</th><th>PE(动)</th><th>星级</th><th>推荐理由</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>
<div class="footer">
  <div>免责声明：以上内容仅为基于公开信息的筛选与整理，不构成投资建议。</div>
  <div>汇总来源：${footerSources}</div>
</div>
<script>
function toggle(row){
  const detail = row.nextElementSibling;
  const opened = row.classList.contains('open');
  document.querySelectorAll('tr.srow.open').forEach(el => el.classList.remove('open'));
  document.querySelectorAll('tr.detail-row.open').forEach(el => el.classList.remove('open'));
  if(!opened){
    row.classList.add('open');
    detail.classList.add('open');
  }
}
</script>
</body>
</html>`;
}

const { date, input } = parseArgs();
const data = readJson(input);
validateAnalysisInput(data, input, date);
const html = buildHtml(data, date);
const outputPath = path.join(
  paths.reportsDir,
  resolvePattern(HTML_CONFIG.outputPattern || 'stock_report_{date}.html', date)
);
fs.mkdirSync(paths.reportsDir, { recursive: true });
fs.writeFileSync(outputPath, html, 'utf8');
console.log(`HTML generated: ${outputPath}`);
