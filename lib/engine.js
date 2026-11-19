/**
 * Pure teaching state machine. No model calls, no network, no disk.
 * Tool output is a coach directive: one thing to say, one question to ask.
 */
import { renderChart } from './charts.js'
import {
  CONTINUOUS_LESSON,
  LAPLACE_EXAM,
  MODE_LABEL,
  MODES,
  STYLES,
  detectMode,
  isContinuousTopic,
  isLaplaceProblem,
  strategyFor,
} from './curriculum.js'

const FORBID_BASE = [
  '不要一次讲完整个章节。',
  '不要在学生答对之前进入下一个知识点。',
  '不要把当前问题的答案直接说出来，除非 reveal 为 true。',
  '不要提出第二个问题。',
  '不要把对话转发到其他模型或外部服务。',
]

export function emptyState() {
  return {
    version: 1,
    mode: 'scaffold',
    subject: '',
    chapter: '',
    topic: '',
    lessonId: null,
    stepIndex: 0,
    phase: 'idle',
    styleCursor: 0,
    awaiting: null,
    level: 'unknown',
    mastery: {},
    mistakes: [],
    exercises: [],
    history: [],
    exam: null,
    preferences: { pace: 'slow', language: 'zh' },
    updatedAt: null,
    lastChart: null,
  }
}

export function dispatch(input, action) {
  const state = clone(input || emptyState())
  const type = action?.type
  let result
  if (type === 'start') result = doStart(state, action)
  else if (type === 'answer') result = doAnswer(state, action)
  else if (type === 'hint') result = doHint(state, action)
  else if (type === 'mode') result = doMode(state, action)
  else if (type === 'progress') result = doProgress(state, action)
  else if (type === 'plot') result = doPlot(state, action)
  else result = coach(state, { say: '我没有认出这个教学动作。', ask: '你想学哪一个知识点？', phase: 'idle' })
  state.updatedAt = new Date().toISOString()
  state.history.push({
    at: state.updatedAt,
    type: type || 'unknown',
    mode: state.mode,
    concept: result.concept || '',
    judgement: result.judgement || null,
    phase: result.phase,
  })
  if (state.history.length > 80) state.history.splice(0, state.history.length - 80)
  return { state, result: freezePublic(result) }
}

function doStart(state, action) {
  const blob = [action.topic, action.note, action.problem, action.subject].filter(Boolean).join('\n')
  const requested = validMode(action.mode) || detectMode(blob)
  if (/没学过|完全不会|零基础/.test(blob)) state.level = 'beginner'
  if (/学过一点|有点印象/.test(blob)) state.level = 'partial'
  if (action.subject) state.subject = String(action.subject).slice(0, 80)
  if (action.chapter) state.chapter = String(action.chapter).slice(0, 80)

  const problem = String(action.problem || '')
  const wantExam = requested === 'exam' || problem.length > 0 || (requested == null && looksLikeProblem(blob))
  if (wantExam) {
    state.mode = 'exam'
    return openExam(state, problem || blob)
  }
  if (requested === 'gap') {
    state.mode = 'gap'
    return openGap(state)
  }
  if (requested) state.mode = requested
  const topic = String(action.topic || action.note || '').trim() || '未命名知识点'
  if (isContinuousTopic(topic) || isContinuousTopic(blob)) {
    state.lessonId = CONTINUOUS_LESSON.id
    state.subject = state.subject || CONTINUOUS_LESSON.subject
    state.chapter = state.chapter || CONTINUOUS_LESSON.chapter
    state.topic = CONTINUOUS_LESSON.topic
    state.stepIndex = 0
    state.styleCursor = 0
    state.phase = 'diagnose'
    state.awaiting = CONTINUOUS_LESSON.steps[0].id
    const step = CONTINUOUS_LESSON.steps[0]
    return coach(state, {
      concept: step.concept,
      difficulty: step.difficulty,
      phase: 'diagnose',
      say: step.open,
      ask: step.ask,
      style: STYLES[0],
    })
  }
  state.lessonId = 'generic'
  state.topic = topic.slice(0, 120)
  state.stepIndex = 0
  state.phase = 'diagnose'
  state.awaiting = 'generic-diagnose'
  state.styleCursor = 0
  return coach(state, {
    concept: state.topic,
    difficulty: 1,
    phase: 'diagnose',
    say: '先别让我直接讲完。我需要知道你现在站在哪。',
    ask: `关于「${state.topic}」，你现在最确定的一点是什么？如果还没学过，直接说没学过。`,
    style: '直观',
  })
}

