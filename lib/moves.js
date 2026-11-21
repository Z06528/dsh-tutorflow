/**
 * 教学动作层：决定「下一步做一个什么教学动作」，以及「只问哪一个问题」。
 *
 * 这一层完全不写具体知识。它只回答四个问题：
 *   1. 现在该做什么动作（锚定 / 解释 / 追问 / 换讲法 / 降级 / 检验 / 迁移 / 收束）
 *   2. 用哪一种表征（直观、类比、图形、推导……），并且不许连着两次用同一种
 *   3. 学生错在哪一类（概念 / 步骤 / 计算 / 审题 / 记忆 / 表达），于是怎么补
 *   4. 这一轮唯一要问的那一句话是什么
 *
 * 内容由模型提供，形状由这里保证。
 */

/** 五种教学模式（保留原有取值，语义放宽为「课堂姿态」）。 */
export const MODES = ['scaffold', 'exam', 'gap', 'brief', 'explore']

export const MODE_LABEL = {
  scaffold: '系统学习',
  exam: '解题带练',
  gap: '查漏补缺',
  brief: '快速解释',
  explore: '自主探索',
}

/** 原有表征名，course pack 的 styles 用这套键。 */
export const STYLES = ['直观', '类比', '图形', '推导', '考试']

/** 知识类型的中文名，用来给模型看。 */
export const KNOWLEDGE_LABEL = {
  concept: '概念',
  principle: '原理',
  procedure: '步骤',
  code: '代码',
  math: '数学',
  data: '数据',
  open: '开放式问题',
  fact: '事实',
  skill: '技能',
  mixed: '混合',
}

/** 错误的类型。它比「对/错」有用得多：不同类型的错要用不同方式补。 */
export const ERROR_TYPES = ['concept', 'procedure', 'computation', 'reading', 'recall', 'expression', 'none']

export const ERROR_LABEL = {
  concept: '概念没建立',
  procedure: '步骤或方法没成形',
  computation: '概念对了但算错',
  reading: '没看清题目条件',
  recall: '记不住，不是不懂',
  expression: '懂但说不清',
  none: '没有明显错误',
}

const ERROR_ALIASES = [
  [/概念|理解|定义|本质|concept|conceptual|understand/i, 'concept'],
  [/步骤|方法|流程|顺序|procedure|method|step|procedural/i, 'procedure'],
  [/计算|算错|算术|代数|computation|calculat|arithmetic|algebra/i, 'computation'],
  [/审题|读题|题意|条件|看错|reading|misread|misunderstood the question/i, 'reading'],
  [/记不住|忘了|遗忘|背|recall|memor|forgot/i, 'recall'],
  [/表达|说不清|讲不清|表达不清|expression|articulat|word/i, 'expression'],
]

/** 每一类错误该怎么补，以及该问什么。probes 会轮换，避免同一个追问连着出现。 */
const ERROR_REPAIR = {
  concept: {
    note: '这里缺的是概念本身，不是熟练度。先给一个具体到可以指认的例子，再回到定义；不要用更抽象的话再解释一遍。',
    probes: [
      '你能举一个和「{concept}」有关的具体例子，再举一个看着像、其实不是的例子吗？',
      '如果完全不用术语，你会怎么向一个没听过的人描述「{concept}」？',
      '「{concept}」里最容易被搞混的那一对区别是什么？',
    ],
    angle: '例子先行',
  },
  procedure: {
    note: '概念可能没问题，缺的是动作顺序。把方法压成两步，只让他做第一步。',
    probes: [
      '如果只允许你写第一步，你会写哪一步？',
      '把刚才那套动作说成两句：先做什么，再做什么，可以吗？',
    ],
    angle: '拆步',
  },
  computation: {
    note: '思路对了，错在算。不要重讲概念，只把出错的那一行单独拆开检查。',
    probes: [
      '先不算结果：把要算的那一行原样写出来，数字先不代入，可以吗？',
      '这一步你用的是哪个关系式，先只把这个式子写出来可以吗？',
    ],
    angle: '只查一行',
  },
  reading: {
    note: '可能是条件没看清。先让他用自己的话复述已知与所求，不要往下讲。',
    probes: [
      '用一句话说出：题目给了什么，要求什么？',
      '题目里哪一句让你决定用这个方法？',
    ],
    angle: '复述条件',
  },
  recall: {
    note: '这是提取失败，不是理解失败。给一个能勾出记忆的线索，不要重新推一遍。',
    probes: [
      '不看笔记，你记得它和哪个你熟悉的东西是连在一起的？',
      '先不想定义，你最早是在哪道题或哪个场景里见到它的？',
    ],
    angle: '给线索',
  },
  expression: {
    note: '他大概知道，只是说不清。给一个句式让他往里填，不要替他讲完。',
    probes: [
      '用这个句式说一次：「{concept}说的是____，所以当____时会____」。',
      '把你想说的那句话压到十五个字以内，可以吗？',
    ],
    angle: '给句式',
  },
  none: {
    note: '没有明显错误。',
    probes: ['你能用一句话把它讲给一个没学过的人听吗？'],
    angle: '复述',
  },
}

