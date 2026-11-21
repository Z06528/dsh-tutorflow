/**
 * 兼容层。
 *
 * 原来的 curriculum.js 既是「课程内容」又是「模式与策略」。升级后这两件事分开了：
 *   - 内容 → lib/packs/（可选课程包）
 *   - 模式与策略 → lib/moves.js
 *
 * 这个文件只保留旧的导出名，让已经引用了它的代码（包括旧测试）继续可用。
 * 新代码不要从这里取东西。
 */
import { LAPLACE_PACK, CONTINUOUS_PACK } from './packs/probability.js'
import { MODE_LABEL, MODES, STYLES, strategyFor } from './moves.js'
import { isCourseTopic, isExamProblem, matchPack } from './packs/index.js'

export { MODES, MODE_LABEL, STYLES, strategyFor }

/** 旧名字：连续型随机变量的五步课。 */
export const CONTINUOUS_LESSON = {
  id: CONTINUOUS_PACK.id,
  subject: CONTINUOUS_PACK.subject,
  chapter: CONTINUOUS_PACK.chapter,
  topic: CONTINUOUS_PACK.topic,
  match: CONTINUOUS_PACK.match,
  steps: CONTINUOUS_PACK.steps,
}

/** 旧名字：拉普拉斯密度考题。 */
export const LAPLACE_EXAM = {
  id: LAPLACE_PACK.id,
  match: LAPLACE_PACK.match,
  problem: LAPLACE_PACK.problem,
  type: LAPLACE_PACK.type,
  concepts: LAPLACE_PACK.concepts,
  breakthrough: LAPLACE_PACK.breakthrough,
  steps: LAPLACE_PACK.steps.map((step) => ({ id: step.id, ask: step.ask, signals: step.signals, minHits: step.minHits, myths: step.myths })),
  hints: LAPLACE_PACK.hints,
  solution: LAPLACE_PACK.solution,
}

export function isContinuousTopic(text) {
  const pack = matchPack(text, 'course')
  return Boolean(pack && pack.id === CONTINUOUS_PACK.id)
}

export function isLaplaceProblem(text) {
  const pack = matchPack(text, 'exam')
  return Boolean(pack && pack.id === LAPLACE_PACK.id)
}

/**
 * 从学生的自然语言里认出想换哪种模式。
 * 只做「显式换了」的判断，不猜意图。
 * @param {string} text 学生原话。
 */
export function detectMode(text) {
  const s = String(text || '')
  if (/查漏补缺|查漏|薄弱环节|哪里不会/.test(s)) return 'gap'
  if (/自主探索|我自己推|别告诉我公式|不要提示公式|探索模式/.test(s)) return 'explore'
  if (/快速讲解|快速解释|直接讲|简明地说|快点讲/.test(s)) return 'brief'
  if (/考题攻坚|攻坚模式/.test(s)) return 'exam'
  if (/循序渐进|从头讲|系统学|基础开始/.test(s)) return 'scaffold'
  if (/切换|换成|改为/.test(s)) {
    if (/快速/.test(s)) return 'brief'
    if (/探索/.test(s)) return 'explore'
    if (/查漏/.test(s)) return 'gap'
    if (/考题|攻坚/.test(s)) return 'exam'
    if (/循序/.test(s)) return 'scaffold'
  }
  return null
}

export { isCourseTopic, isExamProblem }
