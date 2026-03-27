/**
 * 一体化报告数据拉取脚本
 * 输入: --stocks JSON --date YYYYMMDD
 * 输出: JSON 到 stdout，包含每只股票的行情数据 + 财务数据
 *
 * 行情: 东方财富延迟行情 API
 * 财务: 东方财富 ZYZBAjaxNew API
 */
const https = require('https');
const http = require('http');

function parseArgs() {
  const args = process.argv.slice(2);
  let stocks = [], date = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stocks' && args[i + 1]) { stocks = JSON.parse(args[i + 1]); i++; }
    else if (args[i] === '--date' && args[i + 1]) { date = args[i + 1]; i++; }
  }
  return { stocks, date };
}

function httpGet(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function formatReportDate(date) {
  if (!date || date.length !== 8) return '';
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

async function fetchQuoteFromKline(stock, date) {
  const secid = (stock.market === 'sh' ? '1' : '0') + '.' + stock.code;
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=20`;
  const targetDate = formatReportDate(date);
  const raw = await httpGet(url);
  const json = JSON.parse(raw);
  const klines = (json.data && json.data.klines) || [];
  if (!klines.length) {
    throw new Error('kline empty');
  }

  const matched = [...klines].reverse().find((item) => !targetDate || item.startsWith(targetDate)) || klines[klines.length - 1];
  const parts = matched.split(',');
  if (parts.length < 11) {
    throw new Error('kline format invalid');
  }

  return {
    price: Number(parts[2]).toFixed(2),
    change: Number(parts[8]).toFixed(2),
    turnover: Number(parts[10]).toFixed(2),
  };
}

// 东方财富延迟行情
async function fetchQuote(stock, date) {
  const secid = (stock.market === 'sh' ? '1' : '0') + '.' + stock.code;
  const url = `https://push2delay.eastmoney.com/api/qt/stock/get?fields=f43,f44,f45,f46,f47,f48,f50,f57,f58,f116,f117,f162,f170&secid=${secid}`;
  try {
    const raw = await httpGet(url);
    const json = JSON.parse(raw);
    const d = json.data;
    if (!d) return null;
    const quote = {
      price: (d.f43 / 100).toFixed(2),
      change: (d.f170 / 100).toFixed(2),
      turnover: (d.f50 / 100).toFixed(2),
      mcap: Math.round(d.f116 / 100000000),
      pe: d.f162 > 0 ? (d.f162 / 100).toFixed(2) : (d.f162 < 0 ? 'loss' : '-')
    };

    // 次日盘前有时会返回 0 价，回退到报告日的日K收盘数据，避免把 0 写进正式报告。
    if (Number(quote.price) <= 0) {
      const klineQuote = await fetchQuoteFromKline(stock, date);
      quote.price = klineQuote.price;
      quote.change = klineQuote.change;
      quote.turnover = klineQuote.turnover;
    }

    return quote;
  } catch (e) {
    return { error: e.message };
  }
}

// 东方财富财务数据
async function fetchFinance(stock) {
  const prefix = stock.market === 'sh' ? 'SH' : 'SZ';
  const code = prefix + stock.code;
  // type=1 年报, type=0 季报
  const urlAnnual = `https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew?type=1&code=${code}`;
  const urlQuarter = `https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew?type=0&code=${code}`;
  try {
    const [annualRaw, quarterRaw] = await Promise.all([httpGet(urlAnnual), httpGet(urlQuarter)]);
    const annual = JSON.parse(annualRaw);
    const quarter = JSON.parse(quarterRaw);

    // 取最近 4 个完整年度
    const annualData = (annual.data || []).slice(0, 4).reverse();
    // 取最新一期季报
    const latestQ = (quarter.data || [])[0];

    const profit = [], revenue = [], years = [];
    annualData.forEach(d => {
      const y = d.REPORT_DATE ? d.REPORT_DATE.slice(0, 4) : '?';
      years.push(y);
      profit.push(d.PARENTNETPROFIT ? (d.PARENTNETPROFIT / 1e8).toFixed(2) : 0);
      revenue.push(d.TOTALOPERATEREVE ? Math.round(d.TOTALOPERATEREVE / 1e8) : 0);
    });

    if (latestQ) {
      const qDate = latestQ.REPORT_DATE || '';
      const qYear = qDate.slice(2, 4);
      const qMonth = qDate.slice(5, 7);
      let qLabel = qYear + 'Q?';
      if (qMonth === '03') qLabel = qYear + 'Q1';
      else if (qMonth === '06') qLabel = qYear + 'H1';
      else if (qMonth === '09') qLabel = qYear + 'Q3';
      else if (qMonth === '12') qLabel = qYear + 'FY';
      years.push(qLabel);
      profit.push(latestQ.PARENTNETPROFIT ? (latestQ.PARENTNETPROFIT / 1e8).toFixed(2) : 0);
      revenue.push(latestQ.TOTALOPERATEREVE ? Math.round(latestQ.TOTALOPERATEREVE / 1e8) : 0);
    }

    return { profit: profit.map(Number), revenue: revenue.map(Number), years };
  } catch (e) {
    return { error: e.message };
  }
}

(async () => {
  const { stocks, date } = parseArgs();
  if (!stocks.length) { console.error('No stocks'); process.exit(1); }

  // 全部并行拉取
  const results = await Promise.all(stocks.map(async s => {
    const [quote, finance] = await Promise.all([fetchQuote(s, date), fetchFinance(s)]);
    return { code: s.code, name: s.name, market: s.market, quote, finance };
  }));

  console.log(JSON.stringify(results, null, 2));
})();