/** 按知识类型补一个更贴合学科的追问，接在通用追问后面轮换使用。 */
const TYPE_PROBES = {
  principle: [
    '如果这个原因成立，还应该能观察到什么别的现象？',
    '把这个原因去掉，结果会怎么变？',
  ],
  math: [
    '先不算：把「{concept}」按你自己的话说成一句话，会是什么？',
    '「{concept}」里哪一个条件是必不可少的？',
  ],
  code: [
    '先不看语法：这段代码想让计算机做什么？',
    '如果删掉其中一行，结果会怎么变？',
  ],
  data: [
    '换成一张图来看，你会把哪一个量放在横轴上？',
    '这个结论在什么样本上会不成立？',
  ],
  open: [
    '你现在的判断，需要看到什么证据才会改变？',
    '换一个立场来看「{concept}」，最站得住的反驳是什么？',
  ],
  procedure: [
    '这套步骤里，哪一步最容易做错？',
    '如果跳过中间那一步，结果会变成什么样？',
  ],
}

/**
 * 「换条件再确认」该问什么。不同知识类型换的东西不一样，问得要能判定。
 * @param {string} knowledgeType 知识类型。
 * @param {string} concept 对学生可见的知识点名。
 */
export function verifyQuestion(knowledgeType, concept) {
  const t = concept || '这一点'
  const frames = {
    concept: `换一个不一样的例子，「${t}」还成立吗？`,
    principle: `把其中一个条件改掉，「${t}」的结论还站得住吗？`,
    procedure: `换一个对象走一遍这套步骤，中间哪一步会不一样？`,
    code: `换一个输入跑一遍，输出会怎么变？`,
    math: `换一组数再算一次，方法还是一样的吗？`,
    data: `换一个样本，这个结论还成立吗？`,
    open: `换一个立场来看，你现在的判断还站得住吗？`,
    skill: `在更快一点的节奏下再做一次，还能保持吗？`,
    fact: `如果有人记成另一个说法，你能指出他错在哪吗？`,
    mixed: `换一个角度再看「${t}」，哪一部分会变？`,
  }
  return frames[knowledgeType] || frames.concept
}

/**
 * 取一个追问。index 让同一类错误的追问轮换，不重复问同一个问题。
 * @param {string} errorType 错误类型。
 * @param {string} knowledgeType 知识类型。
 * @param {number} index 第几次追问。
 * @param {string} concept 对学生可见的知识点名。
 */
export function probeFor(errorType, knowledgeType, index, concept) {
  const repair = ERROR_REPAIR[errorType] || ERROR_REPAIR.none
  // 学科专属追问排在前面：问「为什么」类的问题时，先问后果与机制，而不是让它「举一个成立例子」。
  const pool = [...(TYPE_PROBES[knowledgeType] || []), ...repair.probes]
  const text = pool[Math.abs(index) % pool.length] || pool[0]
  return String(text).replace(/\{concept\}/g, concept || '这一点')
}

