/**
 * 新浪财经日 K 线静态图下载脚本。
 *
 * 用法:
 *   node scripts/screenshot.js [--date YYYYMMDD] [--stocks JSON] [--concurrency N]
 */
const path = require('path');
const fs = require('fs');
const https = require('https');
const { ROOT_DIR, config, paths } = require('./lib/report_config');

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

function buildStockImageUrl(stock) {
  const marketCode = String(stock.market).toLowerCase() === 'sh' ? 'sh' : 'sz';
  return `https://image.sinajs.cn/newchart/daily/n/${marketCode}${stock.code}.gif`;
}

function removeStaleShots(outputDir, stock, keepFilename) {
  if (!fs.existsSync(outputDir)) return;

  const suffix = `_${stock.name}_${stock.code}`;
  for (const file of fs.readdirSync(outputDir)) {
    if (file === keepFilename) continue;
    if (!file.startsWith(`${stock.seq ?? stock.rank ?? ''}_`) && !file.includes(suffix)) continue;
    if (!file.includes(suffix)) continue;
    fs.unlinkSync(path.join(outputDir, file));
  }
}

function downloadBinary(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0 Safari/537.36',
          Referer: 'https://finance.sina.com.cn/',
        },
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`http_${response.statusCode}`));
          return;
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`timeout_${timeoutMs}`));
    });
    request.on('error', reject);
  });
}

async function downloadStockChart(stock, outputDir) {
  const url = buildStockImageUrl(stock);
  const filename = `${stock.seq ?? stock.rank ?? '00'}_${stock.name}_${stock.code}.gif`;
  const outputPath = path.join(outputDir, filename);
  const startTime = Date.now();
  const maxRetries = Number(config.screenshots?.downloadRetries) || 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const buffer = await downloadBinary(url, 15000);
      if (buffer.length < 5000) {
        throw new Error(`image_too_small:${buffer.length}`);
      }

      removeStaleShots(outputDir, stock, filename);
      fs.writeFileSync(outputPath, buffer);

      const costMs = Date.now() - startTime;
      console.log(`  OK ${stock.code} ${stock.name} (${costMs}ms) => ${filename}`);
      return;
    } catch (error) {
      lastError = error;
      console.error(`  FAIL ${stock.code} attempt ${attempt}: ${error.message}`);
    }
  }

  throw lastError || new Error(`download_failed:${stock.code}`);
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

  const tasks = stocks.map((stock) => async () => {
    try {
      await downloadStockChart(stock, outputDir);
    } catch (error) {
      console.error(`  RETRY FAIL ${stock.code}: ${error.message}`);
    }
  });

  await runParallel(tasks, concurrency);
  console.log(`\n完成，总耗时 ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
})();
