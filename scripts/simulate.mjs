/**
 * 生成跨学科教学轨迹（供模型在环测试使用）。
 *
 * 引擎在给定「学生回答 + 模型判定」后是确定性的，因此这里可以把整条轨迹预先算出来：
 * 每一步产出模型真正会读到的那段文字（系统提示段 + 工具返回）。
 * 随后由真实模型逐轮写出它会对学生说的话，再由评审按量表打分。
 *
 * 学生的回答是脚本化的（模拟真实学生会怎么答），模型判定也写死在脚本里——
 * 这一点必须在测试报告里说明，它意味着我们在测「指令是否足以支撑好教学」，
 * 而不是在测某个模型的即时判断能力。
 *
 * 用法：node scripts/simulate.mjs [输出路径]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { dispatch, emptyState, formatCoach } from '../lib/engine.js'
import { promptSectionText } from '../lib/prompt.js'

const SCENARIOS = [
  {
    id: 'math-eigen',
    title: '数学：什么是矩阵的特征值？',
    question: '什么是矩阵的特征值？',
    subject: '数学',
    turns: [
      { text: '没学过，只知道特征值跟矩阵有关，记过 Av=λv。', verdict: 'partial', errorType: 'concept' },
      { text: '特征值就是让 Av=λv 成立的那个 λ 吧。', verdict: 'partial', errorType: 'concept' },
      { text: '是不是可以理解成矩阵在某个方向上只是把向量拉长了几倍？', verdict: 'correct' },
      { text: '那如果矩阵不是方阵，就没有特征值了吧？', verdict: 'partial', errorType: 'concept' },
    ],
  },
  {
    id: 'stats-clt',
    title: '统计学：什么是中心极限定理？',
    question: '什么是中心极限定理？',
    subject: '统计',
    turns: [
      { text: '完全没学过这个定理。', verdict: 'unclear' },
      { text: '是不是样本一多，分布就自动变成正态了？', verdict: 'partial', errorType: 'concept' },
      { text: '好像是说不管总体是什么分布，样本均值的分布都接近正态。', verdict: 'correct' },
      { text: '那是不是样本量只要大于 30 就一定成立？', verdict: 'partial', errorType: 'concept' },
    ],
  },
  {
    id: 'physics-lift',
    title: '物理学：为什么飞机能够飞起来？',
    question: '为什么飞机能够飞起来？',
    subject: '物理',
    turns: [
      { text: '没学过，只知道机翼上面是弯的。', verdict: 'unclear' },
      { text: '上面空气走得更快，所以压力更小，飞机就被托起来了。', verdict: 'incorrect', errorType: 'concept' },
      { text: '因为机翼把空气往下推，空气反过来把机翼往上推？', verdict: 'correct' },
      { text: '那直升机没有机翼，为什么也能飞？', verdict: 'partial', errorType: 'concept' },
    ],
  },
  {
    id: 'code-decorator',
    title: '编程：Python 装饰器是什么？',
    question: 'Python 装饰器是什么？',
    subject: '计算机',
    turns: [
      { text: '写过函数，装饰器只见过 @ 符号。', verdict: 'partial', errorType: 'concept' },
      { text: '@ 就是个注释吧，让代码好看一点。', verdict: 'incorrect', errorType: 'concept' },
      { text: '是不是把一个函数传进去，再返回一个新函数？', verdict: 'correct' },
      { text: '那它和直接调用有什么区别？', verdict: 'partial', errorType: 'expression' },
    ],
  },
  {
    id: 'econ-opportunity',
    title: '经济学：什么是机会成本？',
    question: '什么是经济学里的机会成本？',
    subject: '经济',
    turns: [
      { text: '没学过，听着像是放弃掉的那部分成本。', verdict: 'partial', errorType: 'concept' },
      { text: '就是花了多少钱的成本吧。', verdict: 'incorrect', errorType: 'concept' },
      { text: '是为了选 A 而放弃的 B 里最值钱的那一个？', verdict: 'correct' },
      { text: '那如果两个都不选，机会成本是多少？', verdict: 'partial', errorType: 'concept' },
    ],
  },
  {
    id: 'daily-blue-sky',
    title: '日常科学：为什么天空是蓝色的？',
    question: '为什么天空是蓝色的？',
    subject: '日常科学',
    turns: [
      { text: '不知道，只是听说过散射这个词。', verdict: 'unclear' },
      { text: '因为天空反射了大海的颜色。', verdict: 'incorrect', errorType: 'concept' },
      { text: '是不是短波长的光被空气分子散射得更多？', verdict: 'correct' },
      { text: '那为什么傍晚天是红的？', verdict: 'partial', errorType: 'concept' },
    ],
  },
  {
    id: 'bio-sleep',
    title: '开放式问题：为什么人类需要睡眠？',
    question: '为什么人类需要睡眠？',
    subject: '生物',
    turns: [
      { text: '没学过，只知道不睡会很困。', verdict: 'unclear' },
      { text: '睡觉是为了让大脑休息。', verdict: 'partial', errorType: 'concept' },
      { text: '好像还跟记忆整理和清除代谢废物有关？', verdict: 'correct' },
      { text: '那到底哪一个才是主要原因？', verdict: 'partial', errorType: 'concept' },
    ],
  },
]

function questions(text) {
  return (String(text || '').match(/[？?]/g) || []).length
}

const problems = []
const out = []

for (const scenario of SCENARIOS) {
  let { state, result } = dispatch(emptyState(), { type: 'start', question: scenario.question, subject: scenario.subject })
  const turns = []
  const pushTurn = (directive, learner) => {
    if (questions(directive.ask) !== 1) {
      problems.push(`${scenario.id}: 第 ${turns.length + 1} 轮的问题不是恰好一句（${questions(directive.ask)} 个问号）：${directive.ask}`)
    }
    if (questions(directive.say) !== 0) {
      problems.push(`${scenario.id}: 第 ${turns.length + 1} 轮的教学动作里混入了问句`)
    }
    turns.push({
      directive: formatCoach(directive),
      ask: directive.ask,
      learner: learner ? learner.text : '',
    })
  }
  const first = { question: scenario.question, subject: scenario.subject }
  pushTurn(result, null)
  for (const learner of scenario.turns) {
    const step = dispatch(state, { type: 'answer', text: learner.text, verdict: learner.verdict, errorType: learner.errorType })
    state = step.state
    result = step.result
    pushTurn(result, learner)
  }
  out.push({
    id: scenario.id,
    title: scenario.title,
    question: scenario.question,
    subject: scenario.subject,
    systemPrompt: promptSectionText(state),
    knowledgeType: state.knowledgeType,
    planLine: result.planLine,
    turns: turns.map((turn, index) => ({
      index: index + 1,
      directive: turn.directive,
      ask: turn.ask,
      // 模型说完这一段之后，学生会说的下一句话。
      studentNext: index + 1 < turns.length ? turns[index + 1].learner : '我还有点糊涂，能不能再讲讲？',
    })),
  })
}

const payload = { generatedAt: new Date().toISOString(), scenarios: out, problems }
const target = process.argv[2] || path.join(process.cwd(), 'sim-transcript.json')
mkdirSync(path.dirname(target), { recursive: true })
writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8')

// 每个场景单独一份，方便逐个喂给真实模型。
const perDir = path.join(path.dirname(target), 'scenarios')
mkdirSync(perDir, { recursive: true })
for (const scenario of out) {
  writeFileSync(path.join(perDir, `${scenario.id}.json`), JSON.stringify(scenario, null, 2), 'utf8')
}

console.log(`scenarios: ${out.length}`)
console.log(`turns: ${out.reduce((sum, item) => sum + item.turns.length, 0)}`)
console.log(`problems: ${problems.length}`)
for (const problem of problems) console.log('  ! ' + problem)
console.log(`written: ${target}`)
