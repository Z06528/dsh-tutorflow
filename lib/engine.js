/**
 * TutorFlow 通用教学内核。
 *
 * 纯函数状态机：`dispatch(state, action)`，不调用模型、不读网络、不碰磁盘。
 *
 * 分工是这一层最重要的设计：
 *   - **模型**负责内容：讲什么、用什么例子、写什么代码、画什么图。
 *   - **引擎**负责形状：现在做什么教学动作、用哪种表征、只问哪一个问题、
 *     学生答错属于哪一类、什么时候允许往下走、什么时候该退回去、什么时候该复习。
 *
 * 因此引擎里没有「课程」这个概念。课程包（lib/packs）只是可选的内容种子。
 * 任何一个从未被预设过的知识点，都能走完整条：分类 → 路线 → 讲解 → 检验 → 记忆。
 */

import { renderChart } from './charts.js'
import { matchPack } from './packs/index.js'
import { currentStep, normalizeQuestion, planFromPack, planLine, planSnapshot, scaffoldPlan, validatePlan } from './plan.js'
import {
  ERROR_LABEL,
  HINT_FRAMES,
  KNOWLEDGE_LABEL,
  MODE_LABEL,
  MODES,
  SCAFFOLDS,
  STYLES,
  chartWorth,
  diagnosisQuestion,
  needsDiagnosis,
  normalizeErrorType,
  normalizeVerdict,
  representationAt,
  selectMove,
  strategyFor,
} from './moves.js'
import { STATUS_LABEL, dueForReview, errorProfile, normalizeConcept, recordMastery, summarize, weakest } from './mastery.js'
import { classify, detectLevel, looksLikeProblem } from './taxonomy.js'

const FORBID_BASE = [
  '不要一次讲完整个章节。',
  '不要在学生还没给出可检验的回答时进入下一个知识点。',
  '不要提出第二个问题。',
  '不要把对话转发到其他模型或外部服务。',
]

/** 空状态。v2 在 v1 的字段之上扩展，旧字段保留以免外部读取方出错。 */
export function emptyState() {
  return {
    version: 2,
    mode: 'scaffold',
    subject: '',
    chapter: '',
    topic: '',
    question: '',
    intent: 'learn',
    knowledgeType: 'concept',
    complexity: 2,
    level: 'unknown',
    plan: null,
    lessonId: null,
    stepIndex: 0,
    phase: 'idle',
    awaiting: null,
    styleCursor: 0,
    focus: { representationCursor: 0, support: 0, wrongStreak: 0, partialStreak: 0, probes: 0, hintLevel: null, lastMove: null, used: [] },
    mastery: {},
    mistakes: [],
    exercises: [],
    history: [],
    exam: null,
    preferences: { pace: 'slow', language: 'zh', modelTier: 'standard', depth: 'normal' },
    lastChart: null,
    updatedAt: null,
  }
}

/**
 * 执行一个教学动作。
 * @param {object} input 当前状态（可为 v1 旧状态）。
 * @param {object} action 动作。
 * @returns {{state: object, result: object}}
 */
export function dispatch(input, action) {
  const state = clone(input ? { ...emptyState(), ...input } : emptyState())
  state.focus = { ...emptyState().focus, ...(state.focus || {}) }
  state.preferences = { ...emptyState().preferences, ...(state.preferences || {}) }
  const type = action?.type
  let result
  if (type === 'start') result = doStart(state, action)
  else if (type === 'plan') result = doPlan(state, action)
  else if (type === 'answer') result = doAnswer(state, action)
  else if (type === 'hint') result = doHint(state, action)
  else if (type === 'mode') result = doMode(state, action)
  else if (type === 'progress') result = doProgress(state, action)
  else if (type === 'plot') result = doPlot(state, action)
  else result = coach(state, { move: 'idle', say: '我没有认出这个教学动作。', ask: '你想学哪一个知识点？', phase: 'idle' })

  state.updatedAt = new Date().toISOString()
  state.history.push({
    at: state.updatedAt,
    type: type || 'unknown',
    mode: state.mode,
    concept: result.concept || '',
    judgement: result.judgement || null,
    move: result.moveKind || '',
    phase: result.phase,
  })
  if (state.history.length > 120) state.history.splice(0, state.history.length - 120)
  if (state.exercises.length > 200) state.exercises.splice(0, state.exercises.length - 200)
  if (state.mistakes.length > 200) state.mistakes.splice(0, state.mistakes.length - 200)
  syncLegacy(state)
  return { state, result: freezePublic(result) }
}

/* ------------------------------------------------------------------ *
 * start
 * ------------------------------------------------------------------ */

function doStart(state, action) {
  const question = firstText(action.question, action.problem, action.topic, action.note)
  const blob = [action.topic, action.note, action.problem, action.question, action.subject].filter(Boolean).join('\n')
  const info = classify(question || blob, {
    intent: validIntent(action.intent),
    subject: action.subject,
    knowledgeType: validKnowledge(action.knowledgeType),
  })
  state.question = String(question || '').slice(0, 2000)
  state.intent = info.intent
  state.knowledgeType = info.knowledgeType
  state.complexity = Number(action.complexity) || info.complexity
  state.subject = String(action.subject || packSubject(blob) || info.subjectLabel || '').slice(0, 40)
  state.chapter = String(action.chapter || '').slice(0, 60)
  state.level = String(action.level || info.level)
  state.exam = null
  state.plan = null
  state.focus = { ...emptyState().focus }

  const requestedMode = validMode(action.mode)
  const isProblem = info.looksLikeProblem || /^\s*(求|证明|计算|求解|求证|设)/.test(String(action.problem || ''))
  const pack = matchPack(blob, 'exam') || matchPack(blob, 'course')

  // 1) 快速事实类：不要强行把对话变成课堂。
  if (!pack && (info.intent === 'quick' || info.knowledgeType === 'fact') && !isProblem) {
    state.mode = requestedMode || 'brief'
    state.phase = 'answer'
    state.topic = shortTopic(action.topic, question)
    state.plan = scaffoldPlan({ topic: state.topic, knowledgeType: info.knowledgeType, complexity: 1, moves: SCAFFOLDS.fact })
    state.awaiting = 'brief'
    return coach(state, {
      move: 'brief-answer',
      phase: 'answer',
      concept: state.topic,
      difficulty: 1,
      judgement: null,
      say: `学生要的是快速答案，不是一堂课。先用不超过三句话把「${state.topic}」讲准，允许直接给结论。`,
      ask: '这个答案够用吗，还是需要我把它展开成一步一步的？',
      style: representationAt(state.plan.steps[0], 0),
      allowDirectAnswer: true,
    })
  }

  // 2) 考题：课程包优先，其次通用解题路线。
  if (isProblem || info.intent === 'exam' || pack?.kind === 'exam') {
    state.mode = 'exam'
    return openExam(state, pack, action.problem || question || blob)
  }

  // 3) 课程包认识的知识点：直接用包里更成熟的内容种子。
  if (pack) {
    state.mode = requestedMode || (info.intent === 'review' ? 'gap' : 'scaffold')
    state.topic = pack.topic || shortTopic(action.topic, question)
    state.subject = state.subject || pack.subject || ''
    state.chapter = state.chapter || pack.chapter || ''
    state.knowledgeType = pack.knowledgeType || state.knowledgeType
    state.plan = planFromPack(pack, state.plan)
    state.phase = 'diagnose'
    state.awaiting = state.plan.steps[0].id
    const step = state.plan.steps[0]
    step.status = 'active'
    step.asked = 1
    state.focus.used = [step.representations[0]]
    return coach(state, {
      move: 'anchor',
      phase: 'diagnose',
      concept: facingConcept(state, step),
      difficulty: step.difficulty,
      say: step.seed || '先不急着下定义，我们从一个具体的东西开始。',
      ask: step.check,
      style: step.representations[0],
      seed: true,
    })
  }

  // 4) 陌生的知识点：通用路线 + 一次基础诊断。
  state.mode = requestedMode || (info.intent === 'review' ? 'gap' : info.intent === 'explore' ? 'explore' : 'scaffold')
  state.topic = shortTopic(action.topic, question)
  const moves = SCAFFOLDS[info.knowledgeType] || SCAFFOLDS.concept
  state.plan = scaffoldPlan({ topic: state.topic, knowledgeType: info.knowledgeType, complexity: state.complexity, moves })
  state.phase = 'diagnose'
  state.awaiting = needsDiagnosis(info.knowledgeType) ? 'placement' : state.plan.steps[0].id
  const step = state.plan.steps[0]
  if (!needsDiagnosis(info.knowledgeType)) {
    step.status = 'active'
    step.asked = 1
    state.phase = 'explain'
    state.focus.used = [step.representations[0]]
    return coach(state, {
      move: 'anchor',
      phase: 'explain',
      concept: facingConcept(state, step),
      difficulty: step.difficulty,
      say: `先给「${state.topic}」一个能指认的落点：一个具体场景或一个你身上发生过的例子。不要先下定义。`,
      ask: step.check,
      style: step.representations[0],
      chartSuggestion: chartWorth(state.knowledgeType),
    })
  }
  return coach(state, {
    move: 'diagnose',
    phase: 'diagnose',
    concept: facingConcept(state, step),
    difficulty: step.difficulty,
    say: `先不讲解。这是一个「${KNOWLEDGE_LABEL[state.knowledgeType] || state.knowledgeType}」类的问题，得先知道他站在哪，才能决定从哪里切入。`,
    ask: diagnosisQuestion({ topic: state.topic, knowledgeType: state.knowledgeType, level: state.level, question: state.question }),
    style: step.representations[0],
  })
}

