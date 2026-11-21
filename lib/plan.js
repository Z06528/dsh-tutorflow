/**
 * 教学路线（plan）。
 *
 * 关键设计：路线有两条来路，任何一条都能独立工作。
 *   1. **引擎骨架**：按知识类型生成一条 3–4 步的通用路线。它不需要任何课程库，
 *      所以面对完全陌生的知识点也不会退化成普通问答。
 *   2. **模型自拟**：模型可以提交一条更贴合具体内容、带真实概念名和真实检查题的路线，
 *      覆盖骨架。引擎只校验形状（步数、每题一问、概念不重复），不校验内容。
 *
 * 课程包（course pack）只是第三条可选来路：把预置内容适配成同样的路线结构。
 */

import { STYLES } from './moves.js'

const MAX_STEPS = 8
const MAX_CONCEPT = 60

/** 把任意一句话收敛成「只含一个问号」的问题。 */
export function normalizeQuestion(text, fallback = '') {
  const raw = String(text || '').replace(/\r/g, ' ').replace(/\n+/g, ' ').trim()
  if (!raw) return fallback
  const parts = raw.split(/[？?]/).map((s) => s.trim()).filter(Boolean)
  if (!parts.length) return fallback
  // 只去掉句首空白与逗号句号；引号、括号是内容的一部分，不能吃掉。
  const first = parts[0].replace(/^[\s，,、。;；]+/u, '')
  return first ? `${first}？` : fallback
}

/** 把任意一句话收敛成「不含问号」的陈述。 */
export function normalizeStatement(text) {
  return String(text || '')
    .replace(/[？?]+/g, '，')
    .replace(/\s+/g, ' ')
    .trim()
}

function slug(text, index) {
  const base = normalizeStatement(text).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)
  return `${base || 'step'}-${index}`
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n))
}

/**
 * 生成一条与内容无关的路线骨架。它是「陌生知识点也能教」的兜底。
 * @param {object} input {topic, knowledgeType, complexity, moves}
 * @returns {object} plan
 */
