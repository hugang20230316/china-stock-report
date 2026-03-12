/**
 * 使用本机 Chrome/Edge 无头模式截取报告 HTML 预览图。
 *
 * 用法:
 *   node scripts/capture_report_preview.js --date 20260312
 *   node scripts/capture_report_preview.js --input reports/stock_report_20260312.html --output assets/readme/stock_report_preview.png
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');
const { ROOT_DIR, paths, resolvePath, resolvePattern } = require('./lib/report_config');

function parseArgs() {
  const args = process.argv.slice(2);
  let date = '';
  let input = '';
  let output = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      date = args[i + 1];
      i++;
    } else if (args[i] === '--input' && args[i + 1]) {
      input = args[i + 1];
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      output = args[i + 1];
      i++;
    }
  }

  if (!input && !date) {
    throw new Error('缺少参数，请传 --date YYYYMMDD 或 --input HTML 文件路径');
  }

  if (!input) {
    input = path.join(paths.reportsDir, resolvePattern('stock_report_{date}.html', date));
  } else {
    input = resolvePath(input);
  }

  if (!date) {
    const match = path.basename(input).match(/(\d{8})/);
    if (!match) {
      throw new Error('无法从 HTML 文件名推导日期');
    }
    date = match[1];
  }

  if (!output) {
    output = path.join(paths.assetsDir, date, 'report_preview.png');
  } else {
    output = resolvePath(output);
  }

  return { date, input, output };
}

function resolveBrowserExecutable() {
  const candidates = [
    process.env.STOCK_BROWSER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    path.join(process.env['ProgramFiles'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean);

  const resolved = candidates.find((candidate) => fs.existsSync(candidate));
  if (!resolved) {
    throw new Error('未找到可用的 Chrome/Edge，可通过 STOCK_BROWSER_EXECUTABLE_PATH 指定浏览器路径');
  }
  return resolved;
}

function main() {
  const { input, output } = parseArgs();
  if (!fs.existsSync(input)) {
    throw new Error(`HTML 文件不存在: ${input}`);
  }

  const browserPath = resolveBrowserExecutable();
  const inputUrl = pathToFileURL(path.resolve(input)).href;

  fs.mkdirSync(path.dirname(output), { recursive: true });

  const result = spawnSync(
    browserPath,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--virtual-time-budget=3000',
      '--window-size=1600,2200',
      `--screenshot=${path.resolve(output)}`,
      inputUrl,
    ],
    {
      cwd: ROOT_DIR,
      encoding: 'utf8',
    }
  );

  if (result.status !== 0) {
    throw new Error(
      [
        `浏览器截图失败: ${browserPath}`,
        result.stdout ? `stdout:\n${result.stdout}` : '',
        result.stderr ? `stderr:\n${result.stderr}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    );
  }

  console.log(`Preview generated: ${path.resolve(output)}`);
}

main();