function openExam(state, pack, raw) {
  const text = String(raw || '').slice(0, 2000)
  const builtIn = Boolean(pack && pack.kind === 'exam')
  if (builtIn) {
    state.plan = planFromPack(pack, state.plan)
    state.topic = pack.topic
    state.subject = state.subject || pack.subject || ''
    state.chapter = state.chapter || pack.chapter || ''
    state.exam = { builtIn: true, packId: pack.id, problem: pack.problem, type: pack.type, hintsUsed: [], revealed: false }
    state.phase = 'exam-identify'
    state.awaiting = state.plan.steps[0].id
    state.plan.steps[0].status = 'active'
    state.plan.steps[0].asked = 1
    const step = state.plan.steps[0]
    state.focus.used = [step.representations[0]]
    return coach(state, {
      move: 'identify',
      phase: 'exam-identify',
      concept: facingConcept(state, step),
      difficulty: step.difficulty,
      say: `题目先放着。${pack.breakthrough || '先不解题，先认出它在考什么。'}`,
      ask: step.check,
      style: step.representations[0] || '考试',
      seed: true,
    })
  }
  state.plan = scaffoldPlan({ topic: '本题', knowledgeType: 'math', complexity: 4, moves: SCAFFOLDS.math })
  state.topic = shortTopic('', text) || '这道题'
  state.subject = state.subject || '未分类'
  state.chapter = state.chapter || '考题'
  state.exam = { builtIn: false, problem: text, type: '待学生一起识别的题目', hintsUsed: [], revealed: false }
  state.phase = 'exam-identify'
  state.awaiting = state.plan.steps[0].id
  state.plan.steps[0].status = 'active'
  state.plan.steps[0].asked = 1
  return coach(state, {
    move: 'identify',
    phase: 'exam-identify',
    concept: '题型识别',
    difficulty: 3,
    say: '我先不解题。先认出它在考什么、条件是什么、所求是什么，再决定第一步。',
    ask: '你觉得这道题在考哪一个知识点？',
    style: '考试',
  })
}

/* ------------------------------------------------------------------ *
 * plan
 * ------------------------------------------------------------------ */

function doPlan(state, action) {
  const checked = validatePlan(
    { topic: action.topic || state.topic, knowledgeType: action.knowledgeType || state.knowledgeType, approach: action.approach, route: action.route, steps: action.steps },
    state.plan,
  )
  if (!checked.ok) {
    return coach(state, {
      move: 'plan-error',
      phase: state.phase,
      concept: state.topic,
      say: `这条路线没有被接受：${checked.errors.join(' ')}`,
      ask: '把路线压到最多八步，每步给一个概念名和一道检查题，可以吗？',
      style: currentRepresentation(state),
      planErrors: checked.errors,
      planWarnings: checked.warnings,
    })
  }
  state.plan = checked.plan
  state.topic = checked.plan.topic
  state.phase = 'explain'
  state.awaiting = state.plan.steps[0].id
  state.styleCursor = 0
  state.focus = { ...emptyState().focus, used: [state.plan.steps[0].representations[0]] }
  state.plan.steps[0].asked = 1
  const step = state.plan.steps[0]
  return coach(state, {
    move: 'anchor',
    phase: 'explain',
    concept: step.concept,
    difficulty: step.difficulty,
    say: `路线定为 ${state.plan.steps.length} 步。第一步只做「${step.label}」：${step.goal || '先把这一块讲透'}。不要提前讲后面的步骤。`,
    ask: step.check,
    style: step.representations[0],
    planWarnings: checked.warnings,
    chartSuggestion: chartWorth(state.knowledgeType),
  })
}

/* ------------------------------------------------------------------ *
 * answer
 * ------------------------------------------------------------------ */

