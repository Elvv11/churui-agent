// ====== DeepSeek 聊天代理 + 知识库加载 ======
const fs = require('fs');
const path = require('path');

// 模块级缓存：知识库文本
let cachedKbText = null;
let cachedKbVersion = null;
let cachedKbDays = null;

// 行为规则（从前端 PROMPT_RULES 迁移）
const PROMPT_RULES = `
===== 联网搜索失败处理规则（重要！）=====
当联网搜索（SerpAPI百度引擎）未能获取有效信息时：
1. 先坦诚说"本次联网搜索未获取到实时信息"
2. 基于知识库给出你能提供的最好答案
3. 最后给出手动搜索建议——包括具体的百度搜索链接。格式：
   📎 建议手动搜索：
   - [百度：关键词](https://www.baidu.com/s?wd=URL编码关键词)
   - [行业参考网站](URL)
   每个建议必须是可点击的超链接
4. "最近"默认指近1-3个月。如果知识库数据不是近3个月的，必须提醒用户

===== 回答格式（面向研发人员）=====
1. 先用一句话给结论（直接回答问题）
2. 涉及产品/零部件时，标注型号、规格、技术参数（如果知识库中有）
3. 标注来源：[知识库] / [联网搜索] / [通用知识] / [手动建议]
4. 知识库中提到的公司名、产品型号、展会名称、机构名，如果知识库中有对应URL，必须附上可点击链接
5. 涉及多个竞品/产品对比时，优先用表格呈现（型号 vs 关键参数 vs 楚瑞机会）
6. 联网搜索结果用[1][2]角标引用
7. 如果你不确定某个技术细节，明确说"需要人工核实"并给出核实途径（具体网站、联系人建议等）
8. 禁止编造任何具体事件、招标信息、政策细节、财务数据。搜不到就直说搜不到`;

