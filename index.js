/**
 * TutorFlow 宿主插件（DeepSeek Harness 0.2.x）。
 *
 * 注册七件事：七个教学工具、一段系统提示、一个运行时技能。
 * 它自己不调用任何模型——讲解内容由宿主当前配置的模型生成，
 * 这个插件负责把「像一位好老师那样教」所需要的形状、状态和记忆管起来。
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

const MODE_ENUM = ['scaffold', 'exam', 'gap', 'brief', 'explore']
const INTENT_ENUM = ['learn', 'quick', 'exam', 'review', 'explore']
const KNOWLEDGE_ENUM = ['concept', 'principle', 'procedure', 'code', 'math', 'data', 'open', 'fact', 'skill', 'mixed']
const VERDICT_ENUM = ['correct', 'partial', 'wrong', 'incorrect', 'unclear']
const ERROR_ENUM = ['concept', 'procedure', 'computation', 'reading', 'recall', 'expression', 'none']
const HINT_ENUM = ['light', 'idea', 'formula', 'solution']
const PLOT_ENUM = ['function', 'normal_pdf', 'normal_cdf', 'integral', 'coordinate', 'concept_map', 'flowchart', 'discrete_vs_continuous', 'bar', 'series', 'table', 'tree', 'timeline', 'code']

function tool({ name: toolName, description, properties, required, run }) {
  return {
    name: toolName,
    description,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties,
      required: required || [],
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
      return run(args && typeof args === 'object' ? args : {})
    },
  }
}

const STEP_ITEM = {
  type: 'object',
  additionalProperties: false,
  properties: {
    concept: { type: 'string', description: '这一步要建立或检验的知识点，用学生听得懂的名字。' },
    goal: { type: 'string', description: '这一步要达成什么，一句话。' },
    check: { type: 'string', description: '检验这一步是否真懂的那一个问题。只写一个问句。' },
    move: { type: 'string', description: '可选的讲解动作，例如 anchor / explain / check / trace。' },
    difficulty: { type: 'integer', description: '1 到 5。' },
  },
  required: ['concept'],
}

/**
 * 构造七个工具。
 * @param {object} store createStore 返回的存储对象。
 */