function doAnswer(state, action) {
  const text = String(action.text || '').trim()
  const modelVerdict = normalizeVerdict(action.verdict ?? action.judgement)
  const modelError = action.errorType ? normalizeErrorType(action.errorType) : null
  const evidenceNote = String(action.evidence || action.note || '').slice(0, 300)
  const confidence = Number.isFinite(Number(action.confidence)) ? clamp(Number(action.confidence), 0, 1) : null

  if (!text) {
    return coach(state, {
      move: 'wait',
      phase: state.phase,
      concept: firstConcept(state),
      say: '还没有看到学生的回答。',
      ask: currentAsk(state) || '你现在怎么理解这一点？',
      style: currentRepresentation(state),
    })
  }

  // 学生嘴上说「换成查漏补缺」这类话时，先切姿态。
  const switched = detectModeCommand(text)
  if (switched) return applyMode(state, switched, '学生要求换一种教法。')

  if (/听不懂|不明白|没懂|再讲一遍|换个说法|换一种讲法/.test(text)) {
    return reteachFromConfusion(state, text)
  }

  // 学生在追问，不是在答题。先回答他这一句，再把主线收回来。
  if (looksLikeStudentQuestion(text, modelVerdict)) return answerBack(state, text)

  // 诊断阶段的回答不是对错题，只用来判断水平。
  if (state.awaiting === 'placement' || (state.phase === 'diagnose' && state.plan?.source !== 'pack')) {
    return placement(state, text)
  }
  if (state.awaiting === 'brief') return briefFollowUp(state, text, modelVerdict)

  const step = currentStep(state.plan)
  if (!step) return doStart(state, { topic: state.topic, question: state.question })

  const judged = judgeAnswer(state, step, { text, modelVerdict, modelError, evidenceNote, confidence })
  applyCounters(state, step, judged)
  recordEvidenceFor(state, step, judged, text, evidenceNote)

  const strategy = strategyFor(state.mode)
  const evidenceRequired = evidenceRequiredFor(state, strategy)
  const move = selectMove({
    step,
    mode: state.mode,
    verdict: judged.verdict,
    errorType: judged.errorType,
    representationCursor: state.focus.representationCursor,
    wrongStreak: judged.verdict === 'incorrect' ? state.focus.wrongStreak : 0,
    partialStreak: judged.verdict === 'partial' ? state.focus.partialStreak : 0,
    evidenceAtStep: step.evidence || 0,
    evidenceRequired,
    knowledgeType: state.knowledgeType,
    probeCount: state.focus.probes || 0,
    asked: step.asked || 0,
    isLastStep: state.plan.cursor >= state.plan.steps.length - 1,
    stepIndex: state.plan.cursor,
    concept: facingConcept(state, step),
  })

  if (move.kind === 'unsettled') return wrapUnsettled(state, step, judged, move, strategy)
  if (move.kind === 'advance') return advance(state, step, judged, move, strategy)
  if (move.kind === 'consolidate') return consolidate(state, step, judged, strategy)
  return stayOnStep(state, step, judged, move, strategy)
}

/**
 * 同一个点问了六轮还没落地时的收束。
 * 不假装讲通，也不无限换说法：把清楚的部分收住，明确标出没通的那一块，排进复习。
 */
function wrapUnsettled(state, step, judged, move, strategy) {
  step.status = 'unsettled'
  state.plan.cursor = Math.min(state.plan.steps.length, move.nextIndex ?? state.plan.cursor + 1)
  state.plan.updatedAt = new Date().toISOString()
  state.focus = { ...emptyState().focus }
  state.stepIndex = state.plan.cursor
  const next = state.plan.steps[state.plan.cursor]
  if (next) {
    next.status = 'active'
    next.asked = 1
    state.awaiting = next.id
    state.phase = 'explain'
    state.focus.used = [next.representations[0]]
  } else {
    state.awaiting = null
    state.phase = 'mastered'
  }
  return coach(state, {
    move: 'unsettled',
    phase: next ? 'explain' : 'mastered',
    concept: facingConcept(state, step),
    difficulty: step.difficulty,
    judgement: judged.verdict,
    advance: true,
    say: `${move.note}${next ? `接下来只做「${next.label}」，不要回头补上一段。` : '这次就到这里，不要再开新内容。'}`,
    ask: next ? next.check : move.question,
    style: currentRepresentation(state),
    reviewDue: dueForReview(state.mastery, Date.now(), 2).map((row) => ({ label: row.label, dueAt: row.dueAt })),
  })
}

function judgeAnswer(state, step, input) {
  const norm = normalizeText(input.text)
  const pack = step.pack
  // 课程包的误区句式优先：它比模型的即时判断更准，且能给出具体的误解名。
  if (pack?.myths?.length) {
    const myth = pack.myths.find((m) => m.patterns.some((p) => norm.includes(normalizeText(p))))
    if (myth) {
      return { verdict: 'incorrect', errorType: 'concept', misconception: myth.note, mythId: myth.id, source: 'pack', evidence: input.evidenceNote, confidence: 0.9 }
    }
  }
  if (input.modelVerdict) {
    return {
      verdict: input.modelVerdict,
      errorType: input.modelVerdict === 'correct' ? 'none' : input.modelError || 'concept',
      misconception: input.modelVerdict === 'correct' ? null : input.evidenceNote || null,
      mythId: null,
      source: 'model',
      evidence: input.evidenceNote,
      confidence: input.confidence,
    }
  }
  // 模型没有给判定（弱模型、或只发了原文）：只做最低限度的推断，绝不默认「答对」。
  if (pack?.signals?.length) {
    const hits = pack.signals.filter((s) => norm.includes(normalizeText(s)))
    if (hits.length >= (pack.minHits || 1)) return { verdict: 'correct', errorType: 'none', misconception: null, mythId: null, source: 'pack', evidence: '', confidence: 0.7 }
  }
  if (/不知道|不清楚|不确定|不会|没学过|忘了|没头绪/.test(norm)) {
    return { verdict: 'unclear', errorType: 'recall', misconception: null, mythId: null, source: 'heuristic', evidence: '', confidence: 0.5 }
  }
  if (/[？?]|是不是|为什么|怎么/.test(input.text)) {
    return { verdict: 'unclear', errorType: 'none', misconception: null, mythId: null, source: 'heuristic', evidence: '', confidence: 0.3 }
  }
  return { verdict: 'partial', errorType: input.modelError || 'concept', misconception: null, mythId: null, source: 'heuristic', evidence: '', confidence: 0.2 }
}

function applyCounters(state, step, judged) {
  step.asked = (step.asked || 0) + 1
  if (judged.verdict === 'correct') {
    step.correct = (step.correct || 0) + 1
    step.evidence = (step.evidence || 0) + 1
    state.focus.wrongStreak = 0
    state.focus.partialStreak = 0
  } else if (judged.verdict === 'partial') {
    state.focus.partialStreak = (state.focus.partialStreak || 0) + 1
    state.focus.wrongStreak = 0
  } else if (judged.verdict === 'incorrect') {
    step.wrong = (step.wrong || 0) + 1
    state.focus.wrongStreak = (state.focus.wrongStreak || 0) + 1
    state.focus.partialStreak = 0
  }
}

function recordEvidenceFor(state, step, judged, text, note) {
  const target = step.track ? step.concept : state.topic
  if (!target) return
  if (judged.verdict === 'unclear') return
  state.mastery = recordMastery(state.mastery, {
    label: target,
    subject: state.subject,
    verdict: judged.verdict,
    errorType: judged.errorType,
    at: new Date().toISOString(),
  })
  state.exercises.push({
    at: new Date().toISOString(),
    id: step.id,
    concept: target,
    verdict: judged.verdict,
    errorType: judged.errorType,
    source: judged.source,
  })
  if (judged.verdict === 'incorrect') {
    state.mistakes.push({
      at: new Date().toISOString(),
      concept: target,
      myth: judged.mythId || null,
      errorType: judged.errorType,
      note: judged.misconception || note || '',
      text: String(text).slice(0, 240),
    })
  }
}

function evidenceRequiredFor(state, strategy) {
  // 课程包的每一步本身就是设计好的递进；自拟路线要求两次证据才算过。
  if (state.plan?.source === 'pack') return 1
  return Math.max(1, strategy.evidenceRequired)
}

