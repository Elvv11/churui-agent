// ====== 爬虫工具库 ======
const { supabase } = require('./supabase');

// 带超时的 fetch
async function fetchWithTimeout(url, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
      }
    });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

// 关键词匹配
const KEYWORDS = [
  '贴片机', 'SMT', '伺服电机', '贴装', '封装', '半导体',
  '国产替代', '先进封装', 'SiP', 'BGA', 'TSV',
  '路远', '易通', '木几', 'ASM', '松下', '富士', '雅马哈',
  '西门子', 'THK', '安川', '楚瑞', '滑块', '花键',
  '招标', '中标', '采购', '设备更新'
];

function matchKeywords(text) {
  if (!text) return [];
  const found = [];
  const lower = text.toLowerCase();
  KEYWORDS.forEach(kw => {
    if (lower.includes(kw.toLowerCase())) found.push(kw);
  });
  return found;
}

// 通用爬取：取 HTML 页面，提取 title
async function crawlPage(url) {
  try {
    const resp = await fetchWithTimeout(url, 8000);
    if (!resp.ok) return null;
    const html = await resp.text();

    // 简单提取 title（不依赖 cheerio，轻量化）
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // 尝试提取 meta description
    const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"[^>]*>/i)
      || html.match(/<meta[^>]*content="([^"]+)"[^>]*name="description"[^>]*>/i);
    const snippet = descMatch ? descMatch[1].trim() : '';

    return { title, snippet };
  } catch (e) {
    console.warn('[crawler] 爬取失败:', url, e.message);
    return null;
  }
}

// 去重后存入 Supabase
async function dedupAndStore(source, results) {
  if (!supabase) {
    console.warn('[crawler] Supabase未配置，跳过存储');
    return 0;
  }
  if (!results || results.length === 0) return 0;

  let stored = 0;
  for (const item of results) {
    if (!item.url || !item.title) continue;
    try {
      // 检查是否已存在
      const { data: existing } = await supabase
        .from('crawled_data')
        .select('id')
        .eq('url', item.url)
        .limit(1);

      if (existing && existing.length > 0) continue;

      // 存储新记录
      const { error } = await supabase
        .from('crawled_data')
        .insert({
          source,
          title: item.title.slice(0, 500),
          url: item.url,
          snippet: (item.snippet || '').slice(0, 1000),
          keywords: matchKeywords((item.title + ' ' + (item.snippet || '')).slice(0, 500))
        });

      if (!error) stored++;
    } catch (e) {
      console.warn('[crawler] 存储失败:', item.url, e.message);
    }
  }
  return stored;
}

// 生成每日摘要
function summarizeCrawl(resultsBySource) {
  let summary = '';
  const total = Object.values(resultsBySource).reduce((sum, arr) => sum + arr.length, 0);
  if (total === 0) return '今日未发现新的行业情报。';

  summary += '今日共发现 ' + total + ' 条新情报：\n';
  Object.entries(resultsBySource).forEach(([source, items]) => {
    if (items.length > 0) {
      summary += '\n【' + source + '】' + items.length + '条\n';
      items.slice(0, 3).forEach(item => {
        summary += '  - ' + item.title.slice(0, 80) + '\n';
        const kw = matchKeywords(item.title + ' ' + (item.snippet || ''));
        if (kw.length > 0) summary += '    关键词：' + kw.slice(0, 5).join('、') + '\n';
      });
    }
  });
  return summary;
}

module.exports = {
  fetchWithTimeout,
  matchKeywords,
  crawlPage,
  dedupAndStore,
  summarizeCrawl,
  KEYWORDS
};
