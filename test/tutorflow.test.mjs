import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { renderChart } from '../lib/charts.js'
import { LAPLACE_EXAM } from '../lib/curriculum.js'
import { dispatch, emptyState, formatCoach } from '../lib/engine.js'
import { dueForReview, normalizeConcept, summarize } from '../lib/mastery.js'
import { normalizeQuestion } from '../lib/plan.js'
import { classify } from '../lib/taxonomy.js'
import { createStore, normalize } from '../lib/store.js'
import { apply, name } from '../index.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const forbidden = /openai\.com|googleapis\.com|jsdelivr\.net|unpkg\.com|fonts\.gstatic|cdnjs\.cloudflare/

function questions(s) {
  return (String(s || '').match(/？/g) || []).length
}

/** 走一步：把当前步骤的检查题当作学生回答。 */
function answerCurrent(state, override = {}) {
  const step = state.plan.steps[state.plan.cursor]
  return dispatch(state, { type: 'answer', text: override.text ?? step.check, ...override })
}

/* ------------------------------------------------------------------ *
 * 一、原有概率论特色功能：不能退化
 * ------------------------------------------------------------------ */

test('连续型随机变量：只问一个问题，不倒出整章', () => {
  const { result } = dispatch(emptyState(), { type: 'start', topic: '概率密度函数', note: '我不理解概率密度函数' })
  assert.equal(result.phase, 'diagnose')
  assert.equal(result.mode, 'scaffold')
  assert.match(result.say, /先不要着急记公式/)
  assert.equal(result.ask, '连续型随机变量和离散型随机变量最大的区别是什么？')
  assert.equal(questions(result.say), 0)
  assert.equal(questions(result.ask), 1)
  assert.equal(result.reveal, false)
  assert.equal(result.revealText, null)
  assert.doesNotMatch(result.say, /正态分布的公式|φ\(x\)/)
  assert.ok(result.forbid.length >= 3)
})

test('答错会定位误解，换讲法，并且不推进', () => {
  let { state, result } = dispatch(emptyState(), { type: 'start', topic: '连续型随机变量' })
  ;({ state, result } = dispatch(state, { type: 'answer', text: '连续型可以取无穷多个值，所以每个点概率更大' }))
  assert.equal(result.judgement, 'wrong')
  assert.equal(result.advance, false)
  assert.equal(result.reveal, false)
  assert.equal(result.style, '类比')
  assert.match(result.misconception, /正概率|无穷/)
  assert.match(result.say, /硬币|水/)
  assert.equal(questions(result.ask), 1)
  assert.equal(state.stepIndex, 0)
  assert.equal(state.mistakes.length, 1)
  assert.equal(result.revealText, null)
  assert.doesNotMatch(result.say, /0\.632/)
  assert.doesNotMatch(result.revealText || '', /0\.632/)
})

test('正态分布本地 SVG 可区分参数，且不含外链', () => {
  const narrow = renderChart({ kind: 'normal_pdf', mu: 0, sigma: 1, shadeFrom: -1, shadeTo: 1 })
  const wide = renderChart({ kind: 'normal_pdf', mu: 0, sigma: 2 })
  const cdf = renderChart({ kind: 'normal_cdf', mu: 0, sigma: 1 })
  const area = renderChart({ kind: 'integral', expr: '(1/2)*exp(-abs(x))', xMin: -4, xMax: 4, a: -1, b: 1 })
  for (const chart of [narrow, wide, cdf, area]) {
    assert.equal(chart.ok, true)
    assert.match(chart.svg, /<svg/)
    assert.match(chart.svg, /viewBox/)
    assert.match(chart.svg, /<path/)
    assert.doesNotMatch(chart.svg, /https?:\/\/(?!www\.w3\.org)/)
  }
  assert.notEqual(narrow.svg, wide.svg)
  assert.match(narrow.svg, /fill-opacity/)
  assert.match(area.svg, /fill-opacity/)
  const titled = renderChart({ kind: 'concept_map', title: 'A<B & C', chain: '离散|连续' })
  assert.equal(titled.ok, true)
  assert.match(titled.svg, /A&lt;B &amp; C/)
  assert.doesNotMatch(titled.svg, /A<B/)
})