function doAnswer(state, action) {
  const text = String(action.text || '').trim()
  if (!text) {
    return coach(state, { say: '我还没有看到你的回答。', ask: currentAsk(state) || '你现在怎么理解这一点？', phase: state.phase })
  }
  const switched = detectMode(text)
  if (switched && isModeCommand(text)) return applyMode(state, switched, '你要求换一种教法。')

  if (/听不懂|不明白|换一种|没懂|再讲一遍/.test(text)) {
    return reteach(state, { id: 'confused', note: '学生明确说没有听懂，必须换一种讲法，不能重复刚才的句子。' }, text)
  }
  if (state.mode === 'exam' || state.exam) {
    if (/完整解答|看答案|给出解答|全解|不要引导了/.test(text)) return revealSolution(state, '学生明确要求查看完整解答。')
    return examAnswer(state, text, action.judgement)
  }
  if (state.lessonId === CONTINUOUS_LESSON.id) return lessonAnswer(state, text, action.judgement)
  return genericAnswer(state, text, action.judgement)
}

function lessonAnswer(state, text, modelJudgement) {
  const step = CONTINUOUS_LESSON.steps[state.stepIndex] || CONTINUOUS_LESSON.steps[0]
  const judged = judge(step, text, modelJudgement)
  record(state, step, text, judged)
  if (judged.judgement !== 'correct') return reteach(state, judged.myth, text, judged.judgement)
  bump(state, step.concept, 18)
  const next = CONTINUOUS_LESSON.steps[state.stepIndex + 1]
  if (!next) {
    state.phase = 'mastered'
    state.awaiting = null
    state.stepIndex = CONTINUOUS_LESSON.steps.length
    return coach(state, {
      concept: step.concept,
      judgement: 'correct',
      advance: true,
      phase: 'mastered',
      difficulty: step.difficulty,
      say: '这一段的五个检查都通过了。连续型的概率在区间的面积上，不在单点上。',
      ask: '你想用一道考试题把这套方法走一遍，还是换下一个章节？',
      style: currentStyle(state),
    })
  }
  state.stepIndex += 1
  state.styleCursor = 0
  state.phase = next.difficulty >= 3 ? 'practice' : 'explain'
  state.awaiting = next.id
  return coach(state, {
    concept: next.concept,
    judgement: 'correct',
    advance: true,
    phase: state.phase,
    difficulty: next.difficulty,
    say: next.open,
    ask: next.ask,
    style: STYLES[0],
  })
}

function reteach(state, myth, text, judgement = 'wrong') {
  const step = currentLessonStep(state)
  state.styleCursor = Math.min(STYLES.length - 1, state.styleCursor + 1)
  const style = STYLES[state.styleCursor]
  if (step) bump(state, step.concept, judgement === 'partial' ? 4 : -6)
  const say = step?.styles?.[style] || fallbackReteach(style, state.topic)
  const chart = style === '图形' && step?.chart ? renderChart(step.chart) : null
  if (chart?.ok) state.lastChart = { title: chart.title, summary: chart.summary, kind: step.chart.kind }
  return coach(state, {
    concept: step?.concept || state.topic,
    judgement,
    advance: false,
    phase: 'analyze',
    difficulty: step?.difficulty || 1,
    misconception: myth?.note || '回答还没有碰到这个点的关键。',
    style,
    say,
    ask: step?.ask || currentAsk(state),
    chart: chart?.ok ? chart : null,
    studentText: text,
  })
}

