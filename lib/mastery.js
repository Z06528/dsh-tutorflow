/**
 * 长期学习记忆。
 *
 * 它要回答的不是「这个学生考了几分」，而是四件能指导教学的事：
 *   - 哪些知识点他见过了、掌握到什么程度（带置信度，一次答对不算掌握）
 *   - 他错在哪一类（概念 / 步骤 / 计算 / 审题 / 记忆 / 表达）
 *   - 哪个知识点现在最该复习（按遗忘曲线排期）
 *   - 哪些说法曾经误导过他（误区记录）
 *
 * 全部是对纯数据的操作，时间可以注入，方便测试。
 */

/** 状态名与阈值。 */
const MAX_EVIDENCE = 40

/** 把知识点名归一，避免「概率密度函数」和「概率密度 函数」被存成两条。 */
export function normalizeConcept(label) {
  const raw = String(label || '').normalize('NFKC').trim()
  if (!raw) return 'untitled'
  const key = raw
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。；：、·.,;:!?！？"'“”‘’()（）[\]【】{}<>《》]/g, '')
    .slice(0, 60)
  return key || 'untitled'
}

function dayOf(at) {
  const d = at instanceof Date ? at : new Date(at)
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : new Date(0).toISOString().slice(0, 10)
}

function isoOf(at) {
  const d = at instanceof Date ? at : new Date(at)
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date(0).toISOString()
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n))
}

/** 新建一条掌握记录。 */
export function emptyRow(label, subject = '') {
  return {
    key: normalizeConcept(label),
    label: String(label || '').slice(0, 120),
    subject: String(subject || '').slice(0, 40),
    score: 30,
    confidence: 0,
    evidence: 0,
    correct: 0,
    partial: 0,
    wrong: 0,
    errors: {},
    days: [],
    firstAt: null,
    lastAt: null,
    ease: 2.3,
    intervalDays: 0,
    dueAt: null,
    reviews: 0,
    status: 'unknown',
  }
}

/**
 * 记录一次证据，并更新掌握度、置信度与复习排期。
 * @param {object} row 现有记录（可为空）。
 * @param {object} evidence {verdict, errorType, at, label, subject}
 * @returns {object} 新记录（不修改入参）。
 */
export function applyEvidence(row, evidence) {
  const at = isoOf(evidence.at || Date.now())
  const verdict = evidence.verdict === 'correct' || evidence.verdict === 'partial' ? evidence.verdict : 'incorrect'
  const next = { ...emptyRow(evidence.label || row?.label, evidence.subject || row?.subject), ...(row || {}) }
  next.errors = { ...(row?.errors || {}) }
  next.days = [...(row?.days || [])]

  // 移动平均：朝 100 / 60 / 0 靠近。越往后每次的冲击越小，避免一次发挥把分数拉满。
  const pull = verdict === 'correct' ? 0.32 : verdict === 'partial' ? 0.18 : 0.4
  next.score = clamp(Math.round(next.score + (verdict === 'correct' ? 100 - next.score : verdict === 'partial' ? 60 - next.score : 0 - next.score) * pull), 0, 100)

  next.evidence = (row?.evidence || 0) + 1
  if (verdict === 'correct') next.correct = (row?.correct || 0) + 1
  else if (verdict === 'partial') next.partial = (row?.partial || 0) + 1
  else next.wrong = (row?.wrong || 0) + 1

  if (verdict !== 'correct' && evidence.errorType && evidence.errorType !== 'none') {
    next.errors[evidence.errorType] = (next.errors[evidence.errorType] || 0) + 1
  }

  const day = dayOf(at)
  if (!next.days.includes(day)) next.days = [...next.days, day].slice(-12)
  if (!next.firstAt) next.firstAt = at
  next.lastAt = at

  // 间隔重复：答对拉长间隔，答错打回 1 天。跨天到场才算「复习过一次」。
  const wasDue = row?.dueAt ? new Date(row.dueAt).getTime() <= new Date(at).getTime() : false
  if (wasDue) next.reviews = (row?.reviews || 0) + 1
  if (verdict === 'correct') {
    next.ease = clamp(Number((next.ease + 0.1).toFixed(2)), 1.3, 2.8)
    next.intervalDays = row?.evidence ? Math.max(2, Math.round(Math.max(1, row.intervalDays || 1) * next.ease)) : 2
  } else if (verdict === 'partial') {
    next.ease = clamp(Number((next.ease - 0.15).toFixed(2)), 1.3, 2.8)
    next.intervalDays = Math.max(1, Math.round((row?.intervalDays || 1) * 0.6))
  } else {
    next.ease = clamp(Number((next.ease - 0.2).toFixed(2)), 1.3, 2.8)
    next.intervalDays = 1
  }
  next.dueAt = new Date(new Date(at).getTime() + next.intervalDays * 86400000).toISOString()

  next.confidence = computeConfidence(next, at)
  next.status = computeStatus(next)
  return next
}

/**
 * 置信度：证据条数 × 是否跨天到场 × 时效。
 * 一次答对最多给到 0.3 左右，这就是「不要仅凭一次答对认定掌握」的机械保证。
 */
