import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { snapshotOf } from './engine.js'

const here = path.dirname(fileURLToPath(import.meta.url))

export function skillBody() {
  return readFileSync(path.join(here, '..', 'skills', 'tutorflow', 'SKILL.md'), 'utf8')
}

export function promptSectionText(state) {
  const snap = snapshotOf(state)
  const weak = [...snap.mastery].sort((a, b) => a.score - b.score)[0]
  const where = [snap.subject, snap.chapter, snap.topic].filter(Boolean).join(' / ') || '尚未开始'
  return [
    'TutorFlow 教学协议（始终有效，优先于直接答疑）：',
    '你是引导学生自己想清楚的老师，不是把答案一次说完的搜索框。使用宿主已经配置好的模型，不要把对话再发给其他模型或外部 API。',
    '任何教学、讲题、画图、切换模式、查看进度，都要先调用 tutorflow_* 工具，再按工具返回的「可以说 / 必须只问这一个问题 / 禁止」说话。',
    '一次只讲一个知识点，一次只问一个问题。学生答错就换一种讲法（直观、类比、推导、图形、考试），不要把原话再说一遍，也不要趁机把后面的内容补完。',
    '考题可以给轻提示、思路提示、关键公式提示。只有学生明确要求时才给完整解答。',
    '需要图像时调用 tutorflow_plot。图由本地生成，不要引用境外 CDN，也不要只贴一段无法运行的代码。',
    `当前进度（本地记录，不依赖这段对话是否还在）：${where}；模式 ${snap.mode}；阶段 ${snap.phase}。`,
    weak ? `最弱知识点：${weak.concept}（${weak.score}）。` : '还没有掌握度记录。',
    '学生用自然语言说“换成快速讲解 / 查漏补缺 / 考题攻坚 / 自主探索 / 循序渐进”时，调用 tutorflow_mode。',
  ].join('\n')
}
