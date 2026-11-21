/**
 * 通用问题分类层。
 *
 * 这里没有课程库：只根据问题的**语言特征**判断「学生想干什么」「这是哪一类知识」
 * 「有多复杂」「大概站在哪」。任何一个从未被预设过的知识点都要能被这套判断覆盖，
 * 判断结果只影响教学动作的形状，不影响讲解内容——内容由当前模型负责。
 *
 * 全部是纯函数，不读磁盘、不访问网络、不看时间以外的外部状态。
 */

/** 学生意图。 */
export const INTENTS = ['learn', 'quick', 'exam', 'review', 'explore', 'chat']

/** 知识类型。它决定「一条好的讲解路线长什么样」，而不是决定讲什么。 */
export const KNOWLEDGE_TYPES = [
  'concept', // 概念是什么
  'principle', // 为什么会这样 / 机制
  'procedure', // 怎么做 / 分几步
  'code', // 代码与执行过程
  'math', // 形式化推导与计算
  'data', // 统计、数据解释
  'open', // 开放式问题，没有唯一答案
  'fact', // 简单事实
  'skill', // 需要练出来的技能
  'mixed',
]

/** 学科标签只用于记忆分组和语气，绝不用于决定能不能教。 */
export const SUBJECT_LABEL = {
  math: '数学',
  statistics: '统计',
  physics: '物理',
  chemistry: '化学',
  biology: '生物',
  computer: '计算机',
  economics: '经济',
  finance: '金融',
  psychology: '心理',
  history: '历史',
  philosophy: '哲学',
  language: '语言',
  engineering: '工程',
  medicine: '医学',
  law: '法律',
  earth: '地球科学',
  art: '艺术',
  daily: '日常科学',
  other: '未分类',
}

const SUBJECT_HINTS = {
  math: ['矩阵', '特征值', '特征向量', '行列式', '积分', '导数', '求导', '极限', '级数', '方程', '向量', '函数', '概率', '期望', '方差', '分布', '线性代数', '微积分', '拓扑', '群论', '定理', '证明', '不等式', '复数', '对数', '三角', 'matrix', 'eigen', 'integral', 'derivative', 'theorem', 'probability'],
  statistics: ['统计', '样本', '抽样', '置信区间', '假设检验', 'p值', 'p 值', '回归', '相关', '中心极限', '方差分析', '贝叶斯', '总体', '显著性', 'statistic', 'regression', 'p-value', 'bayes', 'confidence interval'],
  physics: ['物理', '力', '速度', '加速度', '能量', '动量', '电场', '磁场', '光', '波', '热', '熵', '升力', '浮力', '引力', '相对论', '量子', '电路', '电流', '电阻', '折射', '压强', '伯努利', 'force', 'energy', 'momentum', 'lift', 'quantum', 'relativity', 'entropy'],
  chemistry: ['化学', '分子', '原子', '化学键', '反应', '催化剂', '酸碱', '氧化', '摩尔', '有机', 'molecule', 'reaction', 'catalyst', 'ph '],
  biology: ['生物', '细胞', 'dna', '基因', '蛋白', '酶', '进化', '生态', '神经', '免疫', '代谢', '光合', 'cell', 'gene', 'protein', 'evolution', 'enzyme'],
  computer: ['代码', '编程', 'python', 'javascript', 'typescript', 'java', 'c++', 'golang', 'rust', '函数', '变量', '循环', '递归', '指针', '内存', '算法', '数据结构', '复杂度', '装饰器', '闭包', '异步', '并发', '数据库', 'sql', 'git', 'docker', 'api', 'http', '框架', '编译', 'decorator', 'closure', 'recursion', 'async', 'pointer', 'algorithm'],
  economics: ['经济', '机会成本', '边际', '供需', '供给', '需求', '通胀', '通货膨胀', 'gdp', '效用', '弹性', '博弈', '市场', '价格', '税收', '补贴', '外部性', '公共品', 'opportunity cost', 'marginal', 'supply', 'demand', 'inflation', 'game theory'],
  finance: ['金融', '利率', '复利', '股票', '债券', '期权', '期货', '贴现', '折现', '资产', '风险', '估值', '市盈率', 'portfolio', 'bond', 'option', 'discount', 'valuation'],
  psychology: ['心理', '认知', '记忆', '情绪', '动机', '人格', '行为', '偏见', '依恋', '认知失调', 'cognitive', 'memory', 'emotion', 'bias'],
  history: ['历史', '朝代', '战争', '革命', '帝国', '古代', '世纪', '条约', '王朝', 'history', 'dynasty', 'revolution'],
  philosophy: ['哲学', '伦理', '本体', '认识论', '自由意志', '正义', '功利', '存在', '道德', 'ethics', 'metaphysics', 'epistemology', 'free will'],
  language: ['语法', '语义', '词源', '英语', '翻译', '写作', '修辞', '句法', '发音', 'grammar', 'semantics', 'etymology', 'syntax'],
  engineering: ['工程', '机械', '结构', '材料', '控制', '信号', '齿轮', '轴承', '焊接', '机械设计', 'electronics', 'mechanical'],
  medicine: ['医学', '疾病', '症状', '诊断', '药物', '免疫', '病毒', '细菌', '手术', '临床', 'disease', 'diagnosis', 'drug'],
  law: ['法律', '法规', '合同', '侵权', '刑法', '民法', '判例', '权利', '义务', '诉讼', 'law', 'contract', 'tort'],
  earth: ['地质', '气候', '大气', '海洋', '板块', '地震', '火山', '天气', 'climate', 'geology', 'atmosphere'],
  art: ['艺术', '绘画', '音乐', '和声', '色彩', '设计', '构图', '摄影', '电影', 'art', 'music', 'design'],
  daily: ['天空', '为什么天', '彩虹', '影子', '冰', '沸腾', '下雨', '打雷', '镜子', '肥皂', '茶', '咖啡', '睡眠', '做梦', '脸红', '打哈欠', '蚊子', '猫', '狗'],
}