function genericAnswer(state, text, modelJudgement) {
  const concept = state.topic || '当前知识点'
  if (/没学过|不知道|不会/.test(text)) {
    state.level = 'beginner'
    state.phase = 'frame'
    bump(state, concept, 2)
    return coach(state, {
      concept,
      judgement: 'unknown',
      advance: false,
      phase: 'frame',
      say: `那我们不从术语开始。先给「${concept}」找一个你生活里见过的影子，只找一个。`,
      ask: `如果要用一个日常情景比喻「${concept}」，你最先想到什么？想不到就说“你来举一个”。`,
      style: '类比',
    })
  }
  const judgement = modelJudgement === 'wrong' ? 'wrong' : modelJudgement === 'correct' ? 'correct' : 'partial'
  record(state, { concept, id: 'generic' }, text, { judgement, myth: null })
  if (judgement === 'correct') {
    bump(state, concept, 15)
    state.phase = 'check'
    return coach(state, {
      concept,
      judgement,
      advance: true,
      phase: 'check',
      say: '这一点先算你抓住了。先不扩展，用一个更难一点的问题确认它还在。',
      ask: `如果条件稍微变一下，你觉得「${concept}」里哪一部分会变、哪一部分不变？`,
      style: currentStyle(state),
    })
  }
  return reteach(state, { note: '回答里还没有形成一个可检查的说法。' }, text, judgement)
}

function openExam(state, raw) {
  const text = String(raw || '')
  const builtIn = isLaplaceProblem(text) || /e\^\{?-\|x\|\}|拉普拉斯/.test(text)
  state.exam = {
    builtIn,
    problem: builtIn ? LAPLACE_EXAM.problem : text.slice(0, 2000),
    type: builtIn ? LAPLACE_EXAM.type : '待学生一起识别的题目',
    concepts: builtIn ? LAPLACE_EXAM.concepts : [],
    stepIndex: 0,
    hintsUsed: [],
  }
  state.topic = builtIn ? '拉普拉斯密度函数考题' : '自定义考题'
  state.subject = state.subject || '概率论'
  state.chapter = state.chapter || '考题'
  state.phase = 'exam-identify'
  state.awaiting = 'exam'
  const step = builtIn ? LAPLACE_EXAM.steps[0] : null
  return coach(state, {
    concept: builtIn ? LAPLACE_EXAM.concepts[0] : '题型识别',
    phase: 'exam-identify',
    difficulty: 3,
    say: builtIn
      ? `题目先放着。${LAPLACE_EXAM.breakthrough}`
      : '我先不解题。先认出它在考什么，再决定第一步。',
    ask: step ? step.ask : '你觉得这道题在考哪一个知识点？',
    style: '考试',
  })
}