function loadKnowledgeBase() {
  try {
    const kbPath = path.join(process.cwd(), 'knowledge_base.json');
    const raw = fs.readFileSync(kbPath, 'utf-8');
    const kb = JSON.parse(raw);

    // 构建知识库文本
    let t = '你是楚瑞智能科技（苏州）有限公司的"贴片机行业情报助手 v3.4"，团队共享版。\n';
    t += '你的核心定位：为研发人员提供精准到产品型号、零部件规格、技术参数级别的深度情报，而非泛泛的行业资讯。\n\n';
    t += '===== 楚瑞智能科技 · 产品技术知识库 =====\n\n';

    // 公司信息
    t += '【公司】' + kb.company.name + '，' + kb.company.founded + '成立，' + kb.company.location + '。\n';
    if (kb.company.founder) t += '创始人：' + kb.company.founder + '。\n';
    if (kb.company.employees) t += '团队：' + kb.company.employees + '。\n';
    if (kb.company.ipSummary) t += '知识产权：' + kb.company.ipSummary + '。\n';
    if (kb.company.revenue) t += '营收：2021年' + kb.company.revenue['2021'] + '万/2022年' + kb.company.revenue['2022'] + '万。\n';
    t += '\n';

    // 核心产品线
    t += '【核心产品线】\n';
    kb.products.forEach((p, i) => {
      t += (i+1) + '. ' + p.name;
      if (p.application) t += '：用于' + p.application;
      if (p.maturity) t += '（成熟度：' + p.maturity + '）';
      t += '。';
      if (p.replaces) t += '替代：' + p.replaces + '。';
      if (p.specs) t += '规格：' + p.specs + '。';
      if (p.features) t += '特点：' + p.features + '。';
      if (p.advantages) t += '优势：' + p.advantages + '。';
      if (p.customerCases) t += '客户案例：' + p.customerCases + '。';
      if (p.models && p.models.length > 0) {
        t += '\n  型号参数：';
        p.models.forEach(m => {
          t += '\n  ' + m.model + ' | 功率' + m.power + ' | 转速' + m.ratedSpeed + '/' + m.maxSpeed + ' | 转矩' + m.ratedTorque + '/' + m.peakTorque + ' | 重量' + m.weight;
        });
      }
      t += '\n';
    });

    // 竞品
    t += '\n【竞品产品级分析】\n';
    kb.competitors.domestic.forEach(c => {
      t += '- ' + c.name + '（官网' + c.website + '）：自研率' + c.selfDevelopRate + '，' + c.ipCount + 'IP。';
      const models = c.flagshipModels.map(m => m.model + '（' + m.type + '）');
      t += '主力型号：' + models.join(' | ') + '。';
      if (c.keyCustomers) t += '客户：' + c.keyCustomers.join('/') + '。';
      t += '\n';
    });

    // 市场数据
    if (kb.marketData) {
      t += '\n【市场数据】' + kb.marketData.marketSize + '，' + kb.marketData.importRatio + '，国产化率' + kb.marketData.localizationRate + '。';
      if (kb.marketData.keyTrend) t += '关键趋势：' + kb.marketData.keyTrend + '。\n';
    }

    // 政策
    if (kb.policies && kb.policies.length > 0) {
      t += '\n【政策】';
      t += kb.policies.map(p => p.name + '：' + p.detail).join('。') + '。\n';
    }

    // 目标客户（摘要）
    if (kb.targetCustomers && kb.targetCustomers.length > 0) {
      t += '\n【江浙沪目标客户' + kb.targetCustomers.length + '家】\n';
      kb.targetCustomers.forEach(c => {
        t += '- ' + c.name;
        if (c.annualPurchase) t += '。年采购：' + c.annualPurchase;
        if (c.opportunity) t += ' → 楚瑞机会：' + c.opportunity;
        t += '\n';
      });
    }

    // 行业参考资源
    if (kb.industryResources) {
      t += '\n【行业参考资源】\n';
      if (kb.industryResources.media) {
        t += '- 行业媒体：' + kb.industryResources.media.map(m => m.name + '（' + m.url + '）').join(' | ') + '\n';
      }
      if (kb.industryResources.dataSources) {
        t += '- 数据来源：' + kb.industryResources.dataSources.map(d => d.name + '（' + d.url + '）').join(' | ') + '\n';
      }
      if (kb.industryResources.biddingPlatforms) {
        t += '- 招标平台：' + kb.industryResources.biddingPlatforms.map(b => b.name + '（' + b.url + '）').join(' | ') + '\n';
      }
    }

    // 时效性检查
    let freshnessWarning = '';
    if (kb.lastUpdated) {
      const daysSince = Math.floor((Date.now() - new Date(kb.lastUpdated).getTime()) / 86400000);
      cachedKbDays = daysSince;
      if (daysSince > 90) {
        freshnessWarning = '\n\n⚠️⚠️ 【知识库严重过时警告】知识库已' + daysSince + '天未更新（上次：' + kb.lastUpdated + '）。涉及政策、市场数据、竞品动态的回答可能严重过时。\n';
      } else if (daysSince > 30) {
        freshnessWarning = '\n\n⚠️ 【知识库过时提醒】知识库已' + daysSince + '天未更新（上次：' + kb.lastUpdated + '）。涉及政策、市场数据的回答请提醒用户核实时效性。\n';
      }
    }

    cachedKbVersion = kb.version || '?';
    cachedKbText = t;
    return t + freshnessWarning + PROMPT_RULES;
  } catch (e) {
    console.error('知识库加载失败:', e.message);
    // 兜底提示词
    return '你是楚瑞智能科技（苏州）有限公司的"贴片机行业情报助手 v3"，团队共享版。知识库配置文件加载失败，当前使用精简内置知识库运行。' + PROMPT_RULES;
  }
}

// 在模块加载时初始化知识库
const SYSTEM_PROMPT = loadKnowledgeBase();
console.log('知识库已加载 v' + cachedKbVersion + ', 距今' + (cachedKbDays||'?') + '天');

module.exports = async function handler(req, res) {
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
    const { messages, searchPromptText } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: '缺少 messages 参数' });
    }

    const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
    if (!DEEPSEEK_API_KEY) {
      return res.status(500).json({ error: 'DeepSeek API 密钥未配置' });
    }

    console.log('[chat] 收到请求, 消息数:', messages.length, ', 搜索文本长度:', (searchPromptText||'').length);

    // 构建消息列表：系统提示词 + 对话历史 + 搜索结果
    const reqMsgs = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];

    if (searchPromptText && searchPromptText.trim()) {
      reqMsgs.push({ role: 'system', content: searchPromptText });
    }

    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + DEEPSEEK_API_KEY
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: reqMsgs,
        temperature: 0.7,
        max_tokens: 3000
      })
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error?.message || 'DeepSeek请求失败(' + resp.status + ')');
    }

    const data = await resp.json();
    const reply = data.choices?.[0]?.message?.content || '（未返回内容）';

    console.log('[chat] 回复长度:', reply.length);

    return res.json({ reply });
  } catch (e) {
    console.error('[chat] 异常:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
