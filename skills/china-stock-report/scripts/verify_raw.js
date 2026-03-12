/**
 * 验证 china_stock_analysis_raw_YYYYMMDD.json 的数字来自真实脚本输出。
 *
 * 用法:
 *   node scripts/verify_raw.js --date 20260312
 *   node scripts/verify_raw.js --raw data/raw/china_stock_analysis_raw_20260312.json \
 *                               --candidates data/tmp/candidates_20260312.json
 *
 * 验证逻辑:
 *   1. candidates 文件必须存在且是当天生成的
 *   2. raw 文件中每只股票的 code 必须出现在 candidates results 中
 *   3. raw 文件必须包含 _sourceProof，且其中的价格/PE/市值与 candidates 对齐
 *   4. raw 文件中不得出现 quote.* 字段
 *
 * 通过时打印 OK 并以 exit(0) 退出；失败时打印错误并以 exit(1) 退出。
 */

const fs = require('fs');
const path = require('path');
const { paths, resolvePath } = require('./lib/report_config');

const RAW_PREFIX = 'china_stock_analysis_raw_';
const CANDIDATES_PREFIX = 'candidates_';
const VALUE_TOLERANCE = 0.01;

function parseArgs() {
  const args = process.argv.slice(2);
  let date = '';
  let raw = '';
  let candidates = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      date = args[i + 1];
      i++;
    } else if (args[i] === '--raw' && args[i + 1]) {
      raw = args[i + 1];
      i++;
    } else if (args[i] === '--candidates' && args[i + 1]) {
      candidates = args[i + 1];
      i++;
    }
  }
  if (!date && !raw) throw new Error('缺少参数：--date YYYYMMDD 或 --raw 文件路径');

  if (!date && raw) {
    const match = path.basename(raw).match(/(\d{8})/);
    if (!match) throw new Error('无法从 raw 文件名推导日期');
    date = match[1];
  }
  if (!raw) raw = path.join(paths.rawDataDir, `${RAW_PREFIX}${date}.json`);
  if (!candidates) candidates = path.join(paths.rawDataDir, '..', 'tmp', `${CANDIDATES_PREFIX}${date}.json`);

  return { date, raw: resolvePath(raw), candidates: resolvePath(candidates) };
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`文件不存在: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isSameDay(isoString, date) {
  const prefix = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  return String(isoString || '').startsWith(prefix);
}

function toNum(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function assertClose(errors, label, actual, expected) {
  if (actual === null || expected === null) {
    errors.push(`${label} 缺少有效数字`);
    return;
  }
  if (Math.abs(actual - expected) > VALUE_TOLERANCE) {
    errors.push(`${label}=${actual} 与脚本输出=${expected} 不一致（误差超过 ${VALUE_TOLERANCE}）`);
  }
}

function main() {
  const { date, raw: rawPath, candidates: candidatesPath } = parseArgs();
  const errors = [];

  const rawData = readJson(rawPath);
  if (!fs.existsSync(candidatesPath)) {
    console.error(`\n验证失败：candidates 文件不存在: ${candidatesPath}`);
    console.error('\n请先运行 china-stock-analysis 的 stock_screener.py，生成当天候选池文件。');
    console.error(`建议输出路径：${path.join(path.dirname(candidatesPath), path.basename(candidatesPath))}\n`);
    process.exit(1);
  }
  const candidatesData = readJson(candidatesPath);

  if (!isSameDay(candidatesData.screen_time, date)) {
    errors.push(
      `candidates 文件的 screen_time (${candidatesData.screen_time}) 不是 ${date} 当天，请重新生成`
    );
  }

  const candidateMap = new Map();
  for (const item of candidatesData.results || []) {
    if (item['代码']) {
      candidateMap.set(String(item['代码']).padStart(6, '0'), item);
    }
  }

  for (const item of rawData.top6 || []) {
    const code = String(item.code || '').padStart(6, '0');
    const candidate = candidateMap.get(code);

    if (!candidate) {
      errors.push(`${item.name}(${code}) 不在 candidates 文件中，说明股票选择没有基于脚本输出`);
      continue;
    }

    if (item.quote && Object.keys(item.quote).length > 0) {
      errors.push(`${item.name}(${code}) raw 文件中存在 quote.* 字段，必须删除后再继续`);
    }

    const proof = item._sourceProof;
    if (!proof || typeof proof !== 'object') {
      errors.push(`${item.name}(${code}) 缺少 _sourceProof`);
      continue;
    }

    if (String(proof.rawCode || '').padStart(6, '0') !== code) {
      errors.push(`${item.name}(${code}) _sourceProof.rawCode 与 code 不一致`);
    }
    if (!isSameDay(proof.screenTime, date)) {
      errors.push(`${item.name}(${code}) _sourceProof.screenTime 不是 ${date} 当天`);
    }

    assertClose(errors, `${item.name}(${code}) _sourceProof.rawPrice`, toNum(proof.rawPrice), toNum(candidate['最新价']));
    assertClose(errors, `${item.name}(${code}) _sourceProof.rawPe`, toNum(proof.rawPe), toNum(candidate['市盈率']));
    assertClose(errors, `${item.name}(${code}) _sourceProof.rawMcap`, toNum(proof.rawMcap), toNum(candidate['总市值(亿)']));
  }

  if (errors.length > 0) {
    console.error('\n验证失败：raw 文件中的数据无法证明来自脚本输出\n');
    errors.forEach((error) => console.error(`  ✗ ${error}`));
    console.error('\n请先重新运行 china-stock-analysis 筛选流程，并按 raw-generation-spec 重新生成 raw 文件。\n');
    process.exit(1);
  }

  console.log(`验证通过：raw 文件与 candidates_${date}.json 对齐，共 ${(rawData.top6 || []).length} 只股票`);
  process.exit(0);
}

main();
