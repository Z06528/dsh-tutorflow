/**
 * Local progress file under $DSH_HOME/dsh-tutorflow.
 * Atomic replace plus mtime re-read so two processes do not keep a stale copy.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { emptyState } from './engine.js'

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

function normalize(data) {
  const base = emptyState()
  if (!data || typeof data !== 'object') return base
  return { ...base, ...data, preferences: { ...base.preferences, ...(data.preferences || {}) }, mastery: data.mastery || {}, mistakes: data.mistakes || [], exercises: data.exercises || [], history: data.history || [] }
}

function clone(v) {
  return JSON.parse(JSON.stringify(v))
}
