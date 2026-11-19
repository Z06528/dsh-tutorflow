import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { renderChart } from '../lib/charts.js'
import { LAPLACE_EXAM } from '../lib/curriculum.js'
import { dispatch, emptyState, formatCoach } from '../lib/engine.js'
import { createStore } from '../lib/store.js'
import { apply, name } from '../index.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const forbidden = /openai\.com|googleapis\.com|jsdelivr\.net|unpkg\.com|fonts\.gstatic|cdnjs\.cloudflare/

function questions(s) {
  return (String(s || '').match(/？/g) || []).length
}

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
    assert.ok(restored.mastery['连续与离散的区别'])
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
      'tutorflow_answer', 'tutorflow_hint', 'tutorflow_mode', 'tutorflow_plot', 'tutorflow_progress', 'tutorflow_start',
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

test('源码不依赖境外 API 或 CDN', () => {
  const files = walk(root).filter((f) => /\.(js|mjs|yml|md|json)$/.test(f) && !f.includes(`${path.sep}test${path.sep}`))
  assert.ok(files.length > 8)
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    assert.doesNotMatch(text, forbidden, file)
    if (file.endsWith('.js') && !file.endsWith('client.browser.js')) {
      assert.doesNotMatch(text, /\bfetch\s*\(/, file)
    }
  }
  const original = globalThis.fetch
  globalThis.fetch = () => { throw new Error('network') }
  try {
    const chart = renderChart({ kind: 'normal_pdf', mu: 1, sigma: 0.5 })
    assert.equal(chart.ok, true)
  } finally {
    globalThis.fetch = original
  }
})

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name === 'node_modules' || name.name === '.git') continue
    const full = path.join(dir, name.name)
    if (name.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

void LAPLACE_EXAM