function advance(state, step, judged, move, strategy) {
  const nextIndex = move.nextIndex ?? state.plan.cursor + 1
  step.status = 'done'
  state.plan.cursor = nextIndex
  state.plan.updatedAt = new Date().toISOString()
  state.styleCursor = 0
  state.focus = { ...emptyState().focus }
  const next = state.plan.steps[nextIndex]
  if (!next) return consolidate(state, step, judged, strategy)
  next.status = 'active'
  next.asked = 1
  state.stepIndex = nextIndex
  state.phase = next.difficulty >= 4 ? 'practice' : 'explain'
  state.awaiting = next.id
  state.focus.used = [next.representations[0]]
  const packSeed = next.seed
  return coach(state, {
    move: 'advance',
    phase: state.phase,
    concept: facingConcept(state, next),
    difficulty: next.difficulty,
    judgement: judged.verdict,
    advance: true,
    say: packSeed || `这一步过了。进入第 ${nextIndex + 1} 步：${next.goal || next.label}。不要重复已经讲过的内容，直接讲这一块。`,
    ask: next.check,
    style: next.representations[0],
    seed: Boolean(packSeed),
    chartSuggestion: chartWorth(state.knowledgeType),
  })
}

function consolidate(state, step, judged, strategy) {
  state.phase = 'mastered'
  state.awaiting = null
  state.plan.cursor = state.plan.steps.length
  state.stepIndex = state.plan.cursor
  state.plan.updatedAt = new Date().toISOString()
  const topicRow = state.mastery[normalizeConcept(state.topic)]
  const due = dueForReview(state.mastery, Date.now(), 2)
  return coach(state, {
    move: 'close',
    phase: 'mastered',
    concept: state.topic,
    difficulty: step?.difficulty || 3,
    judgement: judged.verdict,
    advance: true,
    say: `这条路线走完了。收口时只说三件事：核心是什么、它在什么条件下失效、下一次什么时候回来复习${
      topicRow ? `（当前掌握分 ${topicRow.score}，${STATUS_LABEL[topicRow.status] || topicRow.status}，下次建议 ${dueAtText(topicRow)}）` : ''
    }。不要顺手开一个新章节。`,
    ask: `用一句话说出「${state.topic}」的核心，并说出它在什么条件下会失效，可以吗？`,
    style: currentRepresentation(state),
    reviewDue: due.map((row) => ({ label: row.label, dueAt: row.dueAt })),
  })
}

function stayOnStep(state, step, judged, move, strategy) {
  const conceptName = facingConcept(state, step)
  const previousRepresentation = representationAt(step, state.focus.representationCursor || 0)
  const representations = step.representations?.length ? step.representations : STYLES
  const index = Math.max(0, representations.indexOf(move.representation))
  state.focus.representationCursor = index >= 0 ? index : state.focus.representationCursor
  state.focus.support = clamp((state.focus.support || 0) + (move.support || 0), -3, 3)
  state.focus.lastMove = move.kind
  state.styleCursor = state.focus.representationCursor
  state.phase = 'analyze'
  state.awaiting = step.id

  const used = [...new Set([...(state.focus.used || []), move.representation])]
  state.focus.used = used
  if (move.kind === 'probe' || move.kind === 'narrow' || move.kind === 'simplify' || move.kind === 'reteach') {
    state.focus.probes = (state.focus.probes || 0) + 1
  }

  const packStyleText = step.pack?.styles?.[move.representation] || null
  const say = buildSay(state, step, move, judged, packStyleText, conceptName, previousRepresentation !== move.representation)

  let chart = null
  if (move.representation === '图形' && step.pack?.chart && (move.kind === 'reteach' || move.kind === 'simplify')) {
    const rendered = renderChart(step.pack.chart)
    if (rendered.ok) {
      chart = rendered
      state.lastChart = { title: rendered.title, summary: rendered.summary, kind: step.pack.chart.kind }
    }
  }

  return coach(state, {
    move: move.kind,
    phase: state.phase,
    concept: conceptName,
    difficulty: clamp((step.difficulty || 2) + (state.focus.support || 0), 1, 5),
    judgement: judged.verdict,
    advance: false,
    misconception: judged.misconception || null,
    errorType: judged.errorType,
    say,
    ask: askedAfter(state, step, move),
    style: move.representation,
    chart: chart && chart.ok ? chart : null,
    support: state.focus.support || 0,
    avoid: used.filter((name) => name !== move.representation),
    evidenceNote: judged.evidence || '',
    chartSuggestion: move.representation === '图形' && !chart ? chartWorth(state.knowledgeType) : null,
  })
}

function buildSay(state, step, move, judged, packStyleText, facing, changed) {
  if (packStyleText) return packStyleText
  const concept = facing || facingConcept(state, step)
  const label = ERROR_LABEL[judged.errorType] || ''
  const head = judged.verdict === 'correct'
    ? '学生这一次答对了，但不能直接跳到下一步。'
    : judged.errorType !== 'none'
      ? `学生这次的问题在「${label}」这一类，不是笼统的「答错了」。`
      : '学生这次还没给出可检验的说法。'
  const switchText = changed
    ? `把「${concept}」换成「${move.representation}」这一种表征重讲，只讲这一块。`
    : `这一轮仍然用「${move.representation}」，但例子、数字或场景必须换新的，不要复用刚才那一个。`
  const codeRule = state.knowledgeType === 'code' ? '代码要能直接跑：用到的函数和装饰器一起写出来，不要留省略号。' : ''
  return `${head}${move.note}${switchText}${codeRule}`
}

function askedAfter(state, step, move) {
  // 重讲之后要重问的是同一个检查点；只有「探测 / 收窄 / 降级」才换成一个更小的问题。
  return move.question || step.check
}

/* ------------------------------------------------------------------ *
 * 诊断 / 快速回答的后续
 * ------------------------------------------------------------------ */

function placement(state, text) {
  const level = detectLevel(text)
  const said = normalizeText(text)
  if (level.level !== 'unknown') state.level = level.level
  // 短句里出现「不知道 / 没接触」这类话，等同零基础：学生已经说了答不出，不能再追问他懂什么。
  if (/没学过|不会|完全不懂|零基础|不知道|不清楚|没接触|一片空白|没概念/.test(said) && said.length <= 24) {
    state.level = 'beginner'
  } else if (/学过|知道一点|有印象/.test(said)) {
    state.level = state.level === 'unknown' ? 'partial' : state.level
  }

  const step = state.plan?.steps?.[state.plan.cursor || 0]
  state.phase = 'explain'
  const beginner = state.level === 'beginner'
  if (step) {
    step.status = 'active'
    step.asked = 1
    state.awaiting = step.id
    state.focus.used = [step.representations[0]]
    const seed = step.seed
    // 学生已经说了没学过，就不要再问他懂什么。直接给一个能看见的场景，
    // 只问一个「只看场景就能答」的问题。
    const say = beginner
      ? `学生已经明确说没学过，不要再重复问他懂不懂。直接给一个具体的、看得见摸得着的场景，一句话，把「${state.topic}」摆进这个场景里，不做解释，也不下定义。`
      : seed || `学生的起点是「${levelLabel(state.level)}」。从这里切入：先用一个他能对上号的场景把「${state.topic}」立住，不要下定义，也不要把整条路线一次讲完。`
    // 不能把刚才那个定位问题原样再问一遍。
    let ask = beginner ? '在这个场景里，你觉得最需要解释的是哪一部分？' : step.check
    if (ask === state.focus.lastAsk) ask = `先把范围收小：你能举一个「${state.topic}」的具体例子或场景吗？`
    return coach(state, {
      move: 'anchor',
      phase: 'explain',
      concept: facingConcept(state, step),
      difficulty: step.difficulty,
      say,
      ask,
      style: step.representations[0],
      seed: Boolean(seed) && !beginner,
      chartSuggestion: chartWorth(state.knowledgeType),
    })
  }
  return doStart(state, { topic: state.topic, question: state.question, subject: state.subject })
}

