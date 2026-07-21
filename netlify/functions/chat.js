// ====== DeepSeek 聊天代理 (Netlify Function) ======
var fs = require('fs');
var path = require('path');

// 行为规则
var PROMPT_RULES = '\n===== 联网搜索失败处理规则（重要！）=====\n当联网搜索未能获取有效信息时：\n1. 先坦诚说"本次联网搜索未获取到实时信息"\n2. 基于知识库给出你能提供的最好答案\n3. 最后给出手动搜索建议——包括具体的百度搜索链接\n4. "最近"默认指近1-3个月。如果知识库数据不是近3个月的，必须提醒用户\n\n===== 回答格式（面向研发人员）=====\n1. 先用一句话给结论（直接回答问题）\n2. 涉及产品/零部件时，标注型号、规格、技术参数\n3. 标注来源：[知识库] / [联网搜索] / [通用知识]\n4. 涉及多个竞品/产品对比时，优先用表格呈现\n5. 联网搜索结果用[1][2]角标引用\n6. 不确定的技术细节，明确说"需要人工核实"\n7. 禁止编造任何具体事件、招标信息、政策细节、财务数据。搜不到就直说搜不到';

function loadKnowledgeBase() {
  try {
    var kbPath = path.join(process.cwd(), 'knowledge_base.json');
    var raw = fs.readFileSync(kbPath, 'utf-8');
    var kb = JSON.parse(raw);

    var t = '你是楚瑞智能科技（苏州）有限公司的"贴片机行业情报助手 v3.5"，团队共享版。\n';
    t += '核心定位：为研发人员提供精准到产品型号、零部件规格、技术参数级别的深度情报。\n\n';
    t += '===== 楚瑞智能科技 · 产品技术知识库 =====\n\n';

    // 公司
    t += '【公司】' + kb.company.name + '，' + kb.company.founded + '成立，' + kb.company.location + '。\n';
    if (kb.company.employees) t += '团队：' + kb.company.employees + '。\n';
    if (kb.company.ipSummary) t += '知识产权：' + kb.company.ipSummary + '。\n';
    t += '\n';

    // 核心产品
    t += '【核心产品线】\n';
    kb.products.forEach(function(p, i) {
      t += (i+1) + '. ' + p.name;
      if (p.application) t += '：用于' + p.application;
      if (p.maturity) t += '（成熟度：' + p.maturity + '）';
      t += '。';
      if (p.replaces) t += '替代：' + p.replaces + '。';
      if (p.specs) t += '规格：' + p.specs + '。';
      if (p.models && p.models.length > 0) {
        t += '\n  型号参数：';
        p.models.forEach(function(m) {
          t += '\n  ' + m.model + ' | 功率' + m.power + ' | 转速' + m.ratedSpeed + '/' + m.maxSpeed + ' | 转矩' + m.ratedTorque + '/' + m.peakTorque + ' | 重量' + m.weight;
        });
      }
      t += '\n';
    });

    // 竞品
    t += '\n【竞品产品级分析】\n';
    kb.competitors.domestic.forEach(function(c) {
      t += '- ' + c.name + '（官网' + c.website + '）：自研率' + c.selfDevelopRate + '，' + c.ipCount + 'IP。';
      var models = c.flagshipModels.map(function(m){ return m.model + '（' + m.type + '）'; });
      t += '主力型号：' + models.join(' | ') + '。';
      if (c.keyCustomers) t += '客户：' + c.keyCustomers.join('/') + '。';
      t += '\n';
    });

    // 市场 & 政策 & 客户
    if (kb.marketData) t += '\n【市场数据】' + kb.marketData.marketSize + '，' + kb.marketData.importRatio + '，国产化率' + kb.marketData.localizationRate + '。\n';
    if (kb.policies) t += '\n【政策】' + kb.policies.map(function(p){return p.name + '：' + p.detail;}).join('。') + '。\n';
    if (kb.targetCustomers) {
      t += '\n【江浙沪目标客户' + kb.targetCustomers.length + '家】\n';
      kb.targetCustomers.forEach(function(c) {
        t += '- ' + c.name;
        if (c.annualPurchase) t += '。年采购：' + c.annualPurchase;
        if (c.opportunity) t += ' → 楚瑞机会：' + c.opportunity;
        t += '\n';
      });
    }

    // 时效性
    var freshnessWarning = '';
    if (kb.lastUpdated) {
      var daysSince = Math.floor((Date.now() - new Date(kb.lastUpdated).getTime()) / 86400000);
      if (daysSince > 90) {
        freshnessWarning = '\n\n⚠️⚠️ 【知识库严重过时】已' + daysSince + '天未更新（上次：' + kb.lastUpdated + '），涉及政策/市场数据的回答可能严重过时。\n';
      } else if (daysSince > 30) {
        freshnessWarning = '\n\n⚠️ 【知识库过时提醒】已' + daysSince + '天未更新（上次：' + kb.lastUpdated + '），涉及政策/市场数据的回答请提醒用户核实。\n';
      }
    }

    return t + freshnessWarning + PROMPT_RULES;
  } catch(e) {
    console.error('知识库加载失败:', e.message);
    return '你是楚瑞智能科技（苏州）有限公司的"贴片机行业情报助手 v3"，团队共享版。知识库加载失败，使用精简模式。' + PROMPT_RULES;
  }
}

var SYSTEM_PROMPT = loadKnowledgeBase();
console.log('知识库已加载, 长度:', SYSTEM_PROMPT.length);

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
    var messages = body.messages;
    var searchPromptText = body.searchPromptText;

    if (!messages || !Array.isArray(messages)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: '缺少 messages' }) };
    }

    var DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
    if (!DEEPSEEK_API_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'DeepSeek API 密钥未配置' }) };
    }

    console.log('[chat] 消息数:', messages.length, ', 搜索文本长度:', (searchPromptText||'').length);

    // 构建消息：系统提示词 + 对话历史 + 搜索结果
    var reqMsgs = [{ role: 'system', content: SYSTEM_PROMPT }].concat(messages);
    if (searchPromptText && searchPromptText.trim()) {
      reqMsgs.push({ role: 'system', content: searchPromptText });
    }

    var resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
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
      var err = await resp.json().catch(function(){ return {}; });
      throw new Error(err.error?.message || 'DeepSeek请求失败(' + resp.status + ')');
    }

    var data = await resp.json();
    var reply = data.choices?.[0]?.message?.content || '（未返回内容）';
    console.log('[chat] 回复长度:', reply.length);

    return { statusCode: 200, headers, body: JSON.stringify({ reply: reply }) };
  } catch(e) {
    console.error('[chat] 异常:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