function examAnswer(state, text, modelJudgement) {
  const exam = state.exam
  if (!exam?.builtIn) {
    const judgement = /积分|公式|代入/.test(text) ? 'partial' : (modelJudgement || 'partial')
    record(state, { concept: '自定义考题', id: 'custom-exam' }, text, { judgement, myth: null })
    return coach(state, {
      concept: '题型识别',
      judgement,
      advance: false,
      phase: 'exam-guide',
      say: '先停在这一步。我还不能替你把整题算完。把你说的动作收成一句：条件是什么，所求是什么。',
      ask: '用一句话写出：已知什么，要求什么。先不写公式。',
      style: '考试',
    })
  }
  const step = LAPLACE_EXAM.steps[exam.stepIndex]
  if (!step) return revealSolution(state, '考题步骤已经走完，可以收束。')
  const judged = judge(step, text, modelJudgement)
  record(state, { ...step, concept: LAPLACE_EXAM.concepts[exam.stepIndex] || step.id }, text, judged)
  if (judged.judgement !== 'correct') {
    return coach(state, {
      concept: LAPLACE_EXAM.concepts[exam.stepIndex] || '解题步骤',
      judgement: judged.judgement,
      advance: false,
      phase: 'exam-guide',
      misconception: judged.myth?.note || '这一步还没对准。',
      say: judged.myth?.note || '先别往下算。回到这一问的动作本身。',
      ask: step.ask,
      style: '考试',
      difficulty: 3 + exam.stepIndex,
    })
  }
  exam.stepIndex += 1
  const next = LAPLACE_EXAM.steps[exam.stepIndex]
  if (!next) {
    state.phase = 'exam-ready'
    return coach(state, {
      concept: '区间概率',
      judgement: 'correct',
      advance: true,
      phase: 'exam-ready',
      difficulty: 5,
      say: '题型和突破口已经对齐。计算先留在你手里。需要的话可以要轻提示、思路提示或关键公式，也可以现在看完整解答。',
      ask: '你想先自己写下 E(X)，还是先要一个轻提示？',
      style: '考试',
    })
  }
  state.phase = 'exam-guide'
  return coach(state, {
    concept: LAPLACE_EXAM.concepts[exam.stepIndex] || next.id,
    judgement: 'correct',
    advance: true,
    phase: 'exam-guide',
    difficulty: 3 + exam.stepIndex,
    say: '这一步对了。先不把后面的计算一起做掉。',
    ask: next.ask,
    style: '考试',
  })
}

function doHint(state, action) {
  const level = ['light', 'idea', 'formula', 'solution'].includes(action.level) ? action.level : 'light'
  if (!state.exam) {
    return coach(state, {
      say: '现在不在考题里。提示只在考题攻坚时分级给出。',
      ask: state.topic ? `我们还在看「${state.topic}」。你对当前这个问题的想法是什么？` : '你想从哪一个知识点开始？',
      phase: state.phase,
    })
  }
  if (!state.exam.builtIn) {
    const generic = {
      light: '先把已知和所求分成两行，暂时不要选公式。',
      idea: '找出题目里决定方法的那个条件：离散还是连续，有限还是无穷，是否对称。',
      formula: '只写你认为会用到的那一个关系式，不要把数字代进去。',
    }
    if (level === 'solution') return revealSolution(state, '自定义题目没有内置全解。允许模型按步骤写出完整解答，并在最后总结通用方法。')
    state.exam.hintsUsed = [...new Set([...(state.exam.hintsUsed || []), level])]
    return coach(state, {
      phase: 'exam-hint',
      hintLevel: level,
      say: generic[level],
      ask: '看完这一级提示之后，你的下一步是什么？',
      style: '考试',
      concept: '自定义考题',
    })
  }
  if (level === 'solution') return revealSolution(state, '学生要求这一级提示为完整解答。')
  state.exam.hintsUsed = [...new Set([...(state.exam.hintsUsed || []), level])]
  return coach(state, {
    phase: 'exam-hint',
    hintLevel: level,
    concept: '拉普拉斯密度',
    difficulty: level === 'formula' ? 4 : 3,
    say: LAPLACE_EXAM.hints[level],
    ask: '用这个提示，你下一步具体写哪一行？',
    style: '考试',
  })
}

function revealSolution(state, why) {
  state.phase = 'exam-solution'
  if (state.exam) state.exam.revealed = true
  const text = state.exam?.builtIn
    ? LAPLACE_EXAM.solution
    : '可以按以下顺序给出完整解答：题型、已知与所求、突破口、分步计算、结果、一句可迁移的方法。不要再藏着。'
  return coach(state, {
    phase: 'exam-solution',
    reveal: true,
    revealText: text,
    concept: state.exam?.builtIn ? '拉普拉斯密度' : '完整解答',
    say: why,
    ask: '哪一步是你原来没想到的？用一句话再说一次这个方法用在什么题上。',
    style: '考试',
    judgement: 'reveal',
    advance: true,
  })
}