/**
 * 学生这一句是追问还是回答。
 *
 * 只用「句尾问号」判断会把「功能性包装？」这种试探性作答误判成追问，
 * 所以还要求句子里真的有疑问词。模型已判对时一律按回答处理。
 */
function looksLikeStudentQuestion(text, modelVerdict) {
  if (modelVerdict === 'correct') return false
  const s = String(text || '').trim()
  if (!/[？?]\s*$/.test(s)) return false
  if (s.length > 70) return false
  if (!/为什么|怎么|怎样|如何|是不是|是否|什么|哪|多少|能不能|会不会|可不可以|有没有|吗|呢|吧/.test(s)) return false
  return !/因为|所以|等于|答案是|我认为|我觉得/.test(s)
}

/** 学生反问：先答他，再收回主线，不要当错误去纠正。 */
function answerBack(state, text) {
  const step = currentStep(state.plan)
  const concept = step ? facingConcept(state, step) : state.topic
  // 收回主线时要接着刚才那一问，而不是退回到这一步最开始的问题。
  const resume = state.focus.lastAsk || step?.check || `关于「${concept}」，你现在想到哪一步了？`
  return coach(state, {
    move: 'answer-back',
    phase: state.phase === 'answer' ? 'explain' : state.phase,
    concept,
    difficulty: step?.difficulty || state.complexity,
    judgement: null,
    say: `学生这一句是追问，不是在答错。先直接、简短地回答被问的那一点（不超过三句），然后立刻把主线收回来；不要借这个机会开新内容，也不要把追问当成错误去纠正。`,
    ask: `回到刚才那一问：${resume}`,
    style: currentRepresentation(state),
  })
}

function briefFollowUp(state, text, modelVerdict) {
  const wantsMore = /展开|详细|一步一步|想学|深入|讲讲|要/.test(normalizeText(text)) && !/不用|不需要|够了|谢谢/.test(text)
  const topic = state.topic
  if (!wantsMore) {
    state.phase = 'mastered'
    state.awaiting = null
    return coach(state, {
      move: 'close',
      phase: 'mastered',
      concept: topic,
      difficulty: 1,
      say: '学生拿到答案就结束了。不要追加课程，不要让对话继续变长。',
      ask: `要不要我把「${topic}」记下来，下次直接从这里接着讲？`,
      style: '直答',
    })
  }
  // 学生改主意想系统学了：切回系统学习，用通用路线。
  state.mode = 'scaffold'
  state.intent = 'learn'
  state.plan = scaffoldPlan({ topic, knowledgeType: state.knowledgeType, complexity: state.complexity, moves: SCAFFOLDS[state.knowledgeType] || SCAFFOLDS.concept })
  state.phase = 'explain'
  state.styleCursor = 0
  state.focus = { ...emptyState().focus, used: [state.plan.steps[0].representations[0]] }
  const step = state.plan.steps[0]
  step.status = 'active'
  step.asked = 1
  state.awaiting = step.id
  return coach(state, {
    move: 'anchor',
    phase: 'explain',
    concept: facingConcept(state, step),
    difficulty: step.difficulty,
    say: `学生改主意了，想系统学。回到第一步，只做「${step.goal}」，不要一次讲完。`,
    ask: step.check,
    style: step.representations[0],
  })
}

function reteachFromConfusion(state, text) {
  const step = currentStep(state.plan)
  if (!step) {
    return coach(state, {
      move: 'reteach',
      phase: state.phase,
      concept: state.topic,
      say: `学生明确说没听懂。必须换一种说法，不能重复刚才的句子。当前的表征是「${currentRepresentation(state)}」，换掉它。`,
      ask: '换个说法之后，你觉得哪一部分比刚才清楚了？',
      style: nextName(state),
      judgement: 'partial',
    })
  }
  const representations = step.representations?.length ? step.representations : STYLES
  const cursor = Math.min(representations.length - 1, (state.focus.representationCursor || 0) + 1)
  state.focus.representationCursor = cursor
  state.styleCursor = cursor
  state.focus.wrongStreak = (state.focus.wrongStreak || 0) + 1
  state.focus.probes = (state.focus.probes || 0) + 1
  state.phase = 'analyze'
  state.awaiting = step.id
  const style = representations[cursor]
  const packStyleText = step.pack?.styles?.[style] || null
  let chart = null
  if (style === '图形' && step.pack?.chart) {
    const rendered = renderChart(step.pack.chart)
    if (rendered.ok) {
      chart = rendered
      state.lastChart = { title: rendered.title, summary: rendered.summary, kind: step.pack.chart.kind }
    }
  }
  return coach(state, {
    move: 'reteach',
    phase: 'analyze',
    concept: facingConcept(state, step),
    difficulty: step.difficulty,
    judgement: 'partial',
    advance: false,
    misconception: '学生没有听懂，问题出在表达方式上，不是学生的错。',
    say: packStyleText || `学生说没听懂。把「${facingConcept(state, step)}」换成「${style}」这一种表征重讲，禁止复述上一轮的原话；只讲这一步，不补后面的内容。`,
    ask: step.check,
    style,
    chart: chart && chart.ok ? chart : null,
    seed: Boolean(packStyleText),
    avoid: representations.slice(0, cursor),
    chartSuggestion: style === '图形' && !chart ? chartWorth(state.knowledgeType) : null,
  })
}

/* ------------------------------------------------------------------ *
 * hint / mode / progress / plot
 * ------------------------------------------------------------------ */

function doHint(state, action) {
  const level = ['light', 'idea', 'formula', 'solution'].includes(action.level) ? action.level : 'light'
  const step = currentStep(state.plan)
  if (!state.plan) {
    return coach(state, {
      move: 'hint',
      phase: state.phase,
      concept: state.topic,
      say: '现在还没有确定的知识点，提示需要挂在一个具体问题上。',
      ask: state.topic ? `我们还在看「${state.topic}」，你现在想到哪一步了？` : '你想从哪一个知识点开始？',
      style: currentRepresentation(state),
    })
  }
  if (level === 'solution') return revealSolution(state, '学生要求完整解答。')

  const packHint = state.plan.pack?.hints?.[level] || null
  const frame = HINT_FRAMES[level]
  if (state.plan.pack?.hints) state.exam = { ...(state.exam || {}), hintsUsed: [...new Set([...(state.exam?.hintsUsed || []), level])] }
  state.focus.hintLevel = level
  state.phase = 'explain'
  return coach(state, {
    move: 'hint',
    phase: state.phase,
    concept: facingConcept(state, step),
    difficulty: step?.difficulty || state.complexity,
    hintLevel: level,
    say: packHint || `${frame.label}：${frame.instruction}对象是「${facingConcept(state, step)}」。不要越过这一级去给后面的内容。`,
    ask: frame.ask,
    style: currentRepresentation(state),
    seed: Boolean(packHint),
  })
}

