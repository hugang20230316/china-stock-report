const fs = require('fs');
const path = require('path');

const SKILL_ROOT = path.resolve(__dirname, '..', '..');
const ROOT_DIR = process.env.CHINA_STOCK_REPORT_ROOT
  ? path.resolve(process.env.CHINA_STOCK_REPORT_ROOT)
  : SKILL_ROOT;
const CONFIG_PATH = process.env.CHINA_STOCK_REPORT_CONFIG
  ? path.resolve(process.env.CHINA_STOCK_REPORT_CONFIG)
  : path.join(ROOT_DIR, 'config', 'report.config.json');

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `缺少配置文件: ${CONFIG_PATH}\n` +
      '可设置 CHINA_STOCK_REPORT_ROOT 指向工作区，或设置 CHINA_STOCK_REPORT_CONFIG 指向配置文件。'
    );
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function resolvePath(targetPath) {
  if (!targetPath) {
    return ROOT_DIR;
  }
  return path.isAbsolute(targetPath) ? targetPath : path.join(ROOT_DIR, targetPath);
}

function resolvePattern(pattern, date) {
  return String(pattern || '').replace('{date}', date);
}

const config = readConfig();
const paths = Object.fromEntries(
  Object.entries(config.paths || {}).map(([key, value]) => [key, resolvePath(value)])
);

module.exports = {
  SKILL_ROOT,
  ROOT_DIR,
  CONFIG_PATH,
  config,
  paths,
  resolvePath,
  resolvePattern,
};