export function createTutorTools(store) {
  const commit = (action) => {
    const { state, result } = dispatch(store.read(), action)
    store.write(state)
    return result
  }
  return [
    tool({
      name: 'tutorflow_start',
      description:
        '开始或切换一个学习话题。学生提出任何想弄懂的问题（不限学科）、贴来一道题、或要求从头学时先调用。'
        + '会判断这是要快速答案还是要系统学、属于哪一类知识，并给出这条路线上的第一个教学动作和唯一那个问题。'
        + '课程库之外的话题同样适用。',
      properties: {
        question: { type: 'string', description: '学生原话或问题的完整表述，越长越好判断。' },
        topic: { type: 'string', description: '话题简称。不填则由 question 里提取。' },
        subject: { type: 'string', description: '学科。不填由引擎判断，例如物理、经济、计算机。' },
        chapter: { type: 'string', description: '章节，可不填。' },
        mode: { type: 'string', enum: MODE_ENUM, description: '教学姿态。不填由意图推断。' },
        intent: { type: 'string', enum: INTENT_ENUM, description: '学生的意图。你比关键词更懂上下文时可以直接指定。' },
        knowledgeType: { type: 'string', enum: KNOWLEDGE_ENUM, description: '知识类型。不填由引擎判断。' },
        problem: { type: 'string', description: '题目原文。有它就走解题带练。' },
        note: { type: 'string', description: '学生补充的话，例如没学过、听不懂、只要结论。' },
        level: { type: 'string', enum: ['beginner', 'partial', 'advanced', 'unknown'], description: '你判断的学生基础。' },
      },
      required: [],
      run: (args) => commit({ type: 'start', ...args }),
    }),
    tool({
      name: 'tutorflow_plan',
      description:
        '为一个话题提交你自己拟的教学路线，覆盖引擎给的通用骨架。每步只要一个概念名和一道检查题。'
        + '路线会被校验：最多八步、概念不重复、每题只问一个问句。返回第一步该做的动作。'
        + '小模型可以跳过这个工具，引擎骨架足以支撑完整教学。',
      properties: {
        topic: { type: 'string', description: '话题。不填沿用当前话题。' },
        approach: { type: 'string', description: '一句话说明这条路线的讲法要点。' },
        knowledgeType: { type: 'string', enum: KNOWLEDGE_ENUM, description: '知识类型。' },
        steps: { type: 'array', items: STEP_ITEM, description: '教学路线，三到六步最合适。' },
      },
      required: ['steps'],
      run: (args) => commit({ type: 'plan', ...args }),
    }),
    tool({
      name: 'tutorflow_answer',
      description:
        '记录并分析学生的回答，返回下一个教学动作。你要给出自己的判定与错误类型：引擎据此决定是换讲法、把问题变小、'
        + '退回更基础的一层，还是换条件再确认一次。答对一次不会直接进入下一步。不在考题里时也可以先用它做诊断。',
      properties: {
        text: { type: 'string', description: '学生原话。' },
        verdict: { type: 'string', enum: VERDICT_ENUM, description: '你的判定。拿不准就填 unclear，引擎会继续追问而不是放行。' },
        judgement: { type: 'string', enum: VERDICT_ENUM, description: 'verdict 的旧名字，二者等价。' },
        errorType: { type: 'string', enum: ERROR_ENUM, description: '错在哪一类：概念、步骤、计算、审题、记忆、表达。' },
        evidence: { type: 'string', description: '一句话说清缺了什么，会写进记忆。' },
        confidence: { type: 'number', description: '0 到 1，你对这次判定的把握。' },
      },
      required: ['text'],
      run: (args) => commit({ type: 'answer', text: args.text, verdict: args.verdict, judgement: args.judgement, errorType: args.errorType, evidence: args.evidence, confidence: args.confidence }),
    }),
    tool({
      name: 'tutorflow_hint',
      description:
        '分级提示。light 只指方向，idea 给思路骨架，formula 给关键关系式，solution 才给完整解答。'
        + '前三级不要越过一级去说后面的内容；给了完整解答之后必须收一句可迁移的方法。',
      properties: {
        level: { type: 'string', enum: HINT_ENUM, description: '提示等级。' },
      },
      required: ['level'],
      run: (args) => commit({ type: 'hint', level: args.level }),
    }),
    tool({
      name: 'tutorflow_plot',
      description:
        '用本地 SVG 画出当前讲解真正需要的那一张图，不访问网络。支持函数曲线、正态密度与分布函数、积分区域、坐标、'
        + '知识结构、流程图、离散连续对照，以及跨学科通用的柱状图、多曲线对照、表格、结构树、时间线、代码执行追踪。'
        + '图只在确实帮助理解时画。',
      properties: {
        kind: { type: 'string', enum: PLOT_ENUM, description: '图形类型。' },
        title: { type: 'string', description: '图题，写清这张图在说明什么。' },
        caption: { type: 'string', description: '图下的一句话说明。' },
        expr: { type: 'string', description: '函数表达式，变量 x。例如 exp(-x^2/2) 或 (1/2)*exp(-abs(x))。' },
        curves: { type: 'string', description: '多条曲线，用逗号分隔的表达式，例如 "sin(x),cos(x)"。' },
        data: { type: 'string', description: '数据点，每对 x,y 用逗号，行之间用分号。例如 "1,2;2,5;3,4"。' },
        labels: { type: 'string', description: '柱状图的标签，用 | 分隔。' },
        values: { type: 'string', description: '柱状图的数值，用逗号分隔。' },
        unit: { type: 'string', description: '纵轴单位。' },
        headers: { type: 'string', description: '表格表头，用 | 分隔。' },
        rows: { type: 'string', description: '表格行，每行用 | 分隔，换行或 ;; 分行。' },
        tree: { type: 'string', description: '结构树，用 "根>子>孙" 表达层级，多条用 | 分隔。' },
        events: { type: 'string', description: '时间线事件，格式 "时间:事件"，多条用 | 分隔。' },
        code: { type: 'string', description: '要追踪的代码，多行文本。' },
        trace: { type: 'string', description: '执行追踪注释，格式 "行号:说明"，多条用 | 分隔。' },
        mu: { type: 'number', description: '正态均值。' },
        sigma: { type: 'number', description: '正态标准差，必须为正。' },
        shadeFrom: { type: 'number', description: '阴影左端。' },
        shadeTo: { type: 'number', description: '阴影右端。' },
        a: { type: 'number', description: '积分下限。' },
        b: { type: 'number', description: '积分上限。' },
        xMin: { type: 'number', description: '横轴左端。' },
        xMax: { type: 'number', description: '横轴右端。' },
        chain: { type: 'string', description: '线性知识结构，用 | 分隔。' },
        steps: { type: 'string', description: '流程步骤，用 | 分隔。' },
        points: {
          type: 'array',
          description: '坐标点，每条带 x、y 与可选 label。',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              label: { type: 'string' },
            },
            required: ['x', 'y'],
          },
        },
      },
      required: ['kind'],
      run: (args) => commit({ type: 'plot', ...args }),
    }),
    tool({
      name: 'tutorflow_mode',
      description:
        '切换课堂姿态：scaffold 系统学习，exam 解题带练，gap 查漏补缺，brief 快速解释，explore 自主探索。'
        + '姿态只改课堂气氛和长度，不限制你能怎么讲。',
      properties: {
        mode: { type: 'string', enum: MODE_ENUM, description: '目标姿态。' },
        reason: { type: 'string', description: '学生原话。' },
      },
      required: ['mode'],
      run: (args) => commit({ type: 'mode', mode: args.mode, reason: args.reason }),
    }),
    tool({
      name: 'tutorflow_progress',
      description:
        '查看、导出、清除或复习本地学习记录。记录写在 DSH_HOME/dsh-tutorflow/state.json，和当前对话是否还在无关。'
        + '包含掌握度与置信度、错题类型、该复习的知识点。也能设置节奏和模型能力档。',
      properties: {
        action: { type: 'string', enum: ['get', 'export', 'reset', 'set', 'review'], description: 'get 查看，export 导出，reset 清除，set 更新设置，review 开始复习最该复习的那个。' },
        subject: { type: 'string', description: '学科。' },
        chapter: { type: 'string', description: '章节。' },
        pace: { type: 'string', enum: ['slow', 'normal'], description: '节奏。' },
        modelTier: { type: 'string', enum: ['small', 'standard', 'strong'], description: '模型能力档。small 时引擎承担更多判断。' },
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
      description: '像私人教师那样讲任何科目：先判断要不要上课，再一步一步讲、一次只问一个问题、按回答调整。',
      content: skillBody(),
      source: 'runtime',
    }))
  }
  return { dataDir: store.dir }
}

function safeRead(store) {
  try { return store.read() } catch { return emptyState() }
}