function revealSolution(state, why) {
  state.phase = 'exam-solution'
  if (state.exam) state.exam.revealed = true
  const text = state.plan?.pack?.solution || '按这个顺序给出完整解答：题型 → 已知与所求 → 突破口 → 分步计算 → 结果 → 一句可迁移的方法。给完就停，不要再追加新题。'
  return coach(state, {
    move: 'reveal',
    phase: 'exam-solution',
    reveal: true,
    revealText: text,
    concept: facingConcept(state, currentStep(state.plan)),
    say: why,
    ask: '哪一步是你原来没想到的？用一句话说出这个方法还能用在哪。',
    style: currentRepresentation(state),
    judgement: 'reveal',
    advance: true,
  })
}

function doMode(state, action) {
  const mode = validMode(action.mode) || detectModeCommand(action.reason || '')
  if (!mode) {
    return coach(state, {
      move: 'mode',
      phase: state.phase,
      concept: state.topic,
      say: `五种姿态是：${MODES.map((m) => MODE_LABEL[m]).join('、')}。`,
      ask: '你要换哪一种？',
      style: currentRepresentation(state),
    })
  }
  return applyMode(state, mode, action.reason || '')
}

function applyMode(state, mode, reason) {
  const prev = state.mode
  state.mode = mode
  const strategy = strategyFor(mode)
  if (mode === 'gap') return openGap(state, prev, reason)
  state.phase = state.phase === 'idle' ? 'diagnose' : state.phase
  const step = currentStep(state.plan)
  const extra = mode === 'explore'
    ? '接下来不给结论，用问题推着学生自己走。'
    : mode === 'brief'
      ? '接下来允许直接给结论，但只讲当前这一块，仍然留一个检查问题。'
      : mode === 'exam'
        ? '接下来按解题步骤走，提示分级给。'
        : '接下来仍然一次只走一个点。'
  return coach(state, {
    move: 'mode',
    phase: state.phase,
    concept: step ? facingConcept(state, step) : state.topic,
    say: `姿态已从「${MODE_LABEL[prev] || prev}」换成「${MODE_LABEL[mode]}」。${extra}${reason ? `原因：${reason}` : ''}`,
    ask: state.awaiting && state.awaiting !== 'placement' ? step?.check || `关于「${state.topic}」，你现在想到哪一步了？` : `你现在最想先弄清「${state.topic}」的哪一部分？`,
    style: mode === 'explore' ? '推导' : currentRepresentation(state),
    modeChanged: { from: prev, to: mode },
    strategyOverride: strategy,
  })
}

function openGap(state, prev, reason) {
  state.mode = 'gap'
  const weakRows = weakest(state.mastery, 1)
  const due = dueForReview(state.mastery, Date.now(), 1)
  const target = weakRows[0] || due[0]
  if (!target) {
    state.phase = 'diagnose'
    state.awaiting = 'placement'
    return coach(state, {
      move: 'diagnose',
      phase: 'diagnose',
      concept: state.topic,
      say: `记录里还没有足够的对错，暂时指不出薄弱点。${reason || ''}`.trim(),
      ask: '你最近哪一个知识点最不踏实？用它的名字告诉我。',
      modeChanged: prev ? { from: prev, to: 'gap' } : null,
      style: '直观',
    })
  }
  state.topic = target.label
  state.plan = scaffoldPlan({
    topic: target.label,
    knowledgeType: state.knowledgeType,
    complexity: 2,
    moves: [{ goal: '先让学生自己回忆一遍', move: 'anchor' }, { goal: '只补那个缺口', move: 'explain' }, { goal: '换条件再用一次', move: 'check' }],
  })
  state.plan.cursor = 0
  state.stepIndex = 0
  state.phase = 'gap'
  state.styleCursor = 0
  state.focus = { ...emptyState().focus, used: [state.plan.steps[0].representations[0]] }
  state.plan.steps[0].status = 'active'
  state.plan.steps[0].asked = 1
  state.awaiting = state.plan.steps[0].id
  return coach(state, {
    move: 'anchor',
    phase: 'gap',
    concept: target.label,
    difficulty: 2,
    say: `目前最弱的是「${target.label}」，掌握分 ${target.score}（${STATUS_LABEL[target.status] || target.status}），置信度 ${target.confidence}。只补这一个，不要顺带复习别的。`,
    ask: `不看笔记的话，你怎么向同学解释「${target.label}」？`,
    modeChanged: prev ? { from: prev, to: 'gap' } : null,
    style: '直观',
  })
}

function doProgress(state, action) {
  const act = action.action || 'get'
  if (act === 'reset') {
    const preferences = { ...state.preferences }
    Object.assign(state, emptyState())
    state.preferences = preferences
    return coach(state, { move: 'progress', say: '学习记录已清除。', ask: '接下来想学什么？', phase: 'idle', progressAction: 'reset' })
  }
  if (action.subject) state.subject = String(action.subject).slice(0, 40)
  if (action.chapter) state.chapter = String(action.chapter).slice(0, 60)
  if (action.pace === 'slow' || action.pace === 'normal') state.preferences.pace = action.pace
  if (['strong', 'standard', 'small'].includes(action.modelTier)) state.preferences.modelTier = action.modelTier
  if (act === 'review') return startReview(state)
  const summary = summarize(state.mastery, Date.now())
  const weak = summary.weak[0]
  const due = summary.due[0]
  return coach(state, {
    move: 'progress',
    phase: state.phase,
    concept: state.topic,
    say: act === 'export'
      ? `已整理出可导出的学习记录：学过 ${summary.learned} 个知识点，稳了 ${summary.solid} 个。`
      : `本地记录：学过 ${summary.learned} 个知识点，稳了 ${summary.solid} 个。${weak ? `最弱的是「${weak.label}」（${weak.score} 分，${weak.statusLabel}）。` : '还没有掌握度记录。'}${due ? `「${due.label}」已到该复习的时候。` : ''}`,
    ask: due
      ? `要不要现在复习「${due.label}」，就一道题？`
      : state.awaiting && state.awaiting !== 'placement'
        ? `要继续「${state.topic}」刚才那一步吗？`
        : '接下来想学什么，或者先复习一个旧的？',
    style: currentRepresentation(state),
    progressAction: act,
    reviewDue: summary.due,
  })
}

function startReview(state) {
  const due = dueForReview(state.mastery, Date.now(), 1)[0] || weakest(state.mastery, 1)[0]
  if (!due) {
    return coach(state, {
      move: 'progress',
      phase: 'idle',
      concept: state.topic,
      say: '还没有可以复习的记录。',
      ask: '先从哪一个知识点开始？',
      style: '直观',
    })
  }
  state.topic = due.label
  state.mode = 'gap'
  state.plan = scaffoldPlan({
    topic: due.label,
    knowledgeType: state.knowledgeType,
    complexity: 2,
    moves: [{ goal: '不看笔记先回忆一次', move: 'anchor' }, { goal: '补上刚才卡住的那一处', move: 'explain' }],
  })
  state.phase = 'gap'
  state.stepIndex = 0
  state.styleCursor = 0
  state.focus = { ...emptyState().focus, used: [state.plan.steps[0].representations[0]] }
  state.plan.steps[0].status = 'active'
  state.plan.steps[0].asked = 1
  state.awaiting = state.plan.steps[0].id
  return coach(state, {
    move: 'review',
    phase: 'gap',
    concept: due.label,
    difficulty: 2,
    say: `复习模式：只抽「${due.label}」这一个点。上一次掌握分 ${due.score}，已经过了该复习的时间。先不要给讲解。`,
    ask: `不看笔记，你能说出「${due.label}」的核心是什么吗？`,
    style: '直观',
  })
}

