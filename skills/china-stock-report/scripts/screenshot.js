/**
 * 东方财富行情页日 K 线截图脚本（并行优化版）。
 *
 * 改进：
 * - 只截日 K 线部分，不含成交量和技术指标
 * - 截图前关闭广告弹窗
 * - 并行多 tab，默认并发从配置读取
 * - 失败自动重试 1 次
 *
 * 用法:
 *   node scripts/screenshot.js [--date YYYYMMDD] [--stocks JSON] [--concurrency N]
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { ROOT_DIR, config, paths } = require('./lib/report_config');

function loadPlaywright() {
  const homeDir = os.homedir();
  const fallbackPaths = [
    process.env.STOCK_PLAYWRIGHT_PATH,
    path.join(ROOT_DIR, 'node_modules', 'playwright'),
    path.join(homeDir, '.cache', 'opencode', 'node_modules', 'playwright'),
    path.join(
      homeDir,
      '.claude',
      'plugins',
      'marketplaces',
      'claude-plugins-official',
      'external_plugins',
      'playwright'
    ),
    path.join(homeDir, '.codex', 'vendor_imports', 'skills', 'skills', '.curated', 'playwright'),
  ].filter(Boolean);

  try {
    return require('playwright');
  } catch (_) {
    for (const fallbackPath of fallbackPaths) {
      try {
        return require(fallbackPath);
      } catch (_) {
        // 继续尝试下一个候选路径
      }
    }

    throw new Error('无法加载 playwright。请先安装依赖，或设置 STOCK_PLAYWRIGHT_PATH。');
  }
}

const { chromium } = loadPlaywright();

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

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let stocks = [];
  let concurrency = Number(config.screenshots?.defaultConcurrency) || 3;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      date = args[i + 1];
      i++;
    } else if (args[i] === '--stocks' && args[i + 1]) {
      stocks = JSON.parse(args[i + 1]);
      i++;
    } else if (args[i] === '--concurrency' && args[i + 1]) {
      concurrency = parseInt(args[i + 1], 10);
      i++;
    }
  }

  stocks = stocks.map((stock, index) => ({
    ...stock,
    seq: stock.seq ?? String(index + 1).padStart(2, '0'),
  }));

  return { date, stocks, concurrency };
}

function removeStaleShots(outputDir, stock, keepFilename) {
  if (!fs.existsSync(outputDir)) return;

  const suffix = `_${stock.name}_${stock.code}.jpeg`;
  for (const file of fs.readdirSync(outputDir)) {
    if (file === keepFilename) continue;
    if (!file.endsWith(suffix)) continue;
    fs.unlinkSync(path.join(outputDir, file));
  }
}

async function closePopups(page) {
  const closed = await page.evaluate(() => {
    let removed = 0;

    document.querySelectorAll('a, button, span, div').forEach((el) => {
      const text = (el.textContent || '').trim();
      if (text === '关闭' || text === '×') {
        try {
          el.click();
          removed++;
        } catch (_) {
          // 忽略单点失败
        }
      }
    });

    document.querySelectorAll('div, section, aside').forEach((el) => {
      const style = window.getComputedStyle(el);
      const zIndex = parseInt(style.zIndex, 10) || 0;
      const position = style.position;
      if ((position === 'fixed' || position === 'absolute') && zIndex > 100 && el.offsetWidth > 150 && el.offsetHeight > 150) {
        try {
          el.remove();
          removed++;
        } catch (_) {
          // 忽略单点失败
        }
      }
    });

    document.querySelectorAll('[class*=mask], [class*=overlay], [class*=modal]').forEach((el) => {
      try {
        el.remove();
        removed++;
      } catch (_) {
        // 忽略单点失败
      }
    });

    return removed;
  });

  if (closed > 0) {
    await page.waitForTimeout(300);
  }
}

async function screenshotStock(context, stock, outputDir) {
  const url = `https://quote.eastmoney.com/${stock.market}${stock.code}.html`;
  const filename = `${stock.seq ?? stock.rank ?? '00'}_${stock.name}_${stock.code}.jpeg`;
  const outputPath = path.join(outputDir, filename);
  const startTime = Date.now();

  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.k_chart', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);

    await closePopups(page);
    await page.waitForTimeout(300);

    const pageTitle = await page.title();
    if (pageTitle.includes('登录') || pageTitle.includes('验证')) {
      throw new Error(`need_login: ${pageTitle}`);
    }

    const clipInfo = await page.evaluate(() => {
      const kChart = document.querySelector('.k_chart');
      if (!kChart) return null;

      const chartRect = kChart.getBoundingClientRect();
      const quotaPanel = kChart.querySelector('.__quota, .kt-pad, .cmfb_img');
      const quotaRect = quotaPanel ? quotaPanel.getBoundingClientRect() : null;
      const topInset = Math.round(chartRect.height * 0.12);
      const rightInset = quotaRect ? Math.ceil(quotaRect.width) + 6 : 0;
      const mainChartHeight = Math.round(chartRect.height * 0.40);

      return {
        x: Math.round(chartRect.x) - 2,
        y: Math.round(chartRect.y + topInset),
        width: Math.round(chartRect.width - rightInset) + 4,
        height: mainChartHeight,
      };
    });

    if (!clipInfo) {
      console.error(`  WARN ${stock.code}: K 线元素未找到，跳过`);
      return;
    }

    removeStaleShots(outputDir, stock, filename);

    await page.screenshot({
      path: outputPath,
      type: 'jpeg',
      quality: 92,
      clip: clipInfo,
      timeout: 0,
    });

    const costMs = Date.now() - startTime;
    console.log(`  OK ${stock.code} ${stock.name} (${costMs}ms) => ${filename}`);
  } catch (error) {
    console.error(`  FAIL ${stock.code}: ${error.message}`);
    if (error.message.includes('need_login')) throw error;
  } finally {
    await page.close();
  }
}

async function runParallel(tasks, concurrency) {
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const taskIndex = index++;
      await tasks[taskIndex]();
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, tasks.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
}

(async () => {
  const { date, stocks, concurrency } = parseArgs();
  if (!stocks.length) {
    console.log('No stocks. Use --stocks JSON');
    process.exit(1);
  }

  const outputDir = path.join(paths.assetsDir, date);
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`截图: ${stocks.length} 只, 并发: ${concurrency}, 目录: ${outputDir}`);
  const startTime = Date.now();

  const executablePath = resolveBrowserExecutable();
  if (executablePath) {
    console.log(`使用浏览器: ${executablePath}`);
  }
  const browser = await chromium.launch({
    headless: true,
    executablePath: executablePath || undefined,
  });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1600 } });

  const tasks = stocks.map((stock) => async () => {
    try {
      await screenshotStock(context, stock, outputDir);
    } catch (error) {
      if (error.message.includes('need_login')) throw error;
      console.log(`  RETRY ${stock.code}...`);
      try {
        await screenshotStock(context, stock, outputDir);
      } catch (retryError) {
        console.error(`  RETRY FAIL ${stock.code}: ${retryError.message}`);
      }
    }
  });

  try {
    await runParallel(tasks, concurrency);
  } catch (error) {
    if (error.message.includes('need_login')) {
      console.error('\n检测到登录或验证码，停止执行。');
    }
  }

  await browser.close();
  console.log(`\n完成，总耗时 ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
})();
