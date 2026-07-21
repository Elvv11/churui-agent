// ====== SerpAPI 搜索代理 + 信源信誉引擎 ======

// 硬编码权威来源（与前端保持一致）
const HARDCODED_AUTHORITIES = [
  {domain:'cninfo.com.cn', source:'巨潮资讯网(上市公司公告)', label:'高可信'},
  {domain:'csrc.gov.cn', source:'中国证监会', label:'高可信'},
  {domain:'semi.org', source:'SEMI(国际半导体产业协会)', label:'高可信'},
  {domain:'semichina.org', source:'SEMI中国', label:'高可信'},
  {domain:'stats.gov.cn', source:'国家统计局', label:'高可信'},
  {domain:'miit.gov.cn', source:'工信部', label:'高可信'},
  {domain:'cnipa.gov.cn', source:'国家知识产权局', label:'高可信'},
  {domain:'ctbpsp.com', source:'中国招标投标公共服务平台', label:'高可信'},
  {domain:'ccgp.gov.cn', source:'中国政府采购网', label:'高可信'},
  {domain:'qianlima.com', source:'千里马招标网', label:'中等可信'},
  {domain:'smtchina.com', source:'SMT China表面组装技术', label:'高可信'},
  {domain:'chuandong.com', source:'中国传动网', label:'高可信'},
  {domain:'gg-led.com', source:'高工LED', label:'中等可信'},
  {domain:'qcc.com', source:'企查查', label:'中等可信'},
  {domain:'citics.com', source:'中信证券', label:'高可信'},
  {domain:'htsc.com', source:'华泰证券', label:'高可信'},
  {domain:'dwzq.com.cn', source:'东吴证券', label:'高可信'},
  {domain:'hczq.com', source:'华创证券', label:'高可信'},
  {domain:'cindasc.com', source:'信达证券', label:'高可信'},
  {domain:'esmchina.com', source:'国际电子商情', label:'高可信'},
  {domain:'laoyaoba.com', source:'集微网', label:'中等可信'},
  {domain:'eet-china.com', source:'电子工程专辑', label:'中等可信'},
  {domain:'eeworld.com.cn', source:'电子工程世界', label:'中等可信'},
  {domain:'icsmart.cn', source:'芯智讯', label:'中等可信'}
];

function extractDomain(url) {
  try {
    return url.replace(/^https?:\/\//,'').replace(/\/.*$/,'').replace(/^www\./,'').toLowerCase();
  } catch(e) { return (url||'').toLowerCase(); }
}

function getSourceCredibility(url, title) {
  const domain = extractDomain(url||'');
  const match = HARDCODED_AUTHORITIES.find(d => domain === d.domain || domain.includes(d.domain) || d.domain.includes(domain));
  if (match) return {level:'high', label:'高可信', source:match.source, color:'#059669'};
  if (/\.gov\.cn$|\.edu\.cn$|\.org\.cn$/.test(domain)) {
    return {level:'medium', label:'中等可信', source:'政府/机构域名', color:'#b45309'};
  }
  if (/36kr|huxiu|geekpark|ifeng|sina|sohu|163\.com|eastmoney|stcn|cls\.cn|yicai/.test(domain)) {
    return {level:'medium', label:'中等可信', source:'知名媒体', color:'#b45309'};
  }
  return {level:'low', label:'需核实', source:'未验证来源', color:'#dc2626'};
}

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST' });
  }

  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: '缺少 query 参数' });
    }

    const SERPAPI_KEY = process.env.SERPAPI_KEY;
    if (!SERPAPI_KEY) {
      return res.status(500).json({ error: 'SerpAPI 密钥未配置' });
    }

    console.log('[search] 查询:', query.slice(0, 80));

    const sq = encodeURIComponent(query);
    const serpResp = await fetch(`https://serpapi.com/search.json?engine=baidu&q=${sq}&api_key=${SERPAPI_KEY}`);
    const serpData = await serpResp.json();

    if (serpData.error) {
      console.warn('[search] SerpAPI错误:', serpData.error);
      return res.json({
        error: serpData.error,
        hint: 'SerpAPI 返回错误，可能是额度用完了。请检查 https://serpapi.com 账户。',
        sources: [],
        promptText: ''
      });
    }

    const items = [];
    if (serpData.organic_results) {
      serpData.organic_results.slice(0, 10).forEach(r => {
        const snippet = r.snippet || r.title || '';
        if (snippet) {
          items.push({
            text: snippet,
            url: r.link || '',
            title: r.title || '',
            credibility: getSourceCredibility(r.link || '', r.title || '')
          });
        }
      });
    }

    // 按信誉排序
    items.sort((a, b) => {
      const order = {high:0, medium:1, low:2};
      return (order[a.credibility.level]||2) - (order[b.credibility.level]||2);
    });

    const sources = [];
    let promptText = '';

    if (items.length > 0) {
      const highCount = items.filter(it => it.credibility.level === 'high').length;
      const medCount = items.filter(it => it.credibility.level === 'medium').length;
      const lowCount = items.filter(it => it.credibility.level === 'low').length;

      promptText = '\n\n【联网搜索·百度引擎·v3.4信源信誉已评级·引用见角标】\n';
      promptText += `（搜索统计：🔵高可信${highCount}条 / 🟡中等可信${medCount}条 / 🔴需核实${lowCount}条。优先采信高可信来源，对需核实来源谨慎引用。）\n`;

      items.forEach((item, i) => {
        const credTag = item.credibility.level === 'high' ? '🔵' : (item.credibility.level === 'medium' ? '🟡' : '🔴');
        promptText += `[${i+1}] ${credTag} ${item.credibility.source}：${item.text}${item.url ? ' (URL:' + item.url + ')' : ''}\n`;

        if (item.url) {
          sources.push({
            num: i + 1,
            url: item.url,
            title: item.title.slice(0, 80),
            credibility: item.credibility
          });
        }
      });

      promptText += '\n请在回答中用[1][2]角标引用，优先采信🔵高可信来源。对标注🔴需核实的来源，必须在引用时提示"此信息来自未验证来源，建议人工核实"。禁止编造搜索结果中没有的具体信息。';
    } else {
      const eq = encodeURIComponent(query);
      promptText = `\n\n（⚠️ 搜索未返回结果。SerpAPI免费额度可能已用完(100次/月)，请查 https://serpapi.com 。请基于知识库回答。📎 建议手动搜索：[百度：关键词](https://www.baidu.com/s?wd=${eq})）\n`;
    }

    console.log(`[search] 完成: ${sources.length}条来源 (高${items.filter(i=>i.credibility.level==='high').length}/中${items.filter(i=>i.credibility.level==='medium').length}/低${items.filter(i=>i.credibility.level==='low').length})`);

    return res.json({ sources, promptText });
  } catch (e) {
    console.error('[search] 异常:', e.message);
    const eq = encodeURIComponent(req.body?.query || '');
    return res.json({
      error: e.message,
      sources: [],
      promptText: `\n\n（联网搜索请求失败（网络错误），请基于知识库回答。📎 建议手动搜索：[百度：关键词](https://www.baidu.com/s?wd=${eq})）\n`
    });
  }
};