const INTENT_HINTS = {
  quick: ['快速', '直接说', '直接告诉', '一句话', '简明', '简单说', '简短', '别废话', '只要答案', '结论是', 'tl;dr', 'quick', 'just tell', 'briefly'],
  review: ['查漏补缺', '复习', '薄弱', '忘了', '捡起来', '巩固', '记忆', '回顾', 'review', 'revise', 'refresh'],
  explore: ['自主探索', '别告诉我', '不告诉我', '我自己想', '引导我', '追问我', '苏格拉底', '让我推', 'socratic', 'guide me', 'let me think'],
  exam: ['这道题', '考题', '考试题', '作业题', '习题', '不会做', '求解', '求证', '解方程', '选择题', '填空题', '大题', '卷子', 'exam', 'solve this', 'homework'],
  learn: ['什么是', '是什么', '为什么', '怎么', '如何', '解释', '原理', '区别', '理解', '不懂', '不明白', '想学', '教我', '讲解', '讲讲', '科普', '入门', '是什么意思', '怎么回事', 'what is', 'why ', 'how ', 'explain', 'understand', 'difference between'],
  chat: ['你好', '谢谢', '在吗', '早上好', '晚安', 'hello', 'hi ', 'thanks'],
}

const CODE_HINTS = ['python', 'javascript', 'typescript', 'java', 'c++', 'golang', 'rust', '代码', '编程', '装饰器', '闭包', '递归', '指针', '异步', '并发', '编译', '函数式', '面向对象', 'debug', '报错', '栈', '堆', 'decorator', 'closure', 'recursion', 'async', 'pointer', 'compiler', 'syntax error']
const MATH_HINTS = ['矩阵', '特征值', '积分', '求导', '导数', '极限', '级数', '方程', '向量', '概率', '期望', '方差', '定理', '证明', '不等式', '函数', '矩阵', '行列式', '复数', '多项式', '微积分', '线性代数', 'matrix', 'eigen', 'integral', 'derivative', 'theorem', 'proof']
const DATA_HINTS = ['统计', '样本', '中心极限', '置信区间', 'p值', 'p 值', '假设检验', '回归', '相关系数', '分布', '抽样', '显著性', '方差分析', '贝叶斯', 'statistic', 'regression', 'p-value', 'central limit', 'confidence', 'sample']
const PRINCIPLE_HINTS = ['为什么', '原理', '机制', '怎么产生的', '如何工作', 'why ', 'how does', 'how do', 'mechanism', 'principle', 'cause']
const PROCEDURE_HINTS = ['怎么', '如何', '步骤', '流程', '教程', '配置', '设置', '搭建', '安装', '操作', 'how to', 'steps', 'tutorial', 'setup', 'install']
const OPEN_HINTS = ['该不该', '应该吗', '哪个更好', '利弊', '值得吗', '有意义吗', '是否应该', '伦理', '未来会', '会不会', '如何看待', '评价', '观点', '争议', 'should i', 'better', 'pros and cons', 'ethics', 'opinion']
const FACT_HINTS = ['哪一年', '谁发明', '是谁', '多少人', '多少度', '是多少', '多少钱', '多长时间', '几个', '首都在', '缩写', '全称', '日期', '什么时候', 'what year', 'who invented', 'how many', 'how much', 'abbreviation']
const SKILL_HINTS = ['练习', '训练', '提高', '熟练', '手感', '怎么练', 'practice', 'training', 'drill', 'improve my']