function doMode(state, action) {
  const mode = validMode(action.mode) || detectMode(action.reason || '')
  if (!mode) {
    return coach(state, {
      say: '五种模式是：循序渐进、考题攻坚、查漏补缺、快速讲解、自主探索。',
      ask: '你要换哪一种？',
      phase: state.phase,
    })
  }
  return applyMode(state, mode, action.reason || '')
}

function applyMode(state, mode, reason) {
  const prev = state.mode
  state.mode = mode
  if (mode === 'gap') return openGap(state, prev)
  if (mode === 'exam' && !state.exam) {
    return coach(state, {
      phase: 'exam-identify',
      say: `已从${MODE_LABEL[prev] || prev}换成考题攻坚。${reason || ''}`.trim(),
      ask: '把题目原文发给我。先不要自己把答案写完。',
      style: '考试',
      modeChanged: { from: prev, to: mode },
    })
  }
  const extra = mode === 'explore'
    ? '接下来我不先给公式，你来推下一步。'
    : mode === 'brief'
      ? '接下来只说当前这一点的关键句，然后留一个检查问题。'
      : '接下来仍然一次只走一个点。'
  return coach(state, {
    phase: state.phase === 'idle' ? 'diagnose' : state.phase,
    say: `模式已换成${MODE_LABEL[mode]}。${extra}`,
    ask: currentAsk(state) || '你现在想看的那一个点是什么？',
    style: mode === 'explore' ? '推导' : currentStyle(state),
    modeChanged: { from: prev, to: mode },
    concept: currentLessonStep(state)?.concept || state.topic,
  })
}

function openGap(state, prev) {
  state.mode = 'gap'
  const weak = weakest(state)
  if (!weak) {
    state.phase = 'diagnose'
    return coach(state, {
      phase: 'diagnose',
      say: '记录里还没有足够的对错，暂时指不出薄弱点。',
      ask: '你最近哪一个知识点最不踏实？用它的名字告诉我。',
      modeChanged: prev ? { from: prev, to: 'gap' } : null,
    })
  }
  state.topic = weak.concept
  state.phase = 'gap'
  return coach(state, {
    concept: weak.concept,
    phase: 'gap',
    say: `目前最弱的是「${weak.concept}」，掌握分 ${weak.score}。先只补这一个。`,
    ask: `不看笔记的话，你怎么向同学解释「${weak.concept}」？`,
    modeChanged: prev ? { from: prev, to: 'gap' } : null,
    style: '直观',
  })
}

function doProgress(state, action) {
  const act = action.action || 'get'
  if (act === 'reset') {
    const fresh = emptyState()
    Object.assign(state, fresh)
    return coach(state, { say: '学习记录已清除。', ask: '接下来想学什么？', phase: 'idle', progressAction: 'reset' })
  }
  if (action.subject) state.subject = String(action.subject).slice(0, 80)
  if (action.chapter) state.chapter = String(action.chapter).slice(0, 80)
  if (action.pace === 'slow' || action.pace === 'normal') state.preferences.pace = action.pace
  return coach(state, {
    say: act === 'export' ? '下面是可导出的学习记录摘要。' : '这是当前保存在本地的学习进度。',
    ask: state.awaiting ? (currentAsk(state) || '要继续刚才那个问题吗？') : '要继续学习，还是清除记录？',
    phase: state.phase,
    progressAction: act,
  })
}

function doPlot(state, action) {
  const chart = renderChart(action)
  if (chart.ok) state.lastChart = { title: chart.title, summary: chart.summary, kind: action.kind }
  return coach(state, {
    phase: state.phase === 'idle' ? 'explain' : state.phase,
    say: chart.ok ? `这张图只服务当前这一点：${chart.summary}` : `图没有画成：${chart.error}`,
    ask: currentAsk(state) || '看图之后，你觉得它在说明哪一件事？',
    chart: chart.ok ? chart : null,
    plotError: chart.ok ? null : chart.error,
    concept: currentLessonStep(state)?.concept || state.topic,
    style: '图形',
  })
}

