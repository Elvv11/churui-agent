// ====== SerpAPI 搜索代理 + 信源信誉引擎 (Netlify Function) ======

const HARDCODED_AUTHORITIES = [
  {domain:'cninfo.com.cn', source:'巨潮资讯网', label:'高可信'},
  {domain:'csrc.gov.cn', source:'中国证监会', label:'高可信'},
  {domain:'semi.org', source:'SEMI', label:'高可信'},
  {domain:'semichina.org', source:'SEMI中国', label:'高可信'},
  {domain:'stats.gov.cn', source:'国家统计局', label:'高可信'},
  {domain:'miit.gov.cn', source:'工信部', label:'高可信'},
  {domain:'cnipa.gov.cn', source:'国家知识产权局', label:'高可信'},
  {domain:'ctbpsp.com', source:'招标投标平台', label:'高可信'},
  {domain:'ccgp.gov.cn', source:'中国政府采购网', label:'高可信'},
  {domain:'qianlima.com', source:'千里马招标网', label:'中等可信'},
  {domain:'smtchina.com', source:'SMT China', label:'高可信'},
  {domain:'chuandong.com', source:'中国传动网', label:'高可信'},
  {domain:'qcc.com', source:'企查查', label:'中等可信'},
  {domain:'citics.com', source:'中信证券', label:'高可信'},
  {domain:'htsc.com', source:'华泰证券', label:'高可信'},
  {domain:'dwzq.com.cn', source:'东吴证券', label:'高可信'},
  {domain:'cindasc.com', source:'信达证券', label:'高可信'},
  {domain:'esmchina.com', source:'国际电子商情', label:'高可信'},
  {domain:'eet-china.com', source:'电子工程专辑', label:'中等可信'},
  {domain:'eeworld.com.cn', source:'电子工程世界', label:'中等可信'}
];

function extractDomain(url) {
  try { return url.replace(/^https?:\/\//,'').replace(/\/.*$/,'').replace(/^www\./,'').toLowerCase(); }
  catch(e) { return (url||'').toLowerCase(); }
}

function getSourceCredibility(url) {
  var domain = extractDomain(url||'');
  var match = HARDCODED_AUTHORITIES.find(function(d){ return domain === d.domain || domain.indexOf(d.domain)>=0 || d.domain.indexOf(domain)>=0; });
  if(match) return {level:'high', label:'高可信', source:match.source, color:'#059669'};
  if(/\.gov\.cn$|\.edu\.cn$|\.org\.cn$/.test(domain)) return {level:'medium', label:'中等可信', source:'政府/机构', color:'#b45309'};
  if(/36kr|huxiu|ifeng|sina|sohu|163\.com|eastmoney|stcn|cls\.cn|yicai/.test(domain)) return {level:'medium', label:'中等可信', source:'知名媒体', color:'#b45309'};
  return {level:'low', label:'需核实', source:'未验证来源', color:'#dc2626'};
}

exports.handler = async function(event) {
  var headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  try {
    var body = JSON.parse(event.body || '{}');
    var query = body.query;
    if (!query) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: '缺少 query' }) };
    }

    var SERPAPI_KEY = process.env.SERPAPI_KEY;
    if (!SERPAPI_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'SerpAPI 密钥未配置' }) };
    }

    console.log('[search] 查询:', query.slice(0, 80));

    var sq = encodeURIComponent(query);
    var serpResp = await fetch('https://serpapi.com/search.json?engine=baidu&q=' + sq + '&api_key=' + SERPAPI_KEY);
    var serpData = await serpResp.json();

    if (serpData.error) {
      console.warn('[search] SerpAPI错误:', serpData.error);
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ error: serpData.error, hint: 'SerpAPI 返回错误，可能是额度用完了', sources: [], promptText: '' })
      };
    }

    var items = [];
    if (serpData.organic_results) {
      serpData.organic_results.slice(0, 10).forEach(function(r) {
        var snippet = r.snippet || r.title || '';
        if (snippet) items.push({ text: snippet, url: r.link||'', title: r.title||'', credibility: getSourceCredibility(r.link||'') });
      });
    }

    items.sort(function(a,b) {
      var order = {high:0, medium:1, low:2};
      return (order[a.credibility.level]||2) - (order[b.credibility.level]||2);
    });

    var sources = [];
    var promptText = '';

    if (items.length > 0) {
      var highCount = items.filter(function(it){return it.credibility.level==='high';}).length;
      var medCount = items.filter(function(it){return it.credibility.level==='medium';}).length;
      var lowCount = items.filter(function(it){return it.credibility.level==='low';}).length;

      promptText = '\n\n【联网搜索·百度引擎·信源信誉已评级】\n';
      promptText += '（搜索统计：🔵高可信' + highCount + '条 / 🟡中等可信' + medCount + '条 / 🔴需核实' + lowCount + '条）\n';

      items.forEach(function(item, i) {
        var credTag = item.credibility.level === 'high' ? '🔵' : (item.credibility.level === 'medium' ? '🟡' : '🔴');
        promptText += '[' + (i+1) + '] ' + credTag + ' ' + item.credibility.source + '：' + item.text + (item.url ? ' (URL:' + item.url + ')' : '') + '\n';
        if (item.url) sources.push({ num: i+1, url: item.url, title: item.title.slice(0,80), credibility: item.credibility });
      });

      promptText += '\n请在回答中用[1][2]角标引用，优先采信🔵高可信来源。对标注🔴需核实的来源，必须在引用时提示建议人工核实。禁止编造搜索结果中没有的具体信息。';
    } else {
      var eq = encodeURIComponent(query);
      promptText = '\n\n（⚠️ 搜索未返回结果。请基于知识库回答。📎 手动搜索：https://www.baidu.com/s?wd=' + eq + '）\n';
    }

    console.log('[search] 完成:', sources.length, '条来源');
    return { statusCode: 200, headers, body: JSON.stringify({ sources: sources, promptText: promptText }) };
  } catch(e) {
    console.error('[search] 异常:', e.message);
    var eq2 = encodeURIComponent(body ? body.query || '' : '');
    return { statusCode: 200, headers, body: JSON.stringify({ error: e.message, sources: [], promptText: '\n\n（搜索请求失败，请基于知识库回答。📎 手动搜索：https://www.baidu.com/s?wd=' + eq2 + '）\n' }) };
  }
};