function doPlot(state, action) {
  const chart = renderChart(action)
  if (chart.ok) state.lastChart = { title: chart.title, summary: chart.summary, kind: action.kind }
  const step = currentStep(state.plan)
  return coach(state, {
    move: 'plot',
    phase: state.phase === 'idle' ? 'explain' : state.phase,
    concept: step ? facingConcept(state, step) : state.topic,
    say: chart.ok ? `这张图只服务当前这一点：${chart.summary}` : `图没有画成：${chart.error}`,
    ask: '看图之后，你觉得它在说明哪一件事？',
    chart: chart.ok ? chart : null,
    plotError: chart.ok ? null : chart.error,
    style: '图形',
  })
}

/* ------------------------------------------------------------------ *
 * coach 输出
 * ------------------------------------------------------------------ */

function coach(state, patch) {
  const strategy = strategyFor(state.mode)
  const step = currentStep(state.plan)
  const tier = state.preferences.modelTier || 'standard'
  const forbid = [...FORBID_BASE]
  if (!strategy.allowFormula && !patch.reveal) forbid.push('不要先把公式端出来。')
  if (!patch.reveal) forbid.push('不要输出完整解答。')
  if (patch.avoid?.length) forbid.push(`不要再用「${patch.avoid.join('、')}」这几种讲法重复一遍。`)
  if (patch.seed) forbid.push('可以说这句种子话；但不要把它扩写成整段讲解。')

  const masteryRow = state.mastery[normalizeConcept(step?.track ? step.concept : state.topic)]
  const due = dueForReview(state.mastery, Date.now(), 2)
  const ask = normalizeQuestion(patch.ask || '')
  if (ask) state.focus.lastAsk = ask
  return {
    ok: patch.plotError ? false : true,
    mode: state.mode,
    modeLabel: MODE_LABEL[state.mode] || state.mode,
    phase: patch.phase || state.phase,
    intent: state.intent,
    knowledgeType: state.knowledgeType,
    subject: state.subject,
    chapter: state.chapter,
    topic: state.topic,
    concept: patch.concept || '',
    difficulty: patch.difficulty || 1,
    judgement: legacyJudgement(patch.judgement),
    verdict: patch.judgement || null,
    errorType: patch.errorType || null,
    errorLabel: patch.errorType ? ERROR_LABEL[patch.errorType] || patch.errorType : null,
    moveKind: patch.move || '',
    advance: Boolean(patch.advance),
    style: patch.style || currentRepresentation(state),
    representation: patch.style || currentRepresentation(state),
    avoid: patch.avoid || [],
    support: patch.support ?? 0,
    misconception: patch.misconception || null,
    say: patch.say || '',
    ask,
    seed: Boolean(patch.seed),
    forbid,
    reveal: Boolean(patch.reveal),
    revealText: patch.reveal ? (patch.revealText || '') : null,
    hintLevel: patch.hintLevel || null,
    chart: patch.chart ? { title: patch.chart.title, svg: patch.chart.svg, dataUri: patch.chart.dataUri, summary: patch.chart.summary } : null,
    chartSuggestion: patch.chartSuggestion || null,
    plotError: patch.plotError || null,
    planErrors: patch.planErrors || null,
    planWarnings: patch.planWarnings || null,
    modeChanged: patch.modeChanged || null,
    progressAction: patch.progressAction || null,
    reviewDue: patch.reviewDue || due.map((row) => ({ label: row.label, dueAt: row.dueAt })),
    constraints: {
      oneQuestion: true,
      maxSentences: strategy.maxSentences,
      allowDirectAnswer: Boolean(patch.allowDirectAnswer || strategy.allowDirectAnswer),
      socratic: strategy.socratic,
      evidenceRequired: evidenceRequiredFor(state, strategy),
      revealAllowed: Boolean(patch.reveal),
      tier,
      // 能力分档：小模型不必自己做对错判定，也不必自己写路线——引擎会兜住。
      needsVerdict: tier !== 'small',
      allowPlan: tier !== 'small',
    },
    strategy: patch.strategyOverride || strategy,
    step: step
      ? { index: state.plan.cursor, total: state.plan.steps.length, id: step.id, label: step.label, goal: step.goal, check: step.check, evidence: step.evidence || 0 }
      : null,
    plan: planSnapshot(state.plan),
    planLine: planLine(state.plan),
    mastery: masteryRow ? { label: masteryRow.label, score: masteryRow.score, confidence: masteryRow.confidence, status: masteryRow.status, statusLabel: STATUS_LABEL[masteryRow.status] || masteryRow.status } : null,
    progress: snapshot(state),
  }
}

/** 给状态快照用的精简结构（对外导出，系统提示段要用）。 */
export function snapshotOf(state) {
  return snapshot(state || emptyState())
}

function snapshot(state) {
  const masteryRows = Object.entries(state.mastery || {}).map(([key, row]) => ({
    key,
    concept: row.label,
    label: row.label,
    score: row.score,
    confidence: row.confidence,
    status: row.status,
    statusLabel: STATUS_LABEL[row.status] || row.status,
    evidence: row.evidence,
    attempts: row.evidence,
    wrong: row.wrong,
    dueAt: row.dueAt,
  }))
  const errors = errorProfile(state.mastery)
  return {
    mode: state.mode,
    modeLabel: MODE_LABEL[state.mode] || state.mode,
    subject: state.subject,
    chapter: state.chapter,
    topic: state.topic,
    question: state.question,
    intent: state.intent,
    knowledgeType: state.knowledgeType,
    complexity: state.complexity,
    phase: state.phase,
    level: state.level,
    lessonId: state.lessonId,
    stepIndex: state.stepIndex,
    awaiting: state.awaiting,
    plan: planSnapshot(state.plan),
    mastery: masteryRows,
    mistakeCount: state.mistakes.length,
    exerciseCount: state.exercises.length,
    recentMistakes: state.mistakes.slice(-5),
    dominantError: errors.dominant,
    reviewDue: dueForReview(state.mastery, Date.now(), 3).map((row) => ({ label: row.label, dueAt: row.dueAt, score: row.score })),
    preferences: state.preferences,
    exam: state.exam ? { type: state.exam.type, hintsUsed: state.exam.hintsUsed || [], revealed: Boolean(state.exam.revealed), builtIn: Boolean(state.exam.builtIn) } : null,
  }
}