const BEGINNER_HINTS = ['没学过', '完全不会', '零基础', '新手', '刚开始', '听不懂', '小白', '从头', 'never learned', 'beginner', "don't know", 'no idea', 'from scratch']
const PARTIAL_HINTS = ['学过一点', '有点印象', '记得一点', '好久没', '差不多忘了', '半懂', '模模糊糊', 'a while ago', 'vaguely', 'forgot most']
const ADVANCED_HINTS = ['已经很熟', '想深入', '进阶', '更严格', '证明一下', '严格地', 'advanced', 'rigorous', 'deeper']

/** 判断是否像一道待解的题（而不是在问一个概念）。 */
export function looksLikeProblem(text) {
  const s = String(text || '')
  if (s.length < 24) return false
  const demand = /求\s*[A-Za-zＰＰ]|求[^。？?]{0,8}(值|概率|期望|方差|导|积分|面积|体积)|证明|计算|化简|求解|求证|设\s*[A-Za-z]|已知/.test(s)
  const formal = /[fF]\s*\(\s*x\s*\)\s*=|∫|Σ|∑|分布函数|概率密度|矩阵\s*A|f\(x\)\s*=/.test(s)
  const numbered = /[（(]\s*[1-9一二三]\s*[)）]/.test(s)
  return (demand && s.length > 40) || (formal && demand) || numbered
}

function score(text, hints) {
  let total = 0
  const hits = []
  for (const hint of hints) {
    if (!hint) continue
    const needle = hint.toLowerCase()
    if (text.includes(needle)) {
      // 更长的词更具体，权重更高：命中「中心极限」比命中「极限」更能说明学科。
      total += hint.length >= 4 ? 3 : hint.length >= 3 ? 2 : 1
      hits.push(hint)
    }
  }
  return { total, hits }
}

function ranked(text, table, fallback) {
  let best = { key: fallback, total: 0, hits: [] }
  for (const [key, hints] of Object.entries(table)) {
    const got = score(text, hints)
    if (got.total > best.total) best = { key, ...got }
  }
  return best
}

/**
 * 判断学生想从这次对话里得到什么。
 * 显式传入的意图优先——模型比正则更懂上下文。
 * @param {string} text 学生原话。
 * @param {string} [explicit] 调用方显式给出的意图。
 * @returns {{intent: string, confidence: number, signals: string[]}}
 */