function judge(step, text, modelJudgement) {
  const norm = normalize(text)
  const myth = (step.myths || []).find((m) => m.patterns.some((p) => norm.includes(normalize(p))))
  if (myth) return { judgement: 'wrong', myth }
  const hits = (step.signals || []).filter((s) => norm.includes(normalize(s)))
  if (hits.length >= (step.minHits || 1)) return { judgement: 'correct', myth: null }
  if (modelJudgement === 'correct' && hits.length === 0) return { judgement: 'partial', myth: null }
  if (modelJudgement === 'wrong') return { judgement: 'wrong', myth: null }
  if (hits.length > 0) return { judgement: 'partial', myth: null }
  return { judgement: 'wrong', myth: null }
}

function record(state, step, text, judged) {
  const concept = step.concept || step.id
  if (judged.judgement === 'wrong' || judged.myth) {
    state.mistakes.push({
      at: new Date().toISOString(),
      concept,
      myth: judged.myth?.id || null,
      note: judged.myth?.note || '',
      text: text.slice(0, 240),
    })
    if (state.mistakes.length > 100) state.mistakes.splice(0, state.mistakes.length - 100)
  }
  state.exercises.push({ id: step.id || concept, judgement: judged.judgement, at: new Date().toISOString() })
  if (state.exercises.length > 100) state.exercises.splice(0, state.exercises.length - 100)
}

function bump(state, concept, delta) {
  const row = state.mastery[concept] || { score: 40, attempts: 0, wrong: 0 }
  row.attempts += 1
  if (delta < 0) row.wrong += 1
  row.score = clamp(row.score + delta, 0, 100)
  state.mastery[concept] = row
}

function weakest(state) {
  const rows = Object.entries(state.mastery)
  if (!rows.length) return null
  rows.sort((a, b) => a[1].score - b[1].score)
  return { concept: rows[0][0], score: rows[0][1].score }
}

function currentLessonStep(state) {
  if (state.lessonId !== CONTINUOUS_LESSON.id) return null
  return CONTINUOUS_LESSON.steps[state.stepIndex] || null
}

function currentStyle(state) {
  return STYLES[state.styleCursor] || STYLES[0]
}

function currentAsk(state) {
  if (state.lessonId === CONTINUOUS_LESSON.id) return currentLessonStep(state)?.ask || ''
  if (state.exam?.builtIn) return LAPLACE_EXAM.steps[state.exam.stepIndex]?.ask || '你想先写期望，还是先要一个轻提示？'
  return ''
}

function fallbackReteach(style, topic) {
  if (style === '类比') return `先不重复定义。给「${topic}」找一个你已经会的生活情景，只比较其中的一个差别。`
  if (style === '图形') return `先别看公式。想象把「${topic}」画成一张图，图上应该出现哪一个对象？`
  if (style === '推导') return `只推一行：从你已经同意的那句话出发，下一步必然是什么？`
  if (style === '考试') return `先想考场上这一步是在送分还是在设陷阱。你觉得陷阱在哪？`
  return `我们换一个入口，只保留「${topic}」里最小的那一部分。`
}