/** 把指令渲染成模型实际读到的那一段文字。 */
export function formatCoach(result) {
  if (!result) return ''
  const head = result.step
    ? `【TutorFlow 教学指令 · 第 ${result.step.index + 1}/${result.step.total} 步】`
    : '【TutorFlow 教学指令】'
  const lines = [
    head,
    `姿态：${result.modeLabel}（${result.mode}） | 阶段：${result.phase} | 知识类型：${result.knowledgeType} | 学科：${result.subject || '未定'}`,
    result.planLine ? `路线：${result.planLine}` : '',
    result.step ? `当前一步：${result.step.label}${result.step.goal ? `（目标：${result.step.goal}）` : ''}` : '',
    result.judgement ? `对刚才回答的判断：${judgeText(result.judgement)}${result.errorLabel ? ` · ${result.errorLabel}` : ''}` : '',
    result.misconception ? `错在：${result.misconception}` : '',
    result.advance ? '这一步可以过了，直接进入下一步。' : '停在这一步，不要进入下一个知识点。',
    `要做的教学动作：${result.say}`,
    result.avoid?.length ? `已经用过的讲法（不要重复）：${result.avoid.join('、')}` : '',
    '禁止：',
    ...result.forbid.map((f) => `- ${f}`),
    result.ask ? `只问这一个问题：${result.ask}` : '这一步不必追问。',
  ]
  if (result.reveal && result.revealText) {
    lines.push('允许给出的完整内容：', result.revealText)
  }
  if (result.chart?.svg) {
    lines.push(`图形：${result.chart.title}。${result.chart.summary}`)
    lines.push(`![${result.chart.title}](${result.chart.dataUri})`)
  }
  if (result.chartSuggestion) {
    lines.push(`如果图确实有帮助，可以调用 tutorflow_plot，kind 建议 "${result.chartSuggestion}"；没帮助就不要画。`)
  }
  if (result.planErrors?.length) lines.push(`路线问题：${result.planErrors.join(' ')}`)
  if (result.planWarnings?.length) lines.push(`路线提醒：${result.planWarnings.join(' ')}`)
  if (result.mastery) lines.push(`这个知识点的掌握：${result.mastery.score} 分 / ${result.mastery.statusLabel} / 置信度 ${result.mastery.confidence}`)
  if (result.constraints?.tier === 'small') {
    lines.push('（当前按小模型档运行：不需要你判断对错，也不需要你写路线，照这一条做即可。）')
  }
  if (result.progress) {
    const p = result.progress
    lines.push(`进度：${p.subject || '未定科目'} / ${p.chapter || '未定章节'} / ${p.topic || '未定知识点'}；已记录 ${p.mastery.length} 个知识点`)
    const weak = [...p.mastery].sort((a, b) => a.score - b.score)[0]
    if (weak) lines.push(`最弱：${weak.concept}（${weak.score}，${weak.statusLabel}）`)
    if (p.reviewDue?.length) lines.push(`该复习：${p.reviewDue.map((row) => row.label).join('、')}`)
  }
  return lines.filter(Boolean).join('\n')
}

function judgeText(j) {
  if (j === 'correct') return '答对了，但还不算掌握'
  if (j === 'partial') return '说到了一部分'
  if (j === 'incorrect' || j === 'wrong') return '没有答对'
  if (j === 'unclear') return '看不出懂没懂'
  if (j === 'reveal') return '已给出完整解答'
  return j || ''
}

/** 对外沿用旧词表：wrong。内部用 incorrect。 */
function legacyJudgement(value) {
  if (value === 'incorrect') return 'wrong'
  return value || null
}

function freezePublic(result) {
  if (!result.reveal) result.revealText = null
  return result
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

function validMode(mode) {
  return MODES.includes(mode) ? mode : null
}

function validIntent(intent) {
  return ['learn', 'quick', 'exam', 'review', 'explore', 'chat'].includes(intent) ? intent : undefined
}

function validKnowledge(type) {
  return [
    'concept', 'principle', 'procedure', 'code', 'math', 'data', 'open', 'fact', 'skill', 'mixed',
  ].includes(type) ? type : undefined
}

function detectModeCommand(text) {
  const s = String(text || '')
  if (!/模式|切换|换成|改为|换到/.test(s) && !/查漏补缺|自主探索|快速讲解|考题攻坚|循序渐进/.test(s)) return null
  if (/查漏补缺|查漏/.test(s)) return 'gap'
  if (/自主探索|探索模式|别告诉我公式|我自己推/.test(s)) return 'explore'
  if (/快速讲解|快速解释|直接讲|简明/.test(s)) return 'brief'
  if (/考题攻坚|攻坚模式/.test(s)) return 'exam'
  if (/循序渐进|系统学|从头讲/.test(s)) return 'scaffold'
  return null
}

function currentRepresentation(state) {
  const step = currentStep(state.plan)
  return representationAt(step, state.focus?.representationCursor || 0)
}

/**
 * 对学生可见的知识点名。
 *
 * 路线骨架里的步骤标签（例如「把机制拆成因果链，一次只说一环」）是给引擎和模型看的
 * 内部脚手架，绝不能出现在学生看到的话里。凡是 track 为假的步骤，对外一律用话题名。
 * @param {object} state 当前状态。
 * @param {object|null} step 步骤。
 */
function facingConcept(state, step) {
  if (!step) return state.topic || ''
  if (step.track) return step.concept || state.topic || step.label || ''
  return state.topic || step.label || ''
}

function nextName(state) {
  const step = currentStep(state.plan)
  const list = step?.representations?.length ? step.representations : STYLES
  return list[Math.min(list.length - 1, (state.focus?.representationCursor || 0) + 1)]
}

function currentAsk(state) {
  const step = currentStep(state.plan)
  return step?.check || ''
}

function firstConcept(state) {
  return facingConcept(state, currentStep(state.plan))
}

function shortTopic(topic, question) {
  const explicit = String(topic || '').trim()
  if (explicit) return explicit.length <= 60 ? explicit : `${explicit.slice(0, 57)}…`
  let q = String(question || '').trim()
  if (!q) return '未命名知识点'
  q = q.replace(/^(请问|请教一下|请教|能不能|可以帮我|帮我|我想知道|我想问|想请教|解释一下|讲讲|讲一下|说一下|科普一下)[，,、\s]*/g, '')
  q = q.replace(/^(什么是|啥是|何为)/, '')
  q = q.replace(/[？?！!。，,]+$/g, '')
  q = q.replace(/(是什么意思|是什么|的定义是什么|指什么|的意思)$/, '')
  q = q.trim()
  if (!q) q = String(question || '').trim() || '未命名知识点'
  return q.length <= 60 ? q : `${q.slice(0, 57)}…`
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text) return text
  }
  return ''
}

function packSubject(blob) {
  const pack = matchPack(blob)
  return pack?.subject || ''
}

function levelLabel(level) {
  if (level === 'beginner') return '零基础'
  if (level === 'partial') return '学过一点'
  if (level === 'advanced') return '已经比较熟'
  return '还不确定'
}

function dueAtText(row) {
  if (!row?.dueAt) return '还没排'
  const days = Math.round((new Date(row.dueAt).getTime() - Date.now()) / 86400000)
  if (days <= 0) return '现在就该复习'
  return `大约 ${days} 天后`
}

function normalizeText(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')').replace(/，/g, ',')
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n))
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

/** 旧字段同步：外部读取方（含旧测试）仍然按 stepIndex 看进度。 */
function syncLegacy(state) {
  if (state.plan) {
    state.stepIndex = state.plan.cursor
    state.styleCursor = state.focus?.representationCursor || 0
    state.lessonId = state.plan.source === 'pack' ? state.plan.packId : state.plan.id
  }
}

export { looksLikeProblem, needsDiagnosis, planLine, STATUS_LABEL, ERROR_LABEL }
