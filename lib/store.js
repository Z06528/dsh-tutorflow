/**
 * 本地学习进度文件。默认 `$DSH_HOME/dsh-tutorflow/state.json`。
 *
 * 写入用「临时文件 + 改名」，读按 mtime 重新取，两个进程不会各持一份旧数据。
 * 读出来的旧版（v1）状态会被迁移成 v2，不丢已有掌握度与错题。
 */
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { emptyState } from './engine.js'
import { migrateRow } from './mastery.js'

export function resolveDataDir(env = process.env, homeDir = '') {
  if (env.TUTORFLOW_HOME) return env.TUTORFLOW_HOME
  const root = env.DSH_HOME || homeDir || path.join(defaultHome(), '.dsh')
  return path.join(root, 'dsh-tutorflow')
}

function defaultHome() {
  return process.env.HOME || process.env.USERPROFILE || tmpdir()
}

export function createStore(dir = resolveDataDir()) {
  const file = path.join(dir, 'state.json')
  let cache = null
  function read() {
    try {
      const st = statSync(file)
      if (cache && cache.mtimeMs === st.mtimeMs) return clone(cache.data)
      const data = normalize(JSON.parse(readFileSync(file, 'utf8')))
      cache = { mtimeMs: st.mtimeMs, data }
      return clone(data)
    } catch {
      return emptyState()
    }
  }
  function write(state) {
    mkdirSync(dir, { recursive: true })
    const payload = JSON.stringify(state, null, 2)
    const tmp = path.join(dir, `state.${process.pid}.tmp`)
    writeFileSync(tmp, payload)
    renameSync(tmp, file)
    const st = statSync(file)
    cache = { mtimeMs: st.mtimeMs, data: JSON.parse(payload) }
  }
  function reset() {
    try { rmSync(file, { force: true }) } catch { /* already gone */ }
    cache = null
    write(emptyState())
  }
  function exportJson() {
    return JSON.stringify(read(), null, 2)
  }
  return { dir, file, read, write, reset, exportJson }
}

/**
 * 补齐缺字段，并把 v1 的记录迁移到 v2。
 * @param {unknown} data 磁盘上的原始 JSON。
 */
export function normalize(data) {
  const base = emptyState()
  if (!data || typeof data !== 'object') return base
  const merged = { ...base, ...data }
  merged.version = 2
  merged.preferences = { ...base.preferences, ...(data.preferences || {}) }
  merged.focus = { ...base.focus, ...(data.focus || {}), used: Array.isArray(data.focus?.used) ? data.focus.used : [] }
  merged.mistakes = Array.isArray(data.mistakes) ? data.mistakes : []
  merged.exercises = Array.isArray(data.exercises) ? data.exercises : []
  merged.history = Array.isArray(data.history) ? data.history : []
  merged.mastery = migrateMastery(data.mastery)
  merged.plan = normalizePlan(data.plan)
  return merged
}

function migrateMastery(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = {}
  for (const [key, row] of Object.entries(raw)) {
    if (!row || typeof row !== 'object') continue
    const isLegacy = !('evidence' in row) && ('attempts' in row || 'score' in row)
    if (isLegacy) out[key] = migrateRow(row.label || key, row)
    else {
      out[key] = {
        ...migrateRow(row.label || key, { score: row.score, attempts: row.evidence, wrong: row.wrong }),
        ...row,
        errors: row.errors || {},
        days: Array.isArray(row.days) ? row.days : [],
      }
    }
  }
  return out
}

function normalizePlan(plan) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.steps)) return null
  return {
    ...plan,
    cursor: Number.isInteger(plan.cursor) ? plan.cursor : 0,
    steps: plan.steps.map((step, index) => ({
      ...step,
      id: step.id || `s${index + 1}`,
      label: step.label || step.concept || `第 ${index + 1} 步`,
      representations: Array.isArray(step.representations) && step.representations.length ? step.representations : ['直观', '类比', '图形', '推导'],
      asked: Number(step.asked) || 0,
      correct: Number(step.correct) || 0,
      wrong: Number(step.wrong) || 0,
      evidence: Number(step.evidence) || 0,
      status: step.status || (index < (plan.cursor || 0) ? 'done' : index === (plan.cursor || 0) ? 'active' : 'pending'),
    })),
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}