export function computeConfidence(row, now = Date.now()) {
  const n = row?.evidence || 0
  if (!n) return 0
  const breadth = Math.min(1, n / 4)
  const spread = Math.min(1, (row.days?.length || 0) / 2)
  const ageDays = row.lastAt ? (new Date(now).getTime() - new Date(row.lastAt).getTime()) / 86400000 : 999
  const freshness = ageDays <= 1 ? 1 : ageDays <= 7 ? 0.9 : ageDays <= 30 ? 0.7 : 0.5
  return Number((breadth * (0.55 + 0.45 * spread) * freshness).toFixed(2))
}

/** 掌握状态。只有证据够多、分数够高、且跨天到场过，才允许叫「已掌握」。 */
export function computeStatus(row) {
  const e = row?.evidence || 0
  const s = row?.score ?? 30
  const days = row?.days?.length || 0
  if (!e) return 'unknown'
  if (s < 40) return 'shaky'
  if (e < 2) return 'introduced'
  if (s >= 85 && e >= 4 && days >= 2 && (row.reviews || 0) >= 1) return 'mastered'
  if (s >= 70 && e >= 3 && days >= 2) return 'solid'
  return 'practicing'
}

export const STATUS_LABEL = {
  unknown: '没接触',
  introduced: '刚接触',
  shaky: '不牢',
  practicing: '在练',
  solid: '稳了',
  mastered: '已掌握',
}

/**
 * 写入状态（纯函数风格：返回新的 mastery 对象）。
 * @param {object} mastery 现有 map。
 * @param {object} evidence 证据。
 */
export function recordMastery(mastery, evidence) {
  const key = normalizeConcept(evidence.label)
  const out = { ...(mastery || {}) }
  out[key] = applyEvidence(out[key], evidence)
  return out
}

/** 最该复习的若干条：已到期优先，然后按分数与置信度排。 */
export function dueForReview(mastery, now = Date.now(), limit = 3) {
  const rows = Object.values(mastery || {})
  const scored = rows
    .filter((row) => (row.evidence || 0) > 0 && row.status !== 'mastered')
    .map((row) => {
      const due = row.dueAt ? new Date(row.dueAt).getTime() : 0
      const overdueDays = due ? Math.max(0, (new Date(now).getTime() - due) / 86400000) : 0
      return { row, overdueDays, priority: overdueDays * 2 + (100 - (row.score || 0)) / 10 + (1 - (row.confidence || 0)) }
    })
    .sort((a, b) => b.priority - a.priority)
  return scored.filter((item) => item.overdueDays > 0).slice(0, limit).map((item) => item.row)
}

/** 最薄弱的若干个知识点。 */
export function weakest(mastery, limit = 3) {
  return Object.values(mastery || {})
    .filter((row) => (row.evidence || 0) > 0)
    .sort((a, b) => (a.score || 0) - (b.score || 0) || (b.wrong || 0) - (a.wrong || 0))
    .slice(0, limit)
}

/** 错误画像：哪一类错得最多。 */
export function errorProfile(mastery) {
  const totals = {}
  for (const row of Object.values(mastery || {})) {
    for (const [type, count] of Object.entries(row.errors || {})) {
      totals[type] = (totals[type] || 0) + count
    }
  }
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1])
  return { totals, dominant: sorted[0]?.[0] || 'none', sorted }
}

/** 汇总成给人看的一段。 */
export function summarize(mastery, now = Date.now()) {
  const rows = Object.values(mastery || {}).filter((row) => (row.evidence || 0) > 0)
  const solid = rows.filter((row) => row.status === 'solid' || row.status === 'mastered')
  const weak = weakest(mastery, 5)
  const due = dueForReview(mastery, now, 5)
  return {
    learned: rows.length,
    solid: solid.length,
    weak: weak.map((row) => ({ label: row.label, score: row.score, status: row.status, statusLabel: STATUS_LABEL[row.status] || row.status })),
    due: due.map((row) => ({ label: row.label, dueAt: row.dueAt, score: row.score })),
    dominantError: errorProfile(mastery).dominant,
  }
}

/** 兼容旧状态文件：把 v1 的 {score, attempts, wrong} 转成新行。 */
export function migrateRow(label, old) {
  const row = emptyRow(label)
  if (!old || typeof old !== 'object') return row
  const attempts = Number(old.attempts) || 0
  const wrong = Number(old.wrong) || 0
  const score = Number.isFinite(Number(old.score)) ? Number(old.score) : 30
  return {
    ...row,
    score: clamp(Math.round(score), 0, 100),
    evidence: attempts,
    correct: Math.max(0, attempts - wrong),
    wrong,
    confidence: attempts ? Math.min(0.5, (Math.min(1, attempts / 4) * 0.55)) : 0,
    status: attempts ? computeStatus({ evidence: attempts, score, days: [], reviews: 0 }) : 'unknown',
    firstAt: null,
    lastAt: null,
    dueAt: null,
    days: [],
  }
}

export { MAX_EVIDENCE }