test('拉普拉斯考题：逐步引导，提示分级，解答最后才出现', () => {
  let { state, result } = dispatch(emptyState(), {
    type: 'start',
    topic: '这道题',
    problem: '设随机变量 X 的概率密度函数为 f(x)=(1/2)e^{-|x|}，求 EX、DX 与 P(|X|<1)。',
  })
  assert.equal(result.mode, 'exam')
  assert.equal(result.reveal, false)
  assert.equal(questions(result.ask), 1)
  assert.doesNotMatch(result.say + result.ask, /0\.632|Γ\(3\)/)
  ;({ state, result } = dispatch(state, { type: 'answer', text: '我把每一点的函数值当作概率' }))
  assert.equal(result.judgement, 'wrong')
  assert.equal(result.advance, false)
  assert.match(result.misconception, /密度值当成概率/)
  const light = dispatch(state, { type: 'hint', level: 'light' }).result
  const idea = dispatch(state, { type: 'hint', level: 'idea' }).result
  const formula = dispatch(state, { type: 'hint', level: 'formula' }).result
  const solution = dispatch(state, { type: 'hint', level: 'solution' }).result
  assert.doesNotMatch(light.say, /x\^2|0\.632/)
  assert.match(idea.say, /对称/)
  assert.doesNotMatch(idea.say, /0\.632/)
  assert.match(formula.say, /x\^2/)
  assert.doesNotMatch(formula.say, /0\.632/)
  assert.equal(solution.reveal, true)
  assert.match(solution.revealText, /0\.632/)
  assert.match(solution.revealText, /通用方法/)
  assert.equal(light.revealText, null)
})