export function scaffoldPlan({ topic, knowledgeType = 'concept', complexity = 2, moves = [] }) {
  const source = moves.length ? moves : [{ goal: '先把问题说清楚', move: 'anchor' }, { goal: '讲透最小的一块', move: 'explain' }, { goal: '用一个问题检查', move: 'check' }]
  const steps = source.map((item, index) => ({
    id: `s${index + 1}`,
    label: item.goal,
    concept: '',
    goal: item.goal,
    move: item.move,
    check: checkFor(topic, item.goal, item.move, index, source.length, knowledgeType),
    representations: representationsFor(knowledgeType),
    difficulty: clamp(Math.max(1, complexity - 1) + Math.min(2, index), 1, 5),
    track: false,
    status: index === 0 ? 'active' : 'pending',
    asked: 0,
    correct: 0,
    wrong: 0,
    evidence: 0,
  }))
  return {
    id: `plan-${Date.now().toString(36)}`,
    topic,
    knowledgeType,
    approach: '',
    source: 'scaffold',
    route: '',
    steps,
    cursor: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function representationsFor(knowledgeType) {
  const table = {
    concept: ['直观', '类比', '图形', '对比', '推导'],
    principle: ['现象', '机制', '类比', '图形', '推导'],
    procedure: ['示范', '分步', '图形', '反例'],
    code: ['心智模型', '最小例子', '执行追踪', '变体'],
    math: ['几何直观', '代数推导', '特殊值', '图形'],
    data: ['图形', '数值', '公式', '解释'],
    open: ['多视角', '证据', '反证', '综合'],
    fact: ['直答'],
    skill: ['示范', '分解', '练习'],
    mixed: ['直观', '类比', '图形', '推导'],
  }
  return table[knowledgeType] || STYLES
}

function checkFor(topic, goal, move, index, total, knowledgeType) {
  const t = topic || '这一点'
  if (move === 'anchor') {
    const anchors = {
      concept: `你能想到一个「${t}」出现的场景吗？生活里的、或者做题时见过的都行。`,
      principle: `关于「${t}」，你现在的印象是什么？`,
      procedure: `关于「${t}」，你试过的那一步做到了什么程度？`,
      code: `关于「${t}」，你写过或者读过相关的代码吗？`,
      math: `关于「${t}」，你已经会的部分到哪一步了？`,
      data: `关于「${t}」，你见过的数据大概是什么样子？`,
      open: `关于「${t}」，你现在的直觉更偏向哪一边？`,
      skill: `关于「${t}」，你现在能自己完成到哪一步？`,
      fact: `关于「${t}」，你想确认的是哪一点？`,
      mixed: `关于「${t}」，你最先想弄清哪一部分？`,
    }
    return anchors[knowledgeType] || anchors.concept
  }
  if (move === 'answer') return `关于「${t}」，你还需要我补充哪一个细节？`
  if (move === 'clarify') return `关于「${t}」，你自己现在的直觉更偏向哪一边？`
  if (move === 'condition') return `按刚才这条链条，「${t}」成立至少要满足哪一个条件？`
  if (move === 'counterfactual') return `如果刚才那个条件不成立，「${t}」会怎么变？`
  if (move === 'trace') return `如果只跑第一步，「${t}」里最先发生的是什么？`
  if (move === 'variant') return `把其中一个条件改掉，「${t}」的结果会跟着变吗？`
  if (move === 'derive') return `下一步该写什么？只写一行。`
  if (move === 'transfer') return `换一个看起来不一样的场景，这个方法还能用吗？`
  if (move === 'caveat') return `照这个结论推下去，最容易出错的地方在哪？`
  if (move === 'evidence') return `支持这个说法，你需要看到什么样的证据？`
  if (move === 'synthesize') return `综合来看，你自己会怎么判断「${t}」？`
  if (index === total - 1) return `用一句话把「${t}」讲给一个没学过的人听，你会怎么说？`
  return `关于这一步，你能用自己的话说一次吗？`
}

/**
 * 校验并规范化模型提交的路线。
 * 只校验形状：步数、概念名、每题一问、概念不重复。内容对不对由模型负责。
 * @param {object} input {topic, knowledgeType, approach, steps}
 * @param {object} base 现有 plan（用于继承 id / 时间）
 * @returns {{ok: boolean, plan: object|null, errors: string[], warnings: string[]}}
 */
export function validatePlan(input, base = null) {
  const errors = []
  const warnings = []
  const rawSteps = Array.isArray(input?.steps) ? input.steps : []
  if (!rawSteps.length) {
    return { ok: false, plan: null, errors: ['至少需要一步：每步包含一个概念名和一道检查题。'], warnings }
  }
  if (rawSteps.length > MAX_STEPS) {
    errors.push(`最多 ${MAX_STEPS} 步，当前 ${rawSteps.length} 步。把路线压短，不要一次排完整本书。`)
  }
  const seen = new Set()
  const steps = []
  rawSteps.slice(0, MAX_STEPS).forEach((raw, index) => {
    const concept = normalizeStatement(raw?.concept || raw?.label || raw?.goal || '').slice(0, MAX_CONCEPT)
    if (!concept) {
      errors.push(`第 ${index + 1} 步缺少概念名 concept。`)
      return
    }
    const key = concept.toLowerCase().replace(/\s+/g, '')
    if (seen.has(key)) {
      warnings.push(`第 ${index + 1} 步和前面重复了同一个概念「${concept}」，已保留第一次出现的那一步。`)
      return
    }
    seen.add(key)
    const rawCheck = String(raw?.check || raw?.ask || '').trim()
    if (!rawCheck) {
      warnings.push(`第 ${index + 1} 步没有给检查题，已按概念名生成一个。`)
    }
    const check = normalizeQuestion(rawCheck, `「${concept}」你现在能用自己的话说一次吗？`)
    if (/[？?].*[？?]/.test(rawCheck)) {
      warnings.push(`第 ${index + 1} 步的检查题包含多个问句，已只保留第一个——一次只问一个问题。`)
    }
    steps.push({
      id: typeof raw?.id === 'string' && raw.id ? raw.id.slice(0, 40) : slug(concept, index + 1),
      label: concept,
      concept,
      goal: normalizeStatement(raw?.goal || '').slice(0, 160),
      move: typeof raw?.move === 'string' ? raw.move.slice(0, 24) : 'explain',
      check,
      representations: Array.isArray(raw?.representations) && raw.representations.length
        ? raw.representations.map((s) => String(s).slice(0, 12)).slice(0, 6)
        : representationsFor(input?.knowledgeType),
      difficulty: clamp(Number(raw?.difficulty) || clamp(2 + index, 1, 5), 1, 5),
      track: true,
      status: index === 0 ? 'active' : 'pending',
      asked: 0,
      correct: 0,
      wrong: 0,
      evidence: 0,
    })
  })
  if (!steps.length) errors.push('没有可用的步骤。')
  if (errors.length) return { ok: false, plan: null, errors, warnings }
  const plan = {
    id: base?.id || `plan-${Date.now().toString(36)}`,
    topic: String(input?.topic || base?.topic || steps[0].concept).slice(0, 120),
    knowledgeType: input?.knowledgeType || base?.knowledgeType || 'concept',
    approach: normalizeStatement(input?.approach || '').slice(0, 240),
    route: normalizeStatement(input?.route || '').slice(0, 240),
    source: 'model',
    steps,
    cursor: 0,
    createdAt: base?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  return { ok: true, plan, errors, warnings }
}

/**
 * 把课程包适配成路线。课程包是可选的增强，不是前提。
 * @param {object} pack 课程包。
 * @param {object} [base] 现有 plan。
 */
export function planFromPack(pack, base = null) {
  const steps = (pack.steps || []).map((step, index) => ({
    id: step.id || `p${index + 1}`,
    label: step.concept || step.id || `第 ${index + 1} 步`,
    concept: step.concept || '',
    goal: step.open || '',
    move: 'explain',
    check: normalizeQuestion(step.ask, `关于「${step.concept || pack.topic}」，你怎么看？`),
    representations: Object.keys(step.styles || {}).length ? Object.keys(step.styles) : STYLES,
    difficulty: clamp(Number(step.difficulty) || index + 1, 1, 5),
    track: Boolean(step.concept),
    status: index === 0 ? 'active' : 'pending',
    asked: 0,
    correct: 0,
    wrong: 0,
    evidence: 0,
    seed: step.open || '',
    pack: {
      styles: step.styles || null,
      chart: step.chart || null,
      myths: step.myths || null,
      signals: step.signals || null,
      minHits: step.minHits || 1,
    },
  }))
  return {
    id: base?.id || `pack-${pack.id || 'course'}`,
    topic: pack.topic || pack.id,
    knowledgeType: pack.knowledgeType || 'concept',
    approach: pack.approach || '',
    route: pack.approach || '',
    source: 'pack',
    packId: pack.id,
    pack: { hints: pack.hints || null, solution: pack.solution || null, breakthrough: pack.breakthrough || null },
    steps,
    cursor: 0,
    createdAt: base?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/** 当前步骤。 */
export function currentStep(plan) {
  if (!plan || !Array.isArray(plan.steps)) return null
  return plan.steps[plan.cursor] || null
}

/** 路线跑完了没有。 */
export function isFinished(plan) {
  return !plan || !Array.isArray(plan.steps) || plan.cursor >= plan.steps.length
}

/** 一步能不能算过：证据数够、且没有连续错。 */
export function stepSettled(step, evidenceRequired = 2) {
  if (!step) return false
  return (step.evidence || 0) >= evidenceRequired
}

/** 把路线压成一行给模型看。 */
export function planLine(plan) {
  if (!plan?.steps?.length) return ''
  const parts = plan.steps.map((step, index) => {
    const mark = index < plan.cursor ? '✓' : index === plan.cursor ? '▶' : '·'
    return `${mark}${index + 1}.${step.label}`
  })
  return parts.join(' ')
}

/** 给状态快照用的精简结构。 */
export function planSnapshot(plan) {
  if (!plan) return null
  return {
    id: plan.id,
    topic: plan.topic,
    knowledgeType: plan.knowledgeType,
    source: plan.source,
    approach: plan.approach,
    cursor: plan.cursor,
    total: plan.steps?.length || 0,
    line: planLine(plan),
    steps: (plan.steps || []).map((step, index) => ({
      index,
      label: step.label,
      concept: step.concept,
      goal: step.goal,
      check: step.check,
      difficulty: step.difficulty,
      status: index < plan.cursor ? 'done' : index === plan.cursor ? 'active' : 'pending',
      evidence: step.evidence || 0,
      wrong: step.wrong || 0,
    })),
  }
}

export { MAX_STEPS }