export function detectIntent(text, explicit) {
  if (INTENTS.includes(explicit)) return { intent: explicit, confidence: 1, signals: ['explicit'] }
  const s = String(text || '').toLowerCase()
  const got = ranked(s, INTENT_HINTS, null)
  let intent = got.key
  if (!intent) {
    // 没有明显词面线索时，按「是否像个提问」决定。
    intent = looksLikeProblem(text) ? 'exam' : /[？?]/.test(s) || s.length > 6 ? 'learn' : 'chat'
    return { intent, confidence: 0.4, signals: [] }
  }
  // 「想快速知道」和「想系统学」同时出现时，尊重快速——不要强行把对话变成课堂。
  if (got.key === 'learn' && /快速|直接|一句话|简短/.test(s)) intent = 'quick'
  const confidence = got.total >= 4 ? 0.85 : got.total >= 2 ? 0.65 : 0.5
  return { intent, confidence, signals: got.hits.slice(0, 4) }
}

/**
 * 判断这是什么类型的知识。它决定讲解路线的**形状**。
 * @param {string} text 学生原话。
 * @param {string} [explicit] 调用方显式给出的类型。
 * @returns {{knowledgeType: string, confidence: number, signals: string[], candidates: Array}}
 */
export function detectKnowledgeType(text, explicit) {
  if (KNOWLEDGE_TYPES.includes(explicit)) return { knowledgeType: explicit, confidence: 1, signals: ['explicit'], candidates: [] }
  const s = String(text || '').toLowerCase()
  const table = {
    code: CODE_HINTS,
    math: MATH_HINTS,
    data: DATA_HINTS,
    principle: PRINCIPLE_HINTS,
    procedure: PROCEDURE_HINTS,
    open: OPEN_HINTS,
    fact: FACT_HINTS,
    skill: SKILL_HINTS,
  }
  const candidates = Object.entries(table)
    .map(([key, hints]) => ({ key, ...score(s, hints) }))
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total)

  if (!candidates.length) {
    if (/什么是|是什么|是什么意思|概念|定义|区别/.test(s)) return { knowledgeType: 'concept', confidence: 0.5, signals: [], candidates }
    if (looksLikeProblem(text)) return { knowledgeType: 'math', confidence: 0.5, signals: [], candidates }
    return { knowledgeType: 'concept', confidence: 0.3, signals: [], candidates }
  }
  const top = candidates[0]
  // 数学题优先于「为什么」：一道形式化的题不要按原理课来讲。
  if (looksLikeProblem(text) && top.key !== 'code') {
    const mathish = candidates.find((row) => row.key === 'math' || row.key === 'data')
    if (mathish) return { knowledgeType: mathish.key, confidence: 0.7, signals: mathish.hits.slice(0, 4), candidates }
  }
  // 「该不该 / 为什么需要 / 哪个更好」这类问题没有唯一答案，走多视角路线，
  // 不要按单因果链去讲——否则学生会一直追问「到底哪个才是主要原因」。
  if (top.key !== 'code' && !looksLikeProblem(text) && /该不该|是否应该|值不值得|哪个更好|为什么[^？?]{0,12}(需要|应该)/.test(s)) {
    return { knowledgeType: 'open', confidence: 0.65, signals: top.hits.slice(0, 4), candidates }
  }
  // 问「什么是 X」但不是题：走概念路线，而不是解题路线。
  if (top.key === 'math' && !looksLikeProblem(text) && /什么是|是什么|概念|定义|区别|含义/.test(s)) {
    return { knowledgeType: 'concept', confidence: 0.6, signals: top.hits.slice(0, 4), candidates }
  }
  // 「定理 / 定律 / 为什么」这类问题问的是机制，按原理路线讲，而不是按解题路线。
  if (top.key !== 'code' && !looksLikeProblem(text) && /定理|定律|效应|法则|原理|机制|为什么|怎么会/.test(s)) {
    return { knowledgeType: 'principle', confidence: 0.65, signals: top.hits.slice(0, 4), candidates }
  }
  const confidence = top.total >= 6 ? 0.85 : top.total >= 3 ? 0.7 : 0.5
  return { knowledgeType: top.key, confidence, signals: top.hits.slice(0, 4), candidates: candidates.slice(0, 3) }
}

