// ====== 每日行业情报爬虫 (Netlify Function) ======
var { fetchWithTimeout, crawlPage, dedupAndStore, summarizeCrawl } = require('../../lib/crawler.js');

var TARGETS = [
  {
    source: '千里马招标网',
    urls: [
      'https://www.qianlima.com/search?q=%E8%B4%B4%E7%89%87%E6%9C%BA',
      'https://www.qianlima.com/search?q=SMT'
    ]
  },
  {
    source: 'SEMI中国',
    urls: ['https://www.semichina.org/']
  }
];

exports.handler = async function(event) {
  var headers = { 'Access-Control-Allow-Origin': '*' };
  console.log('[crawl-daily] 开始每日爬取...');
  var startTime = Date.now();

  var resultsBySource = {};
  var totalStored = 0;

  for (var t = 0; t < TARGETS.length; t++) {
    var target = TARGETS[t];
    console.log('[crawl-daily] 爬取:', target.source);
    var items = [];

    for (var u = 0; u < target.urls.length; u++) {
      if (Date.now() - startTime > 8000) { console.warn('[crawl-daily] 超时'); break; }
      var url = target.urls[u];
      var result = await crawlPage(url);
      if (result && result.title) {
        items.push({ title: result.title, url: url, snippet: result.snippet || '' });
      }
    }

    if (items.length > 0) {
      var stored = await dedupAndStore(target.source, items);
      totalStored += stored;
      resultsBySource[target.source] = items;
      console.log('[crawl-daily]', target.source, ': 找到', items.length, '条, 新增', stored, '条');
    }
    await new Promise(function(r){ setTimeout(r, 500); });
  }

  var summary = summarizeCrawl(resultsBySource);
  var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('[crawl-daily] 完成:', totalStored, '条新增, 耗时', elapsed, 's');

  return {
    statusCode: 200, headers,
    body: JSON.stringify({ ok: true, stored: totalStored, elapsed: elapsed + 's', summary: summary })
  };
};
