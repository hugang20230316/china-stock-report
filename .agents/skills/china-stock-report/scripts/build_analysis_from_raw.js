/**
 * 根据 china-stock-analysis 当天 raw output 构建合规分析底稿。
 * 只允许从 data/raw/china_stock_analysis_raw_YYYYMMDD.json 读取，
 * 并使用 fetch_data.js 补齐当天行情与财务字段。
 *
 * 用法:
 *   node scripts/build_analysis_from_raw.js --date 20260312
 *   node scripts/build_analysis_from_raw.js --raw <workspace-root>/data/raw/china_stock_analysis_raw_20260312.json
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  SKILL_ROOT,
  ROOT_DIR,
  config,
  paths,
  resolvePath,
  resolvePattern,
} = require('./lib/report_config');

const HTML_CONFIG = config.htmlGeneration || {};
const RAW_FILE_PREFIX = 'china_stock_analysis_raw_';
const REQUIRED_ANALYSIS_FIELDS = ['core', 'earnings', 'valuation', 'catalyst', 'risk'];

function parseArgs() {
  const args = process.argv.slice(2);
  let date = '';
  let raw = '';
  let output = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      date = args[i + 1];
      i++;
    } else if (args[i] === '--raw' && args[i + 1]) {
      raw = args[i + 1];
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      output = args[i + 1];
      i++;
    }
  }

  if (!raw && !date) {
    throw new Error('缺少参数，请传 --date YYYYMMDD 或 --raw 原始输出文件路径');
  }

  if (!raw) {
    raw = path.join(paths.rawDataDir, `${RAW_FILE_PREFIX}${date}.json`);
  }

  raw = resolvePath(raw);

  if (!date) {
    const match = path.basename(raw).match(/(\d{8})/);
    if (!match) {
      throw new Error('无法从 raw 文件名推导日期');
    }
    date = match[1];
  }

  if (!output) {
    output = path.join(
      paths.analysisDir,
      resolvePattern(HTML_CONFIG.inputPattern || 'analysis_result_{date}.json', date)
    );
  } else {
    output = resolvePath(output);
  }

  return { date, raw, output };
}

function isPathInside(baseDir, targetPath) {
  const relative = path.relative(path.resolve(baseDir), path.resolve(targetPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assertUrlObject(item, label, errors) {
  if (!item || typeof item !== 'object') {
    errors.push(`${label} 不能为空`);
    return;
  }
  if (!item.title || typeof item.title !== 'string') {
    errors.push(`${label}.title 不能为空`);
  }
  if (!item.url || typeof item.url !== 'string') {
    errors.push(`${label}.url 不能为空`);
  }
}

function assertSourceProof(item, label, errors, date) {
  if (!item || typeof item !== 'object') {
    errors.push(`${label} 不能为空`);
    return;
  }

  if (!item.candidatesFile || typeof item.candidatesFile !== 'string') {
    errors.push(`${label}.candidatesFile 不能为空`);
  }
  if (!item.screenTime || typeof item.screenTime !== 'string') {
    errors.push(`${label}.screenTime 不能为空`);
  } else {
    const prefix = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    if (!item.screenTime.startsWith(prefix)) {
      errors.push(`${label}.screenTime 必须是 ${prefix} 当天生成的时间`);
    }
  }
  if (!/^\d{6}$/.test(String(item.rawCode || ''))) {
    errors.push(`${label}.rawCode 必须是 6 位股票代码`);
  }
  ['rawPrice', 'rawPe', 'rawMcap'].forEach((field) => {
    if (!Number.isFinite(Number(item[field]))) {
      errors.push(`${label}.${field} 必须是数字`);
    }
  });
}

function validateRawInput(rawData, rawPath, date) {
  const errors = [];
  const expectedTopCount = Number(HTML_CONFIG.requiredTopCount) || 6;
  const fileName = path.basename(rawPath);
  const expectedFileName = `${RAW_FILE_PREFIX}${date}.json`;
  const reportDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;

  if (!fs.existsSync(rawPath)) {
    errors.push(`原始输出文件不存在: ${rawPath}`);
  }
  if (!isPathInside(paths.rawDataDir, rawPath)) {
    errors.push('raw 文件必须位于 data/raw 目录下');
  }
  if (fileName !== expectedFileName) {
    errors.push(`raw 文件名必须为 ${expectedFileName}`);
  }
  if (rawData.reportDate && rawData.reportDate !== reportDate) {
    errors.push(`raw.reportDate 必须为 ${reportDate}`);
  }
  if (!Array.isArray(rawData.marketThemes) || rawData.marketThemes.length === 0) {
    errors.push('raw.marketThemes 不能为空');
  }
  if (!Array.isArray(rawData.summarySources) || rawData.summarySources.length === 0) {
    errors.push('raw.summarySources 不能为空');
  } else {
    rawData.summarySources.forEach((item, index) => {
      assertUrlObject(item, `raw.summarySources[${index}]`, errors);
    });
  }
  if (!Array.isArray(rawData.top6) || rawData.top6.length !== expectedTopCount) {
    errors.push(`raw.top6 必须存在且长度为 ${expectedTopCount}`);
  } else {
    rawData.top6.forEach((item, index) => {
      const prefix = `raw.top6[${index}]`;
      if (Number(item.rank) !== index + 1) {
        errors.push(`${prefix}.rank 必须按 1-${expectedTopCount} 顺序排列`);
      }
      if (!item.name || typeof item.name !== 'string') {
        errors.push(`${prefix}.name 不能为空`);
      }
      if (!/^\d{6}$/.test(String(item.code || ''))) {
        errors.push(`${prefix}.code 必须是 6 位股票代码`);
      }
      if (!/^(SH|SZ|sh|sz)$/.test(String(item.market || ''))) {
        errors.push(`${prefix}.market 必须为 SH/SZ`);
      }
      if (!item.industry || typeof item.industry !== 'string') {
        errors.push(`${prefix}.industry 不能为空`);
      }
      if (!item.rating || typeof item.rating !== 'string') {
        errors.push(`${prefix}.rating 不能为空`);
      }
      if (!Array.isArray(item.cycle) || item.cycle.length === 0) {
        errors.push(`${prefix}.cycle 不能为空`);
      }
      if (!item.reason || typeof item.reason !== 'string') {
        errors.push(`${prefix}.reason 不能为空`);
      }
      if (item.quote && Object.keys(item.quote).length > 0) {
        errors.push(`${prefix}.quote 不应出现在 raw 文件中，必须由 fetch_data.js 补齐`);
      }
      if (!item.analysis || typeof item.analysis !== 'object') {
        errors.push(`${prefix}.analysis 不能为空`);
      } else {
        REQUIRED_ANALYSIS_FIELDS.forEach((field) => {
          if (!item.analysis[field] || typeof item.analysis[field] !== 'string') {
            errors.push(`${prefix}.analysis.${field} 不能为空`);
          }
        });
      }
      if (!Array.isArray(item.sources) || item.sources.length === 0) {
        errors.push(`${prefix}.sources 不能为空`);
      } else {
        item.sources.forEach((source, sourceIndex) => {
          assertUrlObject(source, `${prefix}.sources[${sourceIndex}]`, errors);
        });
      }
      assertSourceProof(item._sourceProof, `${prefix}._sourceProof`, errors, date);
    });
  }

  if (errors.length) {
    throw new Error(
      '拒绝生成分析底稿：raw output 不符合 china-stock-analysis 正式报告输入要求。\n' +
      errors.map((item) => `- ${item}`).join('\n')
    );
  }
}

function runFetchData(stocks, date) {
  const fetchScript = path.join(SKILL_ROOT, 'scripts', 'fetch_data.js');
  const result = spawnSync(
    process.execPath,
    [fetchScript, '--stocks', JSON.stringify(stocks), '--date', date],
    {
      cwd: SKILL_ROOT,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 10,
    }
  );

  if (result.status !== 0) {
    throw new Error(
      `fetch_data.js 执行失败。\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`.trim()
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`fetch_data.js 输出不是合法 JSON: ${error.message}`);
  }

  return parsed;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizePe(value) {
  if (value === 'loss') {
    return '亏损';
  }
  if (value === undefined || value === null || value === '') {
    return '-';
  }
  return String(value);
}

function normalizeQuote(rawItem, fetchedItem) {
  const fetchedQuote = fetchedItem.quote || {};

  if (fetchedQuote.error) {
    throw new Error(`${rawItem.code} 行情抓取失败: ${fetchedQuote.error}`);
  }

  return {
    price: toNumber(fetchedQuote.price),
    changePct: toNumber(fetchedQuote.change),
    turnoverPct: toNumber(fetchedQuote.turnover),
    mcapYi: toNumber(fetchedQuote.mcap),
    peTtm: normalizePe(fetchedQuote.pe),
  };
}

function normalizeFinance(rawItem, fetchedItem) {
  const fetchedFinance = fetchedItem.finance || {};
  if (fetchedFinance.error) {
    throw new Error(`${rawItem.code} 财务抓取失败: ${fetchedFinance.error}`);
  }
  if (
    !Array.isArray(fetchedFinance.profit) ||
    !Array.isArray(fetchedFinance.revenue) ||
    !Array.isArray(fetchedFinance.years)
  ) {
    throw new Error(`${rawItem.code} 财务输出缺少 profit/revenue/years`);
  }

  return {
    profit: fetchedFinance.profit.map((item) => toNumber(item)),
    revenue: fetchedFinance.revenue.map((item) => toNumber(item)),
    years: fetchedFinance.years.map((item) => String(item)),
  };
}

function formatDateTime(dateObject) {
  const pad = (value) => String(value).padStart(2, '0');
  const year = dateObject.getFullYear();
  const month = pad(dateObject.getMonth() + 1);
  const day = pad(dateObject.getDate());
  const hours = pad(dateObject.getHours());
  const minutes = pad(dateObject.getMinutes());
  const seconds = pad(dateObject.getSeconds());
  const offsetMinutes = -dateObject.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offsetHours = pad(Math.floor(Math.abs(offsetMinutes) / 60));
  const offsetRemainder = pad(Math.abs(offsetMinutes) % 60);
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} ${sign}${offsetHours}:${offsetRemainder}`;
}

function buildAnalysisResult(rawData, rawPath, date, fetchedData) {
  const reportDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const fetchedMap = new Map(
    fetchedData.map((item) => [`${String(item.market).toUpperCase()}:${item.code}`, item])
  );

  const top6 = rawData.top6.map((item) => {
    const key = `${String(item.market).toUpperCase()}:${item.code}`;
    const fetchedItem = fetchedMap.get(key);
    if (!fetchedItem) {
      throw new Error(`缺少 ${item.name}(${item.code}) 的 fetch_data.js 输出`);
    }

    return {
      rank: Number(item.rank),
      name: item.name,
      code: String(item.code),
      market: String(item.market).toUpperCase(),
      industry: item.industry,
      rating: item.rating,
      cycle: item.cycle.map((cycle) => String(cycle)),
      score: item.score !== undefined ? Number(item.score) : null,
      reason: item.reason,
      quote: normalizeQuote(item, fetchedItem),
      finance: normalizeFinance(item, fetchedItem),
      analysis: {
        core: item.analysis.core,
        earnings: item.analysis.earnings,
        valuation: item.analysis.valuation,
        catalyst: item.analysis.catalyst,
        risk: item.analysis.risk,
      },
      sources: item.sources.map((source) => ({
        title: source.title,
        url: source.url,
      })),
    };
  });

  return {
    reportDate,
    generatedAt: formatDateTime(new Date()),
    marketThemes: rawData.marketThemes.map((item) => String(item)),
    summarySources: rawData.summarySources.map((item) => ({
      title: item.title,
      url: item.url,
    })),
    meta: {
      sourceSkill: 'china-stock-analysis',
      sourceType: 'raw-output',
      rawOutputConfirmed: true,
      rawOutputPath: path.relative(ROOT_DIR, rawPath),
      generatedFromHistory: false,
      builderScript: 'scripts/build_analysis_from_raw.js',
    },
    top6,
  };
}

function runVerifyRaw(rawPath, date) {
  const verifyScript = path.join(SKILL_ROOT, 'scripts', 'verify_raw.js');
  if (!fs.existsSync(verifyScript)) return;
  const result = spawnSync(
    process.execPath,
    [verifyScript, '--raw', rawPath, '--date', date],
    { cwd: SKILL_ROOT, encoding: 'utf8' }
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error('verify_raw.js 验证失败，拒绝生成分析底稿');
  }
}

function main() {
  const { date, raw, output } = parseArgs();
  if (!fs.existsSync(raw)) {
    throw new Error(`原始输出文件不存在: ${raw}`);
  }
  runVerifyRaw(raw, date);
  const rawData = readJson(raw);
  validateRawInput(rawData, raw, date);

  const stocks = rawData.top6.map((item) => ({
    code: String(item.code),
    market: String(item.market).toLowerCase(),
    name: item.name,
  }));
  const fetchedData = runFetchData(stocks, date);
  const analysisResult = buildAnalysisResult(rawData, raw, date, fetchedData);

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(analysisResult, null, 2)}\n`, 'utf8');
  console.log(`Analysis generated: ${output}`);
}

main();