/**
 * 粗判学科。只用于记忆分组与举例风格，不参与「能不能教」。
 * @param {string} text 学生原话。
 * @param {string} [explicit] 显式学科。
 */
export function detectSubject(text, explicit) {
  if (explicit && String(explicit).trim()) return { subject: String(explicit).trim().slice(0, 40), label: String(explicit).trim().slice(0, 40), confidence: 1 }
  const s = String(text || '').toLowerCase()
  const best = ranked(s, SUBJECT_HINTS, 'other')
  const key = best.total > 0 ? best.key : 'other'
  return { subject: key, label: SUBJECT_LABEL[key] || SUBJECT_LABEL.other, confidence: best.total >= 4 ? 0.8 : best.total >= 2 ? 0.55 : 0.25 }
}

/**
 * 估计问题本身的复杂度（1–5），不是估计学生水平。
 * @param {string} text 学生原话。
 * @param {string} knowledgeType 知识类型。
 */
export function detectComplexity(text, knowledgeType) {
  const s = String(text || '')
  let level = 2
  if (knowledgeType === 'fact' || knowledgeType === 'chat') level = 1
  if (knowledgeType === 'open' || knowledgeType === 'principle') level = 3
  if (knowledgeType === 'math' || knowledgeType === 'data') level = 3
  if (knowledgeType === 'code' || knowledgeType === 'procedure') level = 2
  if (knowledgeType === 'skill') level = 3
  if (s.length > 120) level += 1
  if (/证明|推导|严格|一般地|n\s*维|多变量|联合分布|泛函|收敛/.test(s)) level += 1
  if (looksLikeProblem(s)) level += 1
  if (/[（(]\s*[1-9一二三]\s*[)）]/.test(s)) level += 1
  if (s.length < 8) level -= 1
  return Math.max(1, Math.min(5, level))
}

/**
 * 估计学生当前的基础。只作为第一个问题的依据，后面以实际回答为准。
 * @param {string} text 学生原话。
 */
export function detectLevel(text) {
  const s = String(text || '')
  if (BEGINNER_HINTS.some((h) => s.toLowerCase().includes(h))) return { level: 'beginner', confidence: 0.8 }
  if (PARTIAL_HINTS.some((h) => s.toLowerCase().includes(h))) return { level: 'partial', confidence: 0.7 }
  if (ADVANCED_HINTS.some((h) => s.toLowerCase().includes(h))) return { level: 'advanced', confidence: 0.6 }
  return { level: 'unknown', confidence: 0.2 }
}

/**
 * 一次性完成分类。任何字段都可以被调用方显式覆盖。
 * @param {string} question 学生的原始问题。
 * @param {object} [override] 显式覆盖：intent / subject / knowledgeType。
 */
export function classify(question, override = {}) {
  const text = String(question || '')
  const intent = detectIntent(text, override.intent)
  const knowledgeType = detectKnowledgeType(text, override.knowledgeType)
  const subject = detectSubject(text, override.subject)
  const complexity = detectComplexity(text, knowledgeType.knowledgeType)
  const level = detectLevel(text)
  return {
    intent: intent.intent,
    intentConfidence: intent.confidence,
    knowledgeType: knowledgeType.knowledgeType,
    knowledgeConfidence: knowledgeType.confidence,
    subject: subject.subject,
    subjectLabel: subject.label,
    subjectConfidence: subject.confidence,
    complexity,
    level: level.level,
    looksLikeProblem: looksLikeProblem(text),
    signals: {
      intent: intent.signals,
      knowledge: knowledgeType.signals,
      alternatives: knowledgeType.candidates.map((row) => row.key),
    },
  }
}