/** 知识类型 → 一条好的讲解路线该有的形状（只有动作，没有内容）。 */
export const SCAFFOLDS = {
  concept: [
    { goal: '先建立直觉锚点，不急着下定义', move: 'anchor' },
    { goal: '说清这个概念的边界：什么算、什么不算', move: 'explain' },
    { goal: '把它连到学生已经会的东西上', move: 'connect' },
    { goal: '用一个换过条件的小问题确认它还在', move: 'check' },
  ],
  principle: [
    { goal: '先把要解释的现象固定下来', move: 'anchor' },
    { goal: '把机制拆成因果链，一次只说一环', move: 'explain' },
    { goal: '指出这条链成立需要的关键条件', move: 'condition' },
    { goal: '反过来问：条件不成立时会怎样', move: 'counterfactual' },
  ],
  procedure: [
    { goal: '说清这套动作要达成什么结果', move: 'anchor' },
    { goal: '把过程拆成有先后的小步', move: 'explain' },
    { goal: '完整走一遍，并解释每步为什么', move: 'walkthrough' },
    { goal: '让学生自己复述这一步序', move: 'check' },
  ],
  code: [
    { goal: '先建立心智模型：这段代码在解决什么问题', move: 'anchor' },
    { goal: '给一个能跑的最小例子', move: 'explain' },
    { goal: '逐层追踪执行过程，而不是只读语法', move: 'trace' },
    { goal: '改一个变体，看结论怎么变', move: 'variant' },
  ],
  math: [
    { goal: '分清已知与所求', move: 'anchor' },
    { goal: '找到连接两者的关键关系', move: 'explain' },
    { goal: '分步推导，每一步只做一件事', move: 'derive' },
    { goal: '验算并迁移到相近题型', move: 'transfer' },
  ],
  data: [
    { goal: '先说清数据是什么、怎么来的', move: 'anchor' },
    { goal: '用图形建立直觉', move: 'explain' },
    { goal: '引入统计量或模型，并说明它回答什么', move: 'explain' },
    { goal: '指出这类结论最容易出错的地方', move: 'caveat' },
  ],
  open: [
    { goal: '先把问题边界问清，不要急着给观点', move: 'clarify' },
    { goal: '列出至少两种可能的解释或立场', move: 'explain' },
    { goal: '说清各自需要什么证据支持', move: 'evidence' },
    { goal: '给出一个可以被推翻的综合判断', move: 'synthesize' },
  ],
  fact: [
    { goal: '直接给答案，不绕弯', move: 'answer' },
    { goal: '补一条能把它挂住的关联', move: 'connect' },
  ],
  skill: [
    { goal: '示范一次正确动作', move: 'demo' },
    { goal: '拆成可以单独练的最小单元', move: 'explain' },
    { goal: '联合起来练一次并给具体反馈', move: 'practice' },
    { goal: '独立完成一次', move: 'check' },
  ],
  mixed: [
    { goal: '先把问题拆成两个更小的部分', move: 'anchor' },
    { goal: '挑其中一个先讲透', move: 'explain' },
    { goal: '把两部分接起来', move: 'connect' },
    { goal: '用一个新问题检查', move: 'check' },
  ],
}

