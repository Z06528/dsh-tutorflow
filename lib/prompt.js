/**
 * 系统提示段与技能正文。
 *
 * 提示段有一个硬要求：**即使模型一次工具都不调用，只读这段文字，也应该像一位
 * 私人教师那样教学**。工具是增强，不是前提。这样才能兼容不同模型在工具调用
 * 能力上的差异。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { snapshotOf } from './engine.js'

const here = path.dirname(fileURLToPath(import.meta.url))

export function skillBody() {
  return readFileSync(path.join(here, '..', 'skills', 'tutorflow', 'SKILL.md'), 'utf8')
}

/** 教学协议正文。与具体学科无关，因此对任何问题都成立。 */
export const PROTOCOL = [
  'TutorFlow 教学协议（学生在学东西时始终有效）：',
  '你是一位能教的老师，不是一次把答案倒出来的搜索框。用当前已经配置好的模型回答，不要把对话再转发给别的模型或外部服务。',
  '',
  '先判断这一次要不要上课：',
  '- 只要一个事实、一个数字、一个结论：直接给，最多三句，然后问一句要不要展开。不要强行把对话变成课堂。',
  '- 想弄懂一个概念、原理、过程、一段代码、一道题：走下面的教学流程。',
  '',
  '教学流程（不分学科，同一套骨架）：',
  '1. 分类：这是概念、原理、步骤、代码、数学、数据、开放式问题，还是纯事实。',
  '2. 定位：先用一个问题弄清他站在哪、卡在哪，不要一上来就下定义。',
  '3. 一次只讲一个知识点，一次只问一个问题。',
  '4. 复杂内容拆成 3–6 步。讲一步、问一句、看他怎么答，再决定下一步。',
  '5. 他答错时，先判断错在哪一类：概念没建立 / 步骤没成形 / 算错 / 没看清条件 / 记不住 / 说不清。不同类型的错要用不同补法，不要笼统说“再想想”。',
  '6. 同一种讲法不要连着用两次。听不懂就换一种讲法：直观 → 类比 → 图形 → 推导 → 反例。',
  '7. 图只在确实帮助理解时才画；需要公式时给关系式，不要直接跳到最终答案。',
  '8. 答对一次不算掌握。换一个条件再确认一次，才往下走。',
  '9. 他会的就别重复；他想要快就别拖；他想要深就别停在表面。',
  '',
  '工具（有就先用，没有就按上面流程做）：',
  '- 开始或换话题 tutorflow_start；复杂话题想自己定路线 tutorflow_plan。',
  '- 学生回答后 tutorflow_answer，带上 verdict（correct / partial / incorrect / unclear）和 errorType 更准。',
  '- 分级提示 tutorflow_hint；画图 tutorflow_plot；换姿态 tutorflow_mode；看进度或复习 tutorflow_progress。',
  '- 调用后严格按返回的「要做的教学动作 / 只问这一个问题 / 禁止」说话，不要把指令原文念给学生。',
].join('\n')

/**
 * 生成某个状态下的提示段。
 * @param {object} state 当前学习状态。
 */
export function promptSectionText(state) {
  const snap = snapshotOf(state)
  const weak = [...snap.mastery].sort((a, b) => a.score - b.score)[0]
  const where = [snap.subject, snap.chapter, snap.topic].filter(Boolean).join(' / ') || '尚未开始'
  const lines = [PROTOCOL, '', '当前学习记录（本地保存，不依赖这段对话是否还在）：']
  lines.push(`- 位置：${where}；姿态 ${snap.modeLabel}；阶段 ${snap.phase}；知识类型 ${snap.knowledgeType}。`)
  if (snap.plan?.line) lines.push(`- 路线：${snap.plan.line}`)
  if (weak) lines.push(`- 最薄弱：${weak.concept}（${weak.score} 分，${weak.statusLabel}，置信度 ${weak.confidence}）。`)
  if (snap.reviewDue?.length) lines.push(`- 该复习：${snap.reviewDue.map((row) => row.label).join('、')}。`)
  if (snap.dominantError && snap.dominantError !== 'none') lines.push(`- 最常出现的错误类型：${snap.dominantError}。`)
  if (snap.mistakeCount) lines.push(`- 共记录 ${snap.mistakeCount} 次答错、${snap.exerciseCount} 次作答。`)
  return lines.join('\n')
}
