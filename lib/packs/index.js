/**
 * 课程包注册表。可选增强，不是前提。
 *
 * 一个包只做三件事：认出自己该接管哪个问题、给更贴合的内容种子、
 * 给更准的误区句式。匹配不到就返回 null，通用路线接手。
 */
import { CONTINUOUS_PACK, LAPLACE_PACK } from './probability.js'

export const PACKS = [LAPLACE_PACK, CONTINUOUS_PACK]

/**
 * 找出应该接管的课程包。
 * @param {string} text 学生原话或题目原文。
 * @param {string} [kind] 只找 'course' 或 'exam'。
 * @returns {object|null}
 */
export function matchPack(text, kind) {
  const s = String(text || '')
  if (!s.trim()) return null
  for (const pack of PACKS) {
    if (kind && pack.kind !== kind) continue
    if (pack.match.test(s)) return pack
  }
  return null
}

/** 按 id 取包。 */
export function packById(id) {
  return PACKS.find((pack) => pack.id === id) || null
}

/** 这个文本是不是一道课程包认识的考题。 */
export function isExamProblem(text) {
  const pack = matchPack(text, 'exam')
  return Boolean(pack)
}

/** 这个文本是不是一个课程包认识的知识点。 */
export function isCourseTopic(text) {
  const pack = matchPack(text, 'course')
  return Boolean(pack)
}