/** 知识类型 → 表征顺序。换讲法时按这个顺序往下走。 */
export const REPRESENTATIONS = {
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

/** 哪些表征值得配一张本地图。只有确实能帮助理解时才建议画图。 */
const CHART_WORTHY = {
  math: 'function',
  data: 'bar',
  principle: 'flowchart',
  code: 'code',
  procedure: 'flowchart',
}

/** 这些知识类型需要先诊断基础，再进入讲解。 */
const NEEDS_DIAGNOSIS = new Set(['math', 'data', 'principle', 'procedure', 'code', 'skill', 'mixed'])

/**
 * 模式策略。模式只调整课堂姿态，不限制模型的教学自主权。
 * @param {string} mode 教学姿态。
 * @returns {{allowFormula: boolean, maxIdeas: number, maxSentences: number, socratic: boolean, allowDirectAnswer: boolean, evidenceRequired: number, rules: string[], label: string}}
 */
export function strategyFor(mode) {
  const common = [
    '一次只处理一个知识点。',
    '一次只提一个问题。',
    '学生答错时先说清错在哪一类，再换一种讲法，不要重复上一轮的说法。',
    '学生没有给出可检验的回答之前，不进入下一个知识点。',
  ]
  const base = { maxIdeas: 1, maxSentences: 6, socratic: false, allowDirectAnswer: false, evidenceRequired: 2, rules: common, label: MODE_LABEL[mode] || mode }
  if (mode === 'brief') {
    return {
      ...base,
      allowFormula: true,
      allowDirectAnswer: true,
      evidenceRequired: 1,
      maxSentences: 4,
      rules: ['先用几句话把这一点说清楚，允许直接给结论。', '仍然留一个检查问题，但不要展开整章。', ...common],
    }
  }
  if (mode === 'explore') {
    return {
      ...base,
      allowFormula: false,
      socratic: true,
      maxSentences: 2,
      rules: ['不先给结论或公式。', '用问题推着学生自己走，每次只推一步。', '学生卡住时只把问题变小，不给答案。', ...common],
    }
  }
  if (mode === 'exam') {
    return {
      ...base,
      allowFormula: false,
      evidenceRequired: 1,
      maxSentences: 5,
      rules: ['先识别题型，再找突破口。', '先问学生准备怎么做第一步。', '提示必须分级：轻提示、思路提示、关键公式。', '只有学生明确要求完整解答时才给出全解。', ...common],
    }
  }
  if (mode === 'gap') {
    return {
      ...base,
      allowFormula: true,
      evidenceRequired: 1,
      rules: ['先找掌握最不牢的那一个点。', '只补这一个点，并立刻用一个问题检查。', ...common],
    }
  }
  return {
    ...base,
    allowFormula: false,
    rules: ['先判断学生站在哪，再搭一个很小的框架。', '默认先用直观说法；听不懂再换类比、图形、推导或反例。', '先从生活里能指认的东西开始，不要一上来就下定义。', ...common],
  }
}

/** 这个知识类型要不要先做一次基础诊断。 */
export function needsDiagnosis(knowledgeType) {
  return NEEDS_DIAGNOSIS.has(knowledgeType)
}

/** 这个表征要不要建议画图。 */
export function chartWorth(knowledgeType) {
  return CHART_WORTHY[knowledgeType] || null
}

/** 把模型给的各种写法归一成标准错误类型。 */
export function normalizeErrorType(value) {
  const raw = String(value || '').trim()
  if (!raw) return 'none'
  if (ERROR_TYPES.includes(raw)) return raw
  for (const [pattern, type] of ERROR_ALIASES) {
    if (pattern.test(raw)) return type
  }
  return 'concept'
}

/** 把模型给的判定归一。允许中文、英文、以及「对了一半」这类说法。 */
export function normalizeVerdict(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return null
  if (/^(correct|right|ok|true|对|正确|对了|答对)$/.test(raw)) return 'correct'
  if (/partial|half|partly|一半|部分|沾边|方向对|说对一半/.test(raw)) return 'partial'
  if (/^(wrong|incorrect|false|error|错|错误|不对|答错|错)/.test(raw)) return 'incorrect'
  if (/unclear|unknown|unsure|不确定|说不清|看不出|无法判断/.test(raw)) return 'unclear'
  return null
}

/** 取这一步该用的表征。 */
export function representationAt(step, cursor) {
  const list = step?.representations?.length ? step.representations : STYLES
  const index = Math.max(0, Math.min(list.length - 1, cursor || 0))
  return list[index]
}

/** 下一步换哪一种表征：绝不与当前这种相同。 */
export function nextRepresentation(step, cursor) {
  const list = step?.representations?.length ? step.representations : STYLES
  if (list.length <= 1) return list[0]
  return list[(Math.max(0, cursor || 0) + 1) % list.length]
}

/**
 * 决定下一个教学动作。纯函数：同样的输入一定得到同样的动作。
 *
 * @param {object} input
 * @param {object|null} input.step 当前步骤。
 * @param {string} input.mode 教学姿态。
 * @param {'correct'|'partial'|'incorrect'|'unclear'} input.verdict 这一轮判定。
 * @param {string} input.errorType 错误类型。
 * @param {number} input.representationCursor 当前表征游标。
 * @param {number} input.wrongStreak 连续答错次数，**含本次**。
 * @param {number} input.partialStreak 连续答得不到位次数，**含本次**。
 * @param {number} input.evidenceAtStep 这一步到目前为止拿到的有效证据数（**含本次**）。
 * @param {number} [input.evidenceRequired] 覆盖模式默认的证据阈值，由引擎按路线来源决定。
 * @param {boolean} input.isLastStep 是不是最后一步。
 * @param {number} input.stepIndex 当前步骤下标。
 * @param {string} input.concept 当前知识点名。
 * @param {string} [input.studentText] 学生原话。
 * @returns {{kind: string, representation: string, support: number, question: string, note: string, advance: boolean, nextIndex: number|null, requires: string[]}}
 */
export function selectMove(input) {
  const {
    step,
    mode,
    verdict,
    errorType = 'none',
    representationCursor = 0,
    wrongStreak = 0,
    partialStreak = 0,
    evidenceAtStep = 0,
    evidenceRequired = null,
    knowledgeType = 'concept',
    probeCount = 0,
    asked = 0,
    isLastStep = false,
    stepIndex = 0,
    concept = '',
  } = input
  const strategy = strategyFor(mode)
  const required = evidenceRequired ?? strategy.evidenceRequired
  const current = representationAt(step, representationCursor)
  const repair = ERROR_REPAIR[errorType] || ERROR_REPAIR.none
  const probe = probeFor(errorType, knowledgeType, probeCount, concept)
  const fill = (text) => String(text).replace(/\{concept\}/g, concept || '这一点')

  // 卡死保护：同一个点问了六轮还没落地，不要再换第七种说法。
  // 诚实收束、留复习，比无限换说法更有教学价值。
  if (asked >= 6 && verdict !== 'correct') {
    return {
      kind: 'unsettled',
      representation: current,
      support: 0,
      question: '这一段里你最清楚的是哪一步，我们下次从那里接着讲，可以吗？',
      note: '同一个点已经问了六轮还没落地。不要再换新说法，也不要假装讲通了：把已经说清的部分收一下，明确指出还没通的那一块，留到下次复习。',
      advance: true,
      nextIndex: stepIndex + 1,
      requires: ['wrap'],
    }
  }

  if (verdict === 'unclear') {
    return {
      kind: 'probe',
      representation: current,
      support: 0,
      question: probe,
      note: '还看不准学生到底懂到哪。不要替他总结，也不要给答案，只用一个更具体的问题把思路逼出来。',
      advance: false,
      nextIndex: null,
      requires: [],
    }
  }

  if (verdict === 'incorrect' || (verdict === 'partial' && partialStreak >= 2)) {
    // 连着两次没对：先把问题变小，而不是把同一段话再讲一遍。
    if (wrongStreak >= 2 || (verdict === 'partial' && partialStreak >= 2)) {
      return {
        kind: 'simplify',
        representation: nextRepresentation(step, representationCursor),
        support: -1,
        question: fill('先不谈整件事。只回答最小的那一问：「{concept}」里，你最确定的那一句是什么？'),
        note: '同一处已经卡了两次。把范围缩小到一个最小的可判断问题，先拿回一次成功经验；不要继续用同样长度解释。',
        advance: false,
        nextIndex: null,
        requires: ['shrink'],
      }
    }
    return {
      kind: 'reteach',
      representation: nextRepresentation(step, representationCursor),
      support: 0,
      question: probe,
      note: `${repair.note}换一种表征重讲，禁止把上一轮的说法再说一遍。`,
      advance: false,
      nextIndex: null,
      requires: ['new-representation'],
    }
  }

  if (verdict === 'partial') {
    return {
      kind: 'narrow',
      representation: nextRepresentation(step, representationCursor),
      support: -1,
      question: probe,
      note: `方向对了但没落地。${repair.note}只补缺口，不要重讲已经对的部分；这一轮换一种讲法。`,
      advance: false,
      nextIndex: null,
      requires: ['new-representation'],
    }
  }

  // verdict === 'correct'
  const enough = evidenceAtStep >= required
  if (!enough) {
    return {
      kind: 'verify',
      representation: current,
      support: 0,
      question: verifyQuestion(knowledgeType, concept),
      note: '答对一次还不能算掌握。用同一个点的变式再确认一次：表征可以沿用，但例子、数字或场景必须换新的，不要重复原题，也不要提前讲下一步。',
      advance: false,
      nextIndex: null,
      requires: ['variant'],
    }
  }
  if (isLastStep) {
    return {
      kind: 'consolidate',
      representation: current,
      support: 0,
      question: fill('用一句话把「{concept}」讲给一个没学过的人听，你会怎么说？'),
      note: '路线走完了。让学生自己收一次口，然后给出可以复习的要点，不要开新章节。',
      advance: false,
      nextIndex: null,
      requires: ['summary'],
    }
  }
  return {
    kind: 'advance',
    representation: current,
    support: 0,
    question: '',
    note: '这一步可以过了。直接进入下一步，不要重复已经讲过的内容。',
    advance: true,
    nextIndex: stepIndex + 1,
    requires: [],
  }
}

/** 提示分级：通用问句框架。具体知识由模型填。 */
export const HINT_FRAMES = {
  light: {
    label: '轻提示',
    instruction: '只指方向，不给方法：告诉学生该去看哪一个条件、哪一个词、哪一个对象。一句话。',
    ask: '顺着这个方向，你下一步会先看哪里？',
  },
  idea: {
    label: '思路提示',
    instruction: '给方法骨架，不给数字和结论：说出这类问题的通用思路，以及为什么这个思路适用。',
    ask: '按这个思路，你准备写下的第一行是什么？',
  },
  formula: {
    label: '关键公式',
    instruction: '只给会用到的那个关系式或定义，不代入数字，不给出最终结果。',
    ask: '把已知代进这个式子，你先得到什么？',
  },
  solution: {
    label: '完整解答',
    instruction: '学生明确要求了，可以给出完整解答。给完之后必须收一句可迁移的方法。',
    ask: '哪一步是你原来没想到的？用一句话说出这个方法还能用在哪。',
  },
}

/** 诊断阶段该问的问题：按知识类型换入口，不要七种问题都问同一句。 */
export function diagnosisQuestion({ topic, knowledgeType, level, question = '' }) {
  const whyLike = /为什么|怎么会|如何|怎么/.test(String(question))
  const frames = {
    concept: (t) => `在「${t}」里，你最先想到的是什么？`,
    principle: (t) => (whyLike ? `关于「${t}」，你觉得最可能的原因是什么？` : `关于「${t}」，你现在的印象是什么？`),
    procedure: (t) => `关于「${t}」，你自己动手做过哪一步？`,
    code: (t) => `关于「${t}」，你写过或读过相关的代码吗？`,
    math: (t) => `关于「${t}」，你已经会的部分到哪一步了？`,
    data: (t) => `关于「${t}」，你见过的数据长什么样？`,
    open: (t) => `关于「${t}」，你现在更想要一个结论，还是想自己形成一个判断？`,
    skill: (t) => `关于「${t}」，你现在能自己做到哪一步？`,
    fact: (t) => `关于「${t}」，你想知道的是哪一点？`,
    mixed: (t) => `关于「${t}」，你最想先弄清哪一部分？`,
  }
  if (level === 'beginner') return `「${topic}」我们从零开始，你想先听一个生活里的例子，还是先听一句最简的说法？`
  if (level === 'advanced') return `「${topic}」你想直接听严格版本，还是先把直觉对齐？`
  const frame = frames[knowledgeType] || frames.concept
  return frame(topic)
}

/** 收束阶段给出的复习建议模板。 */
export function consolidationPrompt(topic) {
  return `用一句话说出「${topic}」的核心，并说出它在什么条件下会失效。`
}
