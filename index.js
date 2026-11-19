/**
 * TutorFlow host plugin for DeepSeek Harness 0.2.x.
 * Registers tools, a system-prompt section, and a runtime skill.
 * It does not call any model of its own.
 */
import { dispatch, emptyState, formatCoach } from './lib/engine.js'
import { promptSectionText, skillBody } from './lib/prompt.js'
import { createStore, resolveDataDir } from './lib/store.js'

export const name = 'tutorflow'
export const inject = ['tools', 'systemPrompt', 'skills']

const COACH_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  description: 'TutorFlow coach directive. Follow say, ask, and forbid. Do not add a second question.',
}

function tool({ name: toolName, description, properties, required, run }) {
  return {
    name: toolName,
    description,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties,
      required,
    },
    isConcurrencySafe: () => false,
    presentCall() {
      return { card: 'generic', title: 'TutorFlow', kind: 'other' }
    },
    output: {
      schema: COACH_SCHEMA,
      render(_args, value) {
        return [{ type: 'text', text: formatCoach(value) }]
      },
    },
    async execute(args) {
      return run(args || {})
    },
  }
}

export function createTutorTools(store) {
  const commit = (action) => {
    const { state, result } = dispatch(store.read(), action)
    store.write(state)
    return result
  }
  return [
    tool({
      name: 'tutorflow_start',
      description: '开始或继续一个教学主题。学生提出新知识点、贴上题目、或要求从头学时先调用。返回的指令只允许讲一个点、问一个问题。',
      properties: {
        topic: { type: 'string', description: '知识点或学生的原话' },
        subject: { type: 'string', description: '科目，例如概率论' },
        chapter: { type: 'string', description: '章节' },
        mode: { type: 'string', enum: ['scaffold', 'exam', 'gap', 'brief', 'explore'], description: '教学模式' },
        problem: { type: 'string', description: '考试题目原文。有题目时走考题攻坚。' },
        note: { type: 'string', description: '学生补充的话，例如没学过、听不懂' },
      },
      required: ['topic'],
      run: (args) => commit({ type: 'start', ...args }),
    }),
    tool({
      name: 'tutorflow_answer',
      description: '记录并分析学生的回答。答错则定位误解并换一种讲法；答对才允许进入下一步。不要在调用前自己公布答案。',
      properties: {
        text: { type: 'string', description: '学生的原话' },
        judgement: { type: 'string', enum: ['correct', 'partial', 'wrong'], description: '可选。你的判断只作参考，工具会按知识点标准覆盖明显错误。' },
      },
      required: ['text'],
      run: (args) => commit({ type: 'answer', text: args.text, judgement: args.judgement }),
    }),
    tool({
      name: 'tutorflow_hint',
      description: '考题三级提示或完整解答。light 轻提示，idea 思路，formula 关键公式，solution 仅在学生明确要求完整解答时使用。',
      properties: {
        level: { type: 'string', enum: ['light', 'idea', 'formula', 'solution'], description: '提示等级' },
      },
      required: ['level'],
      run: (args) => commit({ type: 'hint', level: args.level }),
    }),
    tool({
      name: 'tutorflow_plot',
      description: '用本地 SVG 画出与当前讲解有关的图：函数、正态密度、分布函数、积分区域、坐标、知识结构、流程图、离散与连续对照。不访问网络。',
      properties: {
        kind: { type: 'string', enum: ['function', 'normal_pdf', 'normal_cdf', 'integral', 'coordinate', 'concept_map', 'flowchart', 'discrete_vs_continuous'], description: '图形类型' },
        expr: { type: 'string', description: '函数表达式，变量 x。例如 exp(-x^2/2) 或 (1/2)*exp(-abs(x))' },
        mu: { type: 'number', description: '正态均值' },
        sigma: { type: 'number', description: '正态标准差，必须为正' },
        shadeFrom: { type: 'number', description: '正态密度阴影左端' },
        shadeTo: { type: 'number', description: '正态密度阴影右端' },
        a: { type: 'number', description: '积分下限' },
        b: { type: 'number', description: '积分上限' },
        xMin: { type: 'number', description: '横轴左端' },
        xMax: { type: 'number', description: '横轴右端' },
        title: { type: 'string', description: '图题' },
        chain: { type: 'string', description: '知识结构，用 | 分隔' },
        steps: { type: 'string', description: '流程步骤，用 | 分隔' },
      },
      required: ['kind'],
      run: (args) => commit({ type: 'plot', ...args }),
    }),
    tool({
      name: 'tutorflow_mode',
      description: '切换教学模式：scaffold 循序渐进，exam 考题攻坚，gap 查漏补缺，brief 快速讲解，explore 自主探索。',
      properties: {
        mode: { type: 'string', enum: ['scaffold', 'exam', 'gap', 'brief', 'explore'], description: '目标模式' },
        reason: { type: 'string', description: '学生的原话' },
      },
      required: ['mode'],
      run: (args) => commit({ type: 'mode', mode: args.mode, reason: args.reason }),
    }),
    tool({
      name: 'tutorflow_progress',
      description: '读取、导出或清除本地学习进度。进度写在 DSH_HOME/dsh-tutorflow/state.json，不靠当前对话记忆。',
      properties: {
        action: { type: 'string', enum: ['get', 'export', 'reset', 'set'], description: 'get 查看，export 导出，reset 清除，set 更新科目或节奏' },
        subject: { type: 'string', description: '科目' },
        chapter: { type: 'string', description: '章节' },
        pace: { type: 'string', enum: ['slow', 'normal'], description: '节奏' },
      },
      required: ['action'],
      run: (args) => commit({ type: 'progress', ...args }),
    }),
  ]
}

export function apply(ctx, options = {}) {
  const store = options.store || createStore(options.dataDir || resolveDataDir())
  const effect = (fn) => {
    if (typeof ctx.effect === 'function') ctx.effect(fn)
    else {
      const dispose = fn()
      return dispose
    }
  }
  for (const definition of createTutorTools(store)) {
    effect(() => ctx.tools.register(definition))
  }
  if (ctx.systemPrompt?.section) {
    effect(() => ctx.systemPrompt.section({
      name: 'tutorflow',
      order: 55,
      interpolate: false,
      text: () => promptSectionText(safeRead(store)),
    }))
  }
  if (ctx.skills?.register) {
    effect(() => ctx.skills.register({
      name: 'tutorflow',
      description: '按一个知识点、一个问题的节奏教学生，而不是一次把答案讲完。',
      content: skillBody(),
      source: 'runtime',
    }))
  }
  return { dataDir: store.dir }
}

function safeRead(store) {
  try { return store.read() } catch { return emptyState() }
}