test('重新打开存储后能恢复进度', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tutorflow-'))
  try {
    const first = createStore(dir)
    let { state } = dispatch(first.read(), { type: 'start', topic: '概率密度函数', subject: '概率论' })
    first.write(state)
    ;({ state } = dispatch(first.read(), { type: 'answer', text: '每个点概率更大' }))
    first.write(state)
    const second = createStore(dir)
    const restored = second.read()
    assert.equal(restored.topic, '连续型随机变量')
    assert.equal(restored.subject, '概率论')
    assert.equal(restored.stepIndex, 0)
    assert.equal(restored.mistakes.length, 1)
    assert.ok(restored.mastery[normalizeConcept('连续与离散的区别')])
    const again = dispatch(restored, { type: 'answer', text: '单点概率是0，概率落在区间上' })
    assert.equal(again.result.judgement, 'correct')
    assert.equal(again.result.advance, true)
    assert.equal(again.state.stepIndex, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('切换模式会改变策略', () => {
  const started = dispatch(emptyState(), { type: 'start', topic: '导数的定义' })
  const brief = dispatch(started.state, { type: 'mode', mode: 'brief' })
  const explore = dispatch(started.state, { type: 'mode', mode: 'explore' })
  const spoken = dispatch(started.state, { type: 'answer', text: '请切换到查漏补缺模式' })
  assert.equal(brief.result.mode, 'brief')
  assert.equal(brief.result.strategy.allowFormula, true)
  assert.equal(explore.result.mode, 'explore')
  assert.equal(explore.result.strategy.allowFormula, false)
  assert.notEqual(brief.result.say, explore.result.say)
  assert.equal(spoken.result.mode, 'gap')
  assert.match(spoken.result.say, /查漏补缺|薄弱|记录/)
})

/* ------------------------------------------------------------------ *
 * 二、通用性：没有课程库也必须能教
 * ------------------------------------------------------------------ */

const CROSS = [
  { q: '什么是矩阵的特征值？', type: 'concept', subject: '数学' },
  { q: '什么是中心极限定理？', type: 'principle', subject: '统计' },
  { q: '为什么飞机能够飞起来？', type: 'principle', subject: '物理' },
  { q: 'Python 装饰器是什么？', type: 'code', subject: '计算机' },
  { q: '什么是经济学里的机会成本？', type: 'concept', subject: '经济' },
  { q: '为什么天空是蓝色的？', type: 'principle', subject: '日常科学' },
  { q: '为什么人类需要睡眠？', type: 'open', subject: '生物' },
]

test('七个跨学科问题都不依赖课程库，且都只问一个问题', () => {
  for (const item of CROSS) {
    const { state, result } = dispatch(emptyState(), { type: 'start', question: item.q })
    assert.equal(state.knowledgeType, item.type, `${item.q} 的知识类型`)
    assert.ok(result.plan, `${item.q} 应当有一条路线`)
    assert.ok(result.plan.steps.length >= 2, `${item.q} 的路线至少两步`)
    assert.equal(questions(result.ask), 1, `${item.q} 只能问一个问题`)
    assert.equal(result.reveal, false)
    assert.doesNotMatch(result.say, /\?|？/, `${item.q} 的讲解动作里不能带问句`)
    assert.notEqual(result.phase, 'idle')
    // 路线骨架来自知识类型，而不是某个具体课程
    assert.equal(state.plan.source, 'scaffold')
  }
})

test('同一套框架能按知识类型给出不同形状的路线', () => {
  const shapes = new Set()
  for (const item of CROSS) {
    const { state } = dispatch(emptyState(), { type: 'start', question: item.q })
    shapes.add(state.plan.steps.map((step) => step.goal).join('/'))
  }
  assert.ok(shapes.size >= 3, `不同知识类型应给出不同路线，实际只有 ${shapes.size} 种`)
})

test('陌生知识点的完整闭环：诊断 → 讲解 → 判错 → 换讲法 → 判对 → 推进', () => {
  let { state, result } = dispatch(emptyState(), { type: 'start', question: '为什么飞机能够飞起来？' })
  assert.equal(state.phase, 'diagnose')
  assert.equal(state.awaiting, 'placement')

  ;({ state, result } = dispatch(state, { type: 'answer', text: '完全没学过，只知道机翼上面是弯的' }))
  assert.equal(state.level, 'beginner')
  assert.equal(state.phase, 'explain')
  assert.equal(questions(result.ask), 1)
  const firstStyle = result.style

  ;({ state, result } = dispatch(state, { type: 'answer', text: '上面空气走得更快所以压力更小', verdict: 'incorrect', errorType: 'concept', evidence: '把流速当成原因，说不出压力差的来源' }))
  assert.equal(result.advance, false)
  assert.equal(result.errorType, 'concept')
  assert.notEqual(result.style, firstStyle, '答错必须换一种表征')
  assert.equal(questions(result.ask), 1)

  ;({ state, result } = dispatch(state, { type: 'answer', text: '机翼把空气往下推，空气反过来把机翼往上推', verdict: 'correct' }))
  assert.equal(result.judgement, 'correct')
  assert.equal(result.advance, false, '答对一次不能直接过')
  assert.equal(result.moveKind, 'verify')
  assert.equal(questions(result.ask), 1)

  ;({ state, result } = dispatch(state, { type: 'answer', text: '如果机翼不改变气流方向，就没有升力', verdict: 'correct' }))
  assert.equal(result.advance, true)
  assert.ok(state.plan.cursor >= 1)
})

test('诊断阶段学生给出的说法会被当成假设，而不是被无视', () => {
  const started = dispatch(emptyState(), { type: 'start', question: '为什么飞机能够飞起来？' })
  const placed = dispatch(started.state, {
    type: 'answer',
    text: '上面空气走得更快，所以压力更小，飞机就被托起来了',
    verdict: 'incorrect',
    errorType: 'concept',
    evidence: '把流速当成原因',
  })
  assert.equal(placed.state.level, 'unknown')
  assert.match(placed.result.say, /假设|不要.*否定|不要.*纠正/)
  assert.notEqual(placed.result.ask, started.result.ask)
  assert.doesNotMatch(placed.result.ask, /印象/)
  assert.equal(placed.result.advance, false)
  assert.ok(placed.result.priorBelief)
  assert.match(placed.result.priorBelief, /空气/)
  // 状态说明（没学过）仍然走零基础分支
  const beginner = dispatch(started.state, { type: 'answer', text: '没学过，只知道机翼上面是弯的' })
  assert.equal(beginner.state.level, 'beginner')
  assert.equal(beginner.result.priorBelief, null)
})

test('学生说不知道时，不会再追问他懂什么', () => {
  const started = dispatch(emptyState(), { type: 'start', question: '为什么天空是蓝色的？' })
  assert.equal(started.state.awaiting, 'placement')
  const placed = dispatch(started.state, { type: 'answer', text: '不知道，只是听说过散射这个词' })
  assert.equal(placed.state.level, 'beginner')
  assert.doesNotMatch(placed.result.ask, /印象|知道什么|懂什么/)
  assert.match(placed.result.say, /场景|画面|看得见/)
  assert.equal(questions(placed.result.ask), 1)
})

test('快速事实类问题不会被强行变成课堂', () => {  const { state, result } = dispatch(emptyState(), { type: 'start', question: '光速是多少？' })
  assert.equal(state.knowledgeType, 'fact')
  assert.equal(result.mode, 'brief')
  assert.equal(result.phase, 'answer')
  assert.equal(result.constraints.allowDirectAnswer, true)
  assert.equal(questions(result.ask), 1)

  const done = dispatch(state, { type: 'answer', text: '够了，谢谢' })
  assert.equal(done.result.phase, 'mastered')
})

test('开放式问题走多视角路线，并且答错能被分型', () => {
  const started = dispatch(emptyState(), { type: 'start', question: '远程办公该不该长期推行？' })
  assert.equal(started.state.knowledgeType, 'open')
  assert.match(started.result.plan.steps.map((s) => s.goal).join('/'), /边界|可能|证据|综合/)
  const answered = dispatch(started.state, { type: 'answer', text: '我觉得看情况', verdict: 'partial', errorType: 'expression' })
  assert.equal(answered.result.advance, false)
  assert.match(answered.result.say, /句式|说不清|表达/)
  assert.equal(questions(answered.result.ask), 1)
})

/* ------------------------------------------------------------------ *
 * 三、答案判断：从关键词改成结构化语义判断
 * ------------------------------------------------------------------ */

test('错误分型决定补法：算错不重讲概念', () => {
  const started = dispatch(emptyState(), { type: 'start', question: '什么是矩阵的特征值？' })
  const wrong = dispatch(started.state, { type: 'answer', text: 'det(A-λI)=0 解得', verdict: 'incorrect', errorType: 'computation' })
  assert.equal(wrong.result.errorType, 'computation')
  assert.equal(wrong.result.errorLabel, '概念对了但算错')
  assert.match(wrong.result.say, /算|那一行/)
  assert.equal(questions(wrong.result.ask), 1)
})

test('模型不给判定时，绝不默认答对', () => {
  let { state } = dispatch(emptyState(), { type: 'start', question: '什么是机会成本？' })
  const vague = dispatch(state, { type: 'answer', text: '嗯……大概是放弃的东西吧' })
  assert.notEqual(vague.result.judgement, 'correct')
  assert.equal(vague.result.advance, false)
  const unsure = dispatch(state, { type: 'answer', text: '不知道' })
  assert.equal(unsure.result.judgement, 'unclear')
  assert.equal(unsure.result.moveKind, 'probe')
  assert.equal(unsure.result.advance, false)
})

test('连续两次卡在同一处会把问题变小，而不是重复解释', () => {
  const started = dispatch(emptyState(), { type: 'start', question: 'Python 装饰器是什么？' })
  const placed = dispatch(started.state, { type: 'answer', text: '写过函数，装饰器只见过 @ 符号' })
  const first = dispatch(placed.state, { type: 'answer', text: '就是加个 @ 吧', verdict: 'incorrect', errorType: 'concept' })
  const second = dispatch(first.state, { type: 'answer', text: '功能性包装？', verdict: 'incorrect', errorType: 'concept' })
  assert.equal(first.result.moveKind, 'reteach')
  assert.equal(second.result.moveKind, 'simplify')
  assert.equal(second.result.support, -1)
  assert.notEqual(second.result.style, first.result.style)
  assert.equal(questions(second.result.ask), 1)
})

test('表征轮换不重复：连续答错依次换到三种不同讲法', () => {
  let { state } = dispatch(emptyState(), { type: 'start', question: '什么是机会成本？' })
  const seen = []
  for (let i = 0; i < 3; i += 1) {
    const step = dispatch(state, { type: 'answer', text: '就是花钱买的东西', verdict: 'incorrect', errorType: 'concept' })
    seen.push(step.result.style)
    state = step.state
  }
  assert.equal(new Set(seen).size, seen.length, `讲法应当轮换，实际为 ${seen.join('/')}`)
})

/* ------------------------------------------------------------------ *
 * 四、学习记忆：服务长期学习，而不只是记分
 * ------------------------------------------------------------------ */

test('一次答对不算掌握，跨天到过场才算', () => {
  let { state } = dispatch(emptyState(), { type: 'start', question: '什么是机会成本？' })
  const key = normalizeConcept('机会成本')
  ;({ state } = answerCurrent(state, { verdict: 'correct' }))
  const first = state.mastery[key]
  assert.ok(first, '应当记录掌握度')
  assert.ok(first.confidence < 0.45, `单次答对置信度应当很低，实际 ${first.confidence}`)
  assert.notEqual(first.status, 'mastered')
  assert.notEqual(first.status, 'solid')
  ;({ state } = answerCurrent(state, { verdict: 'correct' }))
  const second = state.mastery[key]
  assert.ok(second.evidence >= 2)
  assert.ok(second.confidence > first.confidence)
})

test('掌握度记录错误类型，并能给出最弱项与复习排期', () => {
  let { state } = dispatch(emptyState(), { type: 'start', question: '什么是机会成本？' })
  ;({ state } = answerCurrent(state, { verdict: 'incorrect', errorType: 'concept' }))
  ;({ state } = answerCurrent(state, { verdict: 'incorrect', errorType: 'concept' }))
  const key = normalizeConcept('机会成本')
  assert.equal(state.mastery[key].errors.concept, 2)
  const summary = summarize(state.mastery)
  assert.equal(summary.learned, 1)
  assert.equal(summary.dominantError, 'concept')
  assert.ok(summary.weak.length >= 1)
  const due = dueForReview(state.mastery, Date.now() + 3 * 86400000, 5)
  assert.equal(due.length, 1, '答错的点第二天应当排进复习')
  assert.equal(due[0].label, '机会成本')
})

test('v1 旧状态能被迁移，掌握度和错题不丢', () => {
  const v1 = {
    version: 1,
    mode: 'scaffold',
    subject: '概率论',
    topic: '连续型随机变量',
    mastery: { 连续与离散的区别: { score: 58, attempts: 3, wrong: 1 } },
    mistakes: [{ concept: '连续与离散的区别', note: '旧记录' }],
    preferences: { pace: 'slow', language: 'zh' },
  }
  const migrated = normalize(v1)
  assert.equal(migrated.version, 2)
  const row = migrated.mastery['连续与离散的区别']
  assert.equal(row.score, 58)
  assert.equal(row.evidence, 3)
  assert.equal(row.wrong, 1)
  assert.ok(row.status)
  assert.equal(migrated.mistakes.length, 1)
  assert.equal(migrated.preferences.pace, 'slow')
})

test('复习动作能把最该复习的知识点取出来', () => {
  let { state } = dispatch(emptyState(), { type: 'start', question: '什么是机会成本？' })
  ;({ state } = answerCurrent(state, { verdict: 'incorrect', errorType: 'concept' }))
  const review = dispatch(state, { type: 'progress', action: 'review' })
  assert.equal(review.result.concept, '机会成本')
  assert.match(review.result.say, /复习/)
  assert.equal(questions(review.result.ask), 1)
})

/* ------------------------------------------------------------------ *
 * 五、路线：模型自拟 + 引擎校验
 * ------------------------------------------------------------------ */

test('模型自拟路线会被校验形状并接管骨架', () => {
  const started = dispatch(emptyState(), { type: 'start', question: 'Python 装饰器是什么？' })
  const planned = dispatch(started.state, {
    type: 'plan',
    topic: 'Python 装饰器',
    approach: '先讲函数是对象，再讲包装',
    steps: [
      { concept: '函数是一等对象', goal: '先接受函数能当参数', check: '函数能不能作为参数传给另一个函数？' },
      { concept: '闭包', goal: '理解外层变量被记住', check: '内层函数为什么还能用到外层变量？' },
      { concept: '装饰器语法', goal: '看懂 @ 做了什么', check: '@deco 等价于哪一行代码？' },
    ],
  })
  assert.equal(planned.result.planErrors?.length || 0, 0)
  assert.equal(planned.state.plan.source, 'model')
  assert.equal(planned.state.plan.steps.length, 3)
  assert.equal(planned.result.step.index, 0)
  assert.equal(planned.result.ask, '函数能不能作为参数传给另一个函数？')
  assert.equal(questions(planned.result.ask), 1)
})

test('路线校验：超过八步报错，重复概念去重，多问句收敛成一问', () => {
  const started = dispatch(emptyState(), { type: 'start', question: '什么是机会成本？' })
  const tooLong = dispatch(started.state, {
    type: 'plan',
    steps: Array.from({ length: 9 }, (_, i) => ({ concept: `概念${i}`, check: `第${i}个问题？` })),
  })
  assert.ok(tooLong.result.planErrors?.length >= 1)

  const messy = dispatch(started.state, {
    type: 'plan',
    steps: [
      { concept: '机会成本', check: '它是什么？为什么重要？' },
      { concept: '机会成本', check: '重复的那一步？' },
      { concept: '边际成本', check: '它和机会成本有什么不同？' },
    ],
  })
  assert.equal(messy.state.plan.steps.length, 2)
  assert.match(messy.result.planWarnings.join(''), /重复|多个问句/)
  assert.equal(questions(messy.result.ask), 1)
})

/* ------------------------------------------------------------------ *
 * 六、可视化：跨学科通用图型
 * ------------------------------------------------------------------ */

test('通用图型都能本地画出来，且不含外链', () => {
  const specs = [
    { kind: 'bar', labels: 'A|B|C', values: '3,7,5', title: '三种方案对比' },
    { kind: 'series', curves: 'sin(x),cos(x)', xMin: -3, xMax: 3, title: '两条曲线' },
    { kind: 'series', data: '1,2;2,5;3,4', title: '一组数据' },
    { kind: 'table', headers: '概念|定义|例子', rows: '机会成本|放弃的最好选项|辞职考研', title: '对照表' },
    { kind: 'tree', tree: '力学>升力>压力差|力学>阻力', title: '结构树' },
    { kind: 'timeline', events: '1903:首次飞行|1930:升力理论', title: '时间线' },
    { kind: 'code', code: 'def f():\n    return 1', trace: '1:定义函数|2:返回 1', title: '执行追踪' },
  ]
  for (const spec of specs) {
    const chart = renderChart(spec)
    assert.equal(chart.ok, true, `${spec.kind} 应当能画：${chart.error || ''}`)
    assert.match(chart.svg, /<svg/)
    assert.match(chart.svg, /viewBox/)
    assert.doesNotMatch(chart.svg, /https?:\/\/(?!www\.w3\.org)/)
    assert.ok(chart.dataUri.startsWith('data:image/svg+xml'))
  }
})

test('图画不成时返回可读错误，不抛异常', () => {
  const bad = renderChart({ kind: 'bar' })
  assert.equal(bad.ok, false)
  assert.ok(bad.error)
  const unknown = renderChart({ kind: 'nope' })
  assert.equal(unknown.ok, false)
  const plotted = dispatch(emptyState(), { type: 'plot', kind: 'function', expr: 'x^2' })
  assert.equal(plotted.result.ok, true)
  assert.ok(plotted.result.chart.svg)
})

/* ------------------------------------------------------------------ *
 * 七、插件装载与规范
 * ------------------------------------------------------------------ */

test('插件可装载也可卸下，不改全局对象', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tutorflow-plugin-'))
  const before = Object.getOwnPropertyNames(Object.prototype).slice()
  const registered = []
  const sections = []
  const skills = []
  const disposers = []
  const ctx = {
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    tools: {
      register(def) {
        registered.push(def)
        return () => {
          const i = registered.indexOf(def)
          if (i >= 0) registered.splice(i, 1)
        }
      },
    },
    systemPrompt: {
      section(section) {
        sections.push(section)
        return () => {
          const i = sections.indexOf(section)
          if (i >= 0) sections.splice(i, 1)
        }
      },
    },
    skills: {
      register(skill) {
        skills.push(skill)
        return () => {
          const i = skills.indexOf(skill)
          if (i >= 0) skills.splice(i, 1)
        }
      },
    },
  }
  try {
    apply(ctx, { dataDir: dir })
    assert.equal(name, 'tutorflow')
    assert.deepEqual(registered.map((t) => t.name).sort(), [
      'tutorflow_answer', 'tutorflow_hint', 'tutorflow_mode', 'tutorflow_plan', 'tutorflow_plot', 'tutorflow_progress', 'tutorflow_start',
    ])
    assert.equal(sections.length, 1)
    assert.equal(sections[0].interpolate, false)
    assert.equal(skills[0].name, 'tutorflow')
    const start = registered.find((t) => t.name === 'tutorflow_start')
    assert.equal(start.isConcurrencySafe(), false)
    return start.execute({ topic: '概率密度函数' }).then((value) => {
      assert.equal(value.ask.includes('最大的区别'), true)
      const block = start.output.render({}, value)
      assert.equal(block[0].type, 'text')
      assert.match(block[0].text, /TutorFlow/)
      const prompt = sections[0].text()
      assert.match(prompt, /一次只问一个问题/)
      assert.match(prompt, /换个说法|换一种讲法|换讲法|表征/)
      for (const dispose of disposers) dispose()
      assert.equal(registered.length, 0)
      assert.equal(sections.length, 0)
      assert.equal(skills.length, 0)
      assert.deepEqual(Object.getOwnPropertyNames(Object.prototype), before)
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('所有工具的参数与输出 schema 都在 DSH 支持的子集内', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tutorflow-schema-'))
  const tools = []
  const ctx = {
    effect(fn) { fn() },
    tools: { register(def) { tools.push(def); return () => {} } },
    systemPrompt: { section() { return () => {} } },
    skills: { register() { return () => {} } },
  }
  try {
    apply(ctx, { dataDir: dir })
    assert.equal(tools.length, 7)
    for (const tool of tools) {
      assertSupportedSchema(tool.parameters, `${tool.name}.parameters`)
      assertSupportedSchema(tool.output.schema, `${tool.name}.output`)
      assert.equal(tool.parameters.type, 'object')
      for (const key of tool.parameters.required || []) {
        assert.ok(Object.hasOwn(tool.parameters.properties, key), `${tool.name}: required 里的 ${key} 必须出现在 properties`)
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** 复刻 DSH 0.2.x 的受支持 schema 子集校验。 */
function assertSupportedSchema(schema, label) {
  const constraints = ['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const']
  const annotations = ['description', 'title', 'default', 'examples']
  const types = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']
  const visit = (node, at) => {
    assert.equal(typeof node, 'object', `${at} 必须是 schema 对象`)
    assert.ok(node !== null && !Array.isArray(node), `${at} 不能是数组`)
    for (const key of Object.keys(node)) {
      assert.ok(constraints.includes(key) || annotations.includes(key), `${at}.${key} 不在 DSH 支持的子集里`)
    }
    if (Object.hasOwn(node, 'description')) assert.equal(typeof node.description, 'string')
    const hasType = Object.hasOwn(node, 'type')
    const hasOneOf = Object.hasOwn(node, 'oneOf')
    assert.ok(!(hasType && hasOneOf), `${at} 不能同时声明 type 与 oneOf`)
    if (hasOneOf) {
      assert.ok(Array.isArray(node.oneOf) && node.oneOf.length >= 2, `${at}.oneOf 至少两个分支`)
      for (const [i, branch] of node.oneOf.entries()) visit(branch, `${at}.oneOf[${i}]`)
      return
    }
    assert.ok(hasType, `${at} 需要 type 或 oneOf`)
    assert.ok(types.includes(node.type), `${at}.type 必须是单一类型字符串`)
    if (node.type === 'object') {
      if (Object.hasOwn(node, 'properties')) {
        assert.equal(typeof node.properties, 'object')
        for (const [key, child] of Object.entries(node.properties)) visit(child, `${at}.properties.${key}`)
      }
      if (Object.hasOwn(node, 'required')) {
        assert.ok(Array.isArray(node.required))
        for (const key of node.required) {
          assert.ok(Object.hasOwn(node.properties || {}, key), `${at}.required 里的 ${key} 必须出现在 properties`)
        }
      }
      if (Object.hasOwn(node, 'additionalProperties')) assert.equal(typeof node.additionalProperties, 'boolean')
    }
    if (node.type === 'array' && Object.hasOwn(node, 'items')) visit(node.items, `${at}.items`)
    if (Object.hasOwn(node, 'enum')) assert.ok(Array.isArray(node.enum) && node.enum.length > 0)
  }
  visit(schema, label)
  assert.ok(label)
}

test('源码不依赖境外 API 或 CDN', () => {
  const files = walk(root).filter((f) => /\.(js|mjs|yml|md|json)$/.test(f) && !f.includes(`${path.sep}test${path.sep}`))
  assert.ok(files.length > 8)
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    assert.doesNotMatch(text, forbidden, file)
    if ((file.endsWith('.js') || file.endsWith('.mjs')) && !file.endsWith('client.browser.js')) {
      assert.doesNotMatch(text, /\bfetch\s*\(/, file)
    }
  }
  const original = globalThis.fetch
  globalThis.fetch = () => { throw new Error('network') }
  try {
    const chart = renderChart({ kind: 'normal_pdf', mu: 1, sigma: 0.5 })
    assert.equal(chart.ok, true)
    const { result } = dispatch(emptyState(), { type: 'start', question: '为什么天空是蓝色的？' })
    assert.ok(formatCoach(result).length > 0)
  } finally {
    globalThis.fetch = original
  }
})

test('工具返回的指令一定只含一个问句，且不会泄露完整解答', () => {
  let { state, result } = dispatch(emptyState(), { type: 'start', question: '为什么天空是蓝色的？' })
  const seen = [result]
  for (let i = 0; i < 4; i += 1) {
    const step = state.plan.steps[state.plan.cursor] || state.plan.steps[state.plan.steps.length - 1]
    const next = dispatch(state, { type: 'answer', text: i % 2 === 0 ? '可能是空气把光散射了' : '不知道', verdict: i % 2 === 0 ? 'partial' : 'unclear' })
    state = next.state
    seen.push(next.result)
    assert.ok(step)
  }
  for (const item of seen) {
    assert.ok(questions(item.ask) <= 1, `只允许一个问题：${item.ask}`)
    assert.equal(item.revealText, null)
    assert.ok(item.forbid.length >= 3)
  }
})

test('模型能力分档：小模型档下引擎承担判定与路线', () => {
  const started = dispatch(emptyState(), { type: 'start', question: '什么是机会成本？' })
  const small = dispatch(started.state, { type: 'progress', action: 'set', modelTier: 'small' })
  assert.equal(small.state.preferences.modelTier, 'small')
  const step = small.state.plan.steps[small.state.plan.cursor]
  const answered = dispatch(small.state, { type: 'answer', text: '放弃掉的那个最好的选择', verdict: 'correct' })
  assert.equal(answered.result.constraints.tier, 'small')
  assert.equal(answered.result.constraints.needsVerdict, false)
  assert.ok(formatCoach(answered.result).includes('小模型'))
  assert.equal(answered.result.advance, false, '小模型档下更不能靠一次答对放行')
  assert.equal(questions(answered.result.ask), 1)
  assert.ok(step)
})

test('学生反问时先回答再收回主线，不当成答错', () => {
  const started = dispatch(emptyState(), { type: 'start', question: '什么是矩阵的特征值？' })
  const asked = dispatch(started.state, { type: 'answer', text: '那如果矩阵不是方阵，就没有特征值了吧？', verdict: 'partial', errorType: 'concept' })
  assert.equal(asked.result.moveKind, 'answer-back')
  assert.equal(asked.result.advance, false)
  assert.equal(asked.result.judgement, null)
  assert.match(asked.result.say, /追问|直接.*回答/)
  assert.equal(questions(asked.result.ask), 1)
  // 试探性作答（有问号但没有疑问词）仍然按回答处理
  const tentative = dispatch(started.state, { type: 'answer', text: '功能性包装？', verdict: 'incorrect', errorType: 'concept' })
  assert.notEqual(tentative.result.moveKind, 'answer-back')
})

test('同一个点卡太久会诚实收束，而不是换第七种说法', () => {
  let { state } = dispatch(emptyState(), { type: 'start', question: '什么是机会成本？' })
  let last = null
  for (let i = 0; i < 7; i += 1) {
    last = dispatch(state, { type: 'answer', text: '还是不太明白', verdict: 'unclear' })
    state = last.state
    if (last.result.moveKind === 'unsettled') break
  }
  assert.equal(last.result.moveKind, 'unsettled')
  assert.match(last.result.say, /六轮|收|下次/)
  assert.equal(last.result.advance, true)
  assert.equal(state.plan.steps[0].status, 'unsettled')
})

test('定位问题不会被原样重复问一遍', () => {
  const started = dispatch(emptyState(), { type: 'start', question: 'Python 装饰器是什么？' })
  const firstAsk = started.result.ask
  const placed = dispatch(started.state, { type: 'answer', text: '写过函数，装饰器只见过 @ 符号' })
  assert.notEqual(placed.result.ask, firstAsk)
  assert.equal(questions(placed.result.ask), 1)
})

test('开放式的「为什么需要」不会被当成单因果链的原理题', () => {
  const sleep = classify('为什么人类需要睡眠？')
  assert.equal(sleep.knowledgeType, 'open')
  const lift = classify('为什么飞机能够飞起来？')
  assert.equal(lift.knowledgeType, 'principle')
  const route = dispatch(emptyState(), { type: 'start', question: '为什么人类需要睡眠？' })
  assert.match(route.result.plan.steps.map((s) => s.goal).join('/'), /边界|可能|证据|综合/)
})

test('问句开头的引号不会被吃掉', () => {
  const q = normalizeQuestion('「矩阵的特征值」里最容易搞混的是哪两样东西？')
  assert.equal(q, '「矩阵的特征值」里最容易搞混的是哪两样东西？')
  assert.equal(normalizeQuestion('  ，先说说你的想法？'), '先说说你的想法？')
})

test('识别用户意图：只想快速知道 vs 想系统学', () => {
  const quick = classify('快速说一下机会成本是啥，别展开')
  assert.equal(quick.intent, 'quick')
  const learn = classify('我想系统学一下机会成本，从头讲')
  assert.equal(learn.intent, 'learn')
  const exam = classify('这道题怎么求特征值？设 A 为三阶矩阵，求其特征值。')
  assert.ok(learn.knowledgeType === 'concept' || learn.knowledgeType === 'mixed')
  assert.ok(exam.looksLikeProblem || exam.intent === 'exam')
})

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

void writeFileSync
void LAPLACE_EXAM