function coach(state, patch) {
  const strategy = strategyFor(state.mode)
  const forbid = [...FORBID_BASE]
  if (!strategy.allowFormula) forbid.push('不要先把公式端出来。')
  if (!patch.reveal) forbid.push('不要输出完整解答。')
  return {
    ok: patch.plotError ? false : true,
    mode: state.mode,
    modeLabel: MODE_LABEL[state.mode] || state.mode,
    phase: patch.phase || state.phase,
    subject: state.subject,
    chapter: state.chapter,
    topic: state.topic,
    concept: patch.concept || '',
    difficulty: patch.difficulty || 1,
    judgement: patch.judgement || null,
    advance: Boolean(patch.advance),
    style: patch.style || currentStyle(state),
    misconception: patch.misconception || null,
    say: patch.say || '',
    ask: patch.ask || '',
    forbid,
    reveal: Boolean(patch.reveal),
    revealText: patch.reveal ? (patch.revealText || '') : null,
    strategy,
    chart: patch.chart ? { title: patch.chart.title, svg: patch.chart.svg, dataUri: patch.chart.dataUri, summary: patch.chart.summary } : null,
    hintLevel: patch.hintLevel || null,
    modeChanged: patch.modeChanged || null,
    progressAction: patch.progressAction || null,
    plotError: patch.plotError || null,
    progress: snapshot(state),
  }
}

function snapshot(state) {
  const mastery = Object.entries(state.mastery).map(([concept, row]) => ({ concept, score: row.score, attempts: row.attempts, wrong: row.wrong }))
  return {
    mode: state.mode,
    subject: state.subject,
    chapter: state.chapter,
    topic: state.topic,
    phase: state.phase,
    level: state.level,
    lessonId: state.lessonId,
    stepIndex: state.stepIndex,
    awaiting: state.awaiting,
    mastery,
    mistakeCount: state.mistakes.length,
    exerciseCount: state.exercises.length,
    recentMistakes: state.mistakes.slice(-5),
    preferences: state.preferences,
    exam: state.exam ? { type: state.exam.type, stepIndex: state.exam.stepIndex, hintsUsed: state.exam.hintsUsed, revealed: Boolean(state.exam.revealed) } : null,
  }
}

export function snapshotOf(state) {
  return snapshot(state || emptyState())
}

function freezePublic(result) {
  if (!result.reveal) result.revealText = null
  return result
}

export function formatCoach(result) {
  if (!result) return ''
  const lines = [
    '【TutorFlow 教学指令】只执行这一步。润色可以，增加知识点或第二个问题不行。',
    `模式：${result.modeLabel}（${result.mode}）`,
    `阶段：${result.phase}`,
    result.concept ? `当前知识点：${result.concept}` : '',
    `难度：${result.difficulty}`,
    result.judgement ? `对学生刚才回答的判断：${result.judgement}` : '',
    result.misconception ? `错在这类想法：${result.misconception}` : '',
    result.advance ? '可以进入下一步。' : '不要进入下一步。',
    `讲解方式：${result.style}`,
    `可以说：${result.say}`,
    result.ask ? `必须只问这一个问题：${result.ask}` : '这一步不必追问。',
    '禁止：',
    ...result.forbid.map((f) => `- ${f}`),
  ]
  if (result.reveal && result.revealText) {
    lines.push('允许给出的完整内容：', result.revealText)
  }
  if (result.chart?.svg) {
    lines.push(`图形：${result.chart.title}。${result.chart.summary}`)
    lines.push(`![${result.chart.title}](${result.chart.dataUri})`)
  }
  if (result.progress) {
    const weak = [...result.progress.mastery].sort((a, b) => a.score - b.score)[0]
    lines.push(`进度：${result.progress.subject || '未定科目'} / ${result.progress.chapter || '未定章节'} / ${result.progress.topic || '未定知识点'}`)
    if (weak) lines.push(`最弱：${weak.concept}（${weak.score}）`)
  }
  return lines.filter(Boolean).join('\n')
}

function validMode(mode) {
  return MODES.includes(mode) ? mode : null
}

function looksLikeProblem(text) {
  return /求\s*[PEDF]|证明|设随机变量|概率密度函数为|f\(x\)\s*=/.test(text) && text.length > 40
}

function isModeCommand(text) {
  return /模式|切换|换成|改为/.test(text) && detectMode(text)
}

function normalize(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')')
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n))
}

function clone(v) {
  return JSON.parse(JSON.stringify(v))
}
