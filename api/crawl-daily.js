// ====== 每日行业情报爬虫（Vercel Cron 触发） ======
const { crawlPage, dedupAndStore, summarizeCrawl } = require('../lib/crawler');

// 爬取目标
const TARGETS = [
  {
    source: '巨潮资讯网',
    baseUrl: 'http://www.cninfo.com.cn/new/commonUrl?url=disclosure/list/notice',
    // 巨潮的公告列表页面（简化版，后续可优化为 API 调用）
    urls: [
      'http://www.cninfo.com.cn/new/disclosure'
    ]
  },
  {
    source: '千里马招标网',
    urls: [
      'https://www.qianlima.com/search?q=%E8%B4%B4%E7%89%87%E6%9C%BA',
      'https://www.qianlima.com/search?q=SMT'
    ]
  },
  {
    source: 'SEMI中国',
    urls: [
      'https://www.semichina.org/'
    ]
  }
];

module.exports = async function handler(req, res) {
  console.log('[crawl-daily] 开始每日爬取...');
  const startTime = Date.now();

  // Vercel Cron 验证
  const authHeader = req.headers.authorization;
  if (authHeader !== 'Bearer ' + (process.env.CRON_SECRET || 'churui-cron-secret')) {
    // 非 cron 触发时也允许手动触发（便于测试）
    console.log('[crawl-daily] 手动触发模式');
  }

  const resultsBySource = {};
  let totalStored = 0;

  for (const target of TARGETS) {
    console.log('[crawl-daily] 爬取:', target.source);
    const items = [];
    const urls = target.urls || [target.baseUrl];

    for (const url of urls) {
      // Vercel Hobby 10s 限制，提前退出
      if (Date.now() - startTime > 8000) {
        console.warn('[crawl-daily] 超时，跳过剩余目标');
        break;
      }

      const result = await crawlPage(url);
      if (result && result.title) {
        items.push({
          title: result.title,
          url: url,
          snippet: result.snippet || ''
        });
      }
    }

    if (items.length > 0) {
      const stored = await dedupAndStore(target.source, items);
      totalStored += stored;
      resultsBySource[target.source] = items;
      console.log('[crawl-daily]', target.source, ': 找到', items.length, '条, 新增', stored, '条');
    }

    // 来源间暂停
    await new Promise(r => setTimeout(r, 500));
  }

  const summary = summarizeCrawl(resultsBySource);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('[crawl-daily] 完成:', totalStored, '条新增, 耗时', elapsed, 's');
  console.log(summary);

  return res.status(200).json({
    ok: true,
    stored: totalStored,
    elapsed: elapsed + 's',
    summary,
    resultsBySource: Object.fromEntries(
      Object.entries(resultsBySource).map(([k, v]) => [k, v.length])
    )
  });
};
