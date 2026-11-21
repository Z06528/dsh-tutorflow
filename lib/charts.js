/**
 * Local SVG charts. No CDN, no canvas dependency, no network.
 * Every chart uses a viewBox so the host UI can scale it.
 */
import { compileExpr, sampleExpr } from './expr.js'

const W = 640
const H = 380
const PAD = { l: 52, r: 18, t: 28, b: 42 }

export function svgDataUri(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function frame(title, body, caption) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(title)}">
  <rect width="${W}" height="${H}" fill="#f7f3ea"/>
  <text x="20" y="22" fill="#1b2330" font-family="Palatino, Songti SC, serif" font-size="15">${esc(title)}</text>
  ${body}
  <text x="20" y="${H - 8}" fill="#5c564c" font-family="Palatino, Songti SC, serif" font-size="11">${esc(caption || '')}</text>
</svg>`
}

function lin(a, b, t) {
  if (a === b) return 0
  return (t - a) / (b - a)
}

function pathFrom(pts, xOf, yOf) {
  let d = ''
  let pen = false
  for (const p of pts) {
    if (p.y == null || !Number.isFinite(p.y)) { pen = false; continue }
    const x = xOf(p.x)
    const y = yOf(p.y)
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `
    pen = true
  }
  return d.trim()
}

function niceStep(span) {
  const raw = span / 5
  const pow = Math.pow(10, Math.floor(Math.log10(Math.abs(raw) || 1)))
  const n = raw / pow
  const m = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10
  return m * pow
}

function axes(xMin, xMax, yMin, yMax) {
  const x0 = PAD.l
  const x1 = W - PAD.r
  const y0 = PAD.t
  const y1 = H - PAD.b
  const X = (x) => x0 + lin(xMin, xMax, x) * (x1 - x0)
  const Y = (y) => y1 - lin(yMin, yMax, y) * (y1 - y0)
  const stepX = niceStep(xMax - xMin)
  const stepY = niceStep(yMax - yMin)
  let grid = ''
  for (let x = Math.ceil(xMin / stepX) * stepX; x <= xMax + 1e-9; x += stepX) {
    const px = X(x)
    grid += `<line x1="${px.toFixed(1)}" y1="${y0}" x2="${px.toFixed(1)}" y2="${y1}" stroke="#e4dccb" stroke-width="1"/>`
    grid += `<text x="${px.toFixed(1)}" y="${y1 + 16}" text-anchor="middle" fill="#5c564c" font-size="11" font-family="Palatino, serif">${tick(x)}</text>`
  }
  for (let y = Math.ceil(yMin / stepY) * stepY; y <= yMax + 1e-9; y += stepY) {
    const py = Y(y)
    grid += `<line x1="${x0}" y1="${py.toFixed(1)}" x2="${x1}" y2="${py.toFixed(1)}" stroke="#e4dccb" stroke-width="1"/>`
    grid += `<text x="${x0 - 8}" y="${py.toFixed(1) + 4}" text-anchor="end" fill="#5c564c" font-size="11" font-family="Palatino, serif">${tick(y)}</text>`
  }
  const zx = xMin <= 0 && xMax >= 0 ? X(0) : x0
  const zy = yMin <= 0 && yMax >= 0 ? Y(0) : y1
  grid += `<line x1="${zx.toFixed(1)}" y1="${y0}" x2="${zx.toFixed(1)}" y2="${y1}" stroke="#1b2330" stroke-width="1.2"/>`
  grid += `<line x1="${x0}" y1="${zy.toFixed(1)}" x2="${x1}" y2="${zy.toFixed(1)}" stroke="#1b2330" stroke-width="1.2"/>`
  return { X, Y, grid, y0, y1, x0, x1, zy }
}

function tick(n) {
  if (!Number.isFinite(n)) return ''
  const a = Math.abs(n)
  if (a !== 0 && (a < 0.01 || a >= 10000)) return n.toExponential(1)
  return String(Math.round(n * 1000) / 1000)
}

function boundsY(pts, padRatio = 0.12) {
  const ys = pts.map((p) => p.y).filter((y) => y != null && Number.isFinite(y))
  if (!ys.length) return { yMin: -1, yMax: 1 }
  let yMin = Math.min(...ys)
  let yMax = Math.max(...ys)
  if (yMin === yMax) { yMin -= 1; yMax += 1 }
  const pad = (yMax - yMin) * padRatio
  yMin -= pad
  yMax += pad
  if (yMin > 0) yMin = 0
  if (yMax < 0) yMax = 0
  return { yMin, yMax }
}

export function normalPdf(x, mu = 0, sigma = 1) {
  const s = sigma > 0 ? sigma : 1
  const z = (x - mu) / s
  return Math.exp(-0.5 * z * z) / (s * Math.sqrt(2 * Math.PI))
}

export function normalCdf(x, mu = 0, sigma = 1) {
  const s = sigma > 0 ? sigma : 1
  const z = (x - mu) / (s * Math.SQRT2)
  return 0.5 * (1 + erf(z))
}

function erf(z) {
  const sign = z < 0 ? -1 : 1
  const a = Math.abs(z)
  const t = 1 / (1 + 0.3275911 * a)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)
  return sign * y
}

function curveChart({ title, pts, xMin, xMax, shade, caption, color = '#c23b22' }) {
  const { yMin, yMax } = boundsY(pts)
  const g = axes(xMin, xMax, yMin, yMax)
  let shadePath = ''
  if (shade && shade.pts?.length) {
    const baseline = g.Y(Math.max(yMin, 0))
    const d = pathFrom(shade.pts, g.X, g.Y)
    if (d) {
      const first = shade.pts.find((p) => p.y != null)
      const last = [...shade.pts].reverse().find((p) => p.y != null)
      shadePath = `<path d="${d} L${g.X(last.x).toFixed(1)} ${baseline.toFixed(1)} L${g.X(first.x).toFixed(1)} ${baseline.toFixed(1)} Z" fill="${color}" fill-opacity="0.22" stroke="none"/>`
    }
  }
  const d = pathFrom(pts, g.X, g.Y)
  const body = `${g.grid}${shadePath}<path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>`
  return frame(title, body, caption)
}

export function renderChart(spec = {}) {
  const kind = spec.kind
  try {
    if (kind === 'normal_pdf' || kind === 'normal_cdf') {
      const mu = num(spec.mu, 0)
      const sigma = Math.max(0.05, num(spec.sigma, 1))
      const xMin = num(spec.xMin, mu - 4 * sigma)
      const xMax = num(spec.xMax, mu + 4 * sigma)
      const fn = kind === 'normal_pdf' ? (x) => normalPdf(x, mu, sigma) : (x) => normalCdf(x, mu, sigma)
      const pts = sampleExpr(fn, xMin, xMax, 200)
      let shade
      if (kind === 'normal_pdf' && spec.shadeFrom != null && spec.shadeTo != null) {
        const a = Number(spec.shadeFrom)
        const b = Number(spec.shadeTo)
        const lo = Math.min(a, b)
        const hi = Math.max(a, b)
        shade = { pts: sampleExpr(fn, Math.max(lo, xMin), Math.min(hi, xMax), 80) }
      }
      const title = spec.title || (kind === 'normal_pdf' ? `正态分布密度  μ=${tickish(mu)}  σ=${tickish(sigma)}` : `正态分布函数  μ=${tickish(mu)}  σ=${tickish(sigma)}`)
      const caption = kind === 'normal_pdf'
        ? '曲线下的面积才是概率。单点没有宽度，概率为 0。'
        : 'F(x) = P(X ≤ x)，从左累加到 x 的面积。'
      const svg = curveChart({ title, pts, xMin, xMax, shade, caption, color: '#2a6a4b' })
      return ok(title, svg, caption)
    }
    if (kind === 'function' || kind === 'integral') {
      const expr = String(spec.expr || 'x')
      const fn = compileExpr(expr)
      const xMin = num(spec.xMin, -4)
      const xMax = num(spec.xMax, 4)
      if (!(xMax > xMin)) throw new Error('xMax 必须大于 xMin')
      const pts = sampleExpr(fn, xMin, xMax, 220)
      let shade
      let caption = `y = ${expr}`
      if (kind === 'integral') {
        const a = num(spec.a, -1)
        const b = num(spec.b, 1)
        const lo = Math.max(Math.min(a, b), xMin)
        const hi = Math.min(Math.max(a, b), xMax)
        shade = { pts: sampleExpr(fn, lo, hi, 100) }
        caption = `阴影是 ${tickish(Math.min(a, b))} 到 ${tickish(Math.max(a, b))} 的积分区域，面积表示这段上的累积量。`
      }
      const title = spec.title || (kind === 'integral' ? `积分区域  y = ${expr}` : `函数图像  y = ${expr}`)
      const svg = curveChart({ title, pts, xMin, xMax, shade, caption })
      return ok(title, svg, caption)
    }
    if (kind === 'coordinate') {
      return ok(spec.title || '坐标示意图', coordinateSvg(spec), '平面上的点与线段。')
    }
    if (kind === 'concept_map') {
      return ok(spec.title || '知识结构', conceptSvg(spec), '只展开当前这一层，不一次铺开整章。')
    }
    if (kind === 'flowchart') {
      return ok(spec.title || '解题流程', flowSvg(spec), '一次只走当前这一步。')
    }
    if (kind === 'discrete_vs_continuous') {
      return ok('离散的点，连续的区间', discreteContinuousSvg(), '上面数得清的点；下面是一条没有单点质量的曲线。')
    }
    if (kind === 'bar') {
      const title = spec.title || '数值对比'
      const summary = '每根柱子的高度就是数值本身，比较长短比读数字快。'
      return ok(title, barSvg(spec), summary)
    }
    if (kind === 'series') {
      const title = spec.title || '曲线对照'
      return ok(title, seriesSvg(spec), '多条线放在同一张坐标里，看的是趋势和交点。')
    }
    if (kind === 'table') {
      const title = spec.title || '对照表'
      return ok(title, tableSvg(spec), '表格用来并列对照；一次只比一列。')
    }
    if (kind === 'tree') {
      const title = spec.title || '结构图'
      return ok(title, treeSvg(spec), '只展开当前这一层，不要一次铺开整章。')
    }
    if (kind === 'timeline') {
      const title = spec.title || '时间线'
      return ok(title, timelineSvg(spec), '按发生顺序看，先后关系比年份更重要。')
    }
    if (kind === 'code') {
      const title = spec.title || '执行追踪'
      return ok(title, codeSvg(spec), '一行一行对上发生了什么，比读整段代码清楚。')
    }
    throw new Error(`不支持的图形类型 ${kind}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const svg = frame('图形没有画成', `<text x="40" y="180" fill="#c23b22" font-size="16" font-family="Palatino, Songti SC, serif">${esc(message)}</text>`, '改参数后再试。')
    return { ok: false, title: '图形没有画成', svg, dataUri: svgDataUri(svg), summary: message, error: message }
  }
}

function ok(title, svg, summary) {
  return { ok: true, title, svg, dataUri: svgDataUri(svg), summary }
}

function num(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
function tickish(n) {
  return String(Math.round(n * 1000) / 1000)
}

function coordinateSvg(spec) {
  const pts = Array.isArray(spec.points) ? spec.points : []
  const xs = pts.map((p) => Number(p.x)).filter(Number.isFinite)
  const ys = pts.map((p) => Number(p.y)).filter(Number.isFinite)
  const xMin = num(spec.xMin, Math.min(-1, ...xs, 0) - 1)
  const xMax = num(spec.xMax, Math.max(1, ...xs, 0) + 1)
  const yMin = num(spec.yMin, Math.min(-1, ...ys, 0) - 1)
  const yMax = num(spec.yMax, Math.max(1, ...ys, 0) + 1)
  const g = axes(xMin, xMax, yMin, yMax)
  let marks = g.grid
  for (const p of pts) {
    if (!Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))) continue
    const x = g.X(Number(p.x))
    const y = g.Y(Number(p.y))
    marks += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="#c23b22"/>`
    marks += `<text x="${(x + 8).toFixed(1)}" y="${(y - 8).toFixed(1)}" fill="#1b2330" font-size="12" font-family="Palatino, Songti SC, serif">${esc(p.label || '')}</text>`
  }
  return frame(spec.title || '坐标示意图', marks, '拖动或改参数会重画，这张图本身是矢量，可以缩放。')
}

function conceptSvg(spec) {
  const raw = String(spec.chain || '概念|关系|检查')
  const nodes = raw.split(/[>|｜\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 6)
  const boxW = 150
  const gap = 28
  const total = nodes.length * boxW + (nodes.length - 1) * gap
  let x = Math.max(24, (W - total) / 2)
  let body = ''
  nodes.forEach((label, i) => {
    const y = 150
    body += `<rect x="${x}" y="${y}" width="${boxW}" height="64" rx="6" fill="${i === 0 ? '#1b2330' : '#fffaf3'}" stroke="#1b2330"/>`
    body += `<text x="${x + boxW / 2}" y="${y + 38}" text-anchor="middle" fill="${i === 0 ? '#f7f3ea' : '#1b2330'}" font-size="14" font-family="Palatino, Songti SC, serif">${esc(label)}</text>`
    if (i < nodes.length - 1) {
      const x2 = x + boxW
      body += `<line x1="${x2}" y1="${y + 32}" x2="${x2 + gap - 6}" y2="${y + 32}" stroke="#c23b22" stroke-width="1.6"/>`
      body += `<polygon points="${x2 + gap - 2},${y + 32} ${x2 + gap - 10},${y + 27} ${x2 + gap - 10},${y + 37}" fill="#c23b22"/>`
    }
    x += boxW + gap
  })
  return frame(spec.title || '知识结构', body, '当前只连出这一条线。')
}

function flowSvg(spec) {
  const steps = String(spec.steps || '识别题型|找到突破口|先问学生第一步')
    .split(/[>|｜\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 5)
  let body = ''
  steps.forEach((label, i) => {
    const y = 48 + i * 62
    const fill = i === 0 ? '#1b2330' : '#fffaf3'
    const color = i === 0 ? '#f7f3ea' : '#1b2330'
    body += `<rect x="170" y="${y}" width="300" height="46" rx="8" fill="${fill}" stroke="#1b2330"/>`
    body += `<text x="320" y="${y + 29}" text-anchor="middle" fill="${color}" font-size="14" font-family="Palatino, Songti SC, serif">${esc(label)}</text>`
    if (i < steps.length - 1) {
      body += `<line x1="320" y1="${y + 46}" x2="320" y2="${y + 58}" stroke="#c23b22" stroke-width="1.6"/>`
    }
  })
  return frame(spec.title || '解题流程', body, '学生停在哪一步，就只谈哪一步。')
}

function discreteContinuousSvg() {
  let stems = ''
  const xs = [80, 140, 200, 260]
  xs.forEach((x, i) => {
    const h = 40 + i * 28
    stems += `<line x1="${x}" y1="168" x2="${x}" y2="${168 - h}" stroke="#1b2330" stroke-width="2"/>`
    stems += `<circle cx="${x}" cy="${168 - h}" r="5" fill="#c23b22"/>`
  })
  stems += `<text x="70" y="192" fill="#5c564c" font-size="13" font-family="Palatino, Songti SC, serif">离散：点上有质量</text>`
  const pts = []
  for (let i = 0; i <= 80; i += 1) {
    const t = i / 80
    const x = 340 + t * 250
    const y = 168 - Math.sin(t * Math.PI) * 90
    pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
  }
  stems += `<path d="${pts.join(' ')}" fill="none" stroke="#2a6a4b" stroke-width="2.4"/>`
  stems += `<text x="340" y="192" fill="#5c564c" font-size="13" font-family="Palatino, Songti SC, serif">连续：概率在区间的面积上</text>`
  return frame('先看差别，不看公式', stems, '数得清的点，和铺开的一段，不是同一种概率。')
}

/* ------------------------------------------------------------------ *
 * 通用图形。全部本地 SVG，只用 viewBox 缩放，不引用任何外部资源。
 * ------------------------------------------------------------------ */

const PALETTE = ['#c23b22', '#2a6a4b', '#1b2330', '#8a6d3b', '#4a5d8a', '#7a3b5c']

/** 拆列表：支持 | ｜ 换行 分号 逗号。 */
function list(value, limit = 12) {
  if (Array.isArray(value)) return value.map((v) => String(v)).slice(0, limit)
  return String(value ?? '')
    .split(/[|｜\n;；]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, limit)
}

/** 拆数字列表。 */
function numbers(value, limit = 12) {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite).slice(0, limit)
  return String(value ?? '')
    .split(/[,\s|｜]+/)
    .filter((token) => token.trim() !== '')
    .map((token) => Number(token))
    .filter(Number.isFinite)
    .slice(0, limit)
}

function fitLabel(text, max = 12) {
  const s = String(text ?? '')
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}

/** 柱状图：统计、经济、对比都用得上。 */
function barSvg(spec) {
  const labels = list(spec.labels, 10)
  const values = numbers(spec.values, 10)
  if (!values.length) throw new Error('bar 需要 values，例如 "3,7,5"')
  const n = values.length
  const maxV = Math.max(...values, 0)
  const minV = Math.min(...values, 0)
  const span = maxV - minV || 1
  const x0 = 64
  const x1 = W - 32
  const y0 = 56
  const y1 = H - 62
  const zero = y1 - ((0 - minV) / span) * (y1 - y0)
  const slot = (x1 - x0) / n
  const barW = Math.max(14, Math.min(72, slot * 0.58))
  let body = `<line x1="${x0}" y1="${zero.toFixed(1)}" x2="${x1}" y2="${zero.toFixed(1)}" stroke="#1b2330" stroke-width="1.2"/>`
  values.forEach((value, i) => {
    const cx = x0 + slot * i + slot / 2
    const top = y1 - ((value - minV) / span) * (y1 - y0)
    const y = Math.min(top, zero)
    const h = Math.max(1, Math.abs(zero - top))
    const color = PALETTE[i % PALETTE.length]
    body += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" fill-opacity="0.85" rx="2"/>`
    body += `<text x="${cx.toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" fill="#1b2330" font-size="12" font-family="Palatino, Songti SC, serif">${esc(tick(value))}</text>`
    const label = labels[i] || String(i + 1)
    body += `<text x="${cx.toFixed(1)}" y="${(y1 + 20).toFixed(1)}" text-anchor="middle" fill="#5c564c" font-size="11" font-family="Palatino, Songti SC, serif">${esc(fitLabel(label, 10))}</text>`
  })
  const caption = spec.caption || (spec.unit ? `单位：${spec.unit}` : '柱子的高度就是数值。')
  return frame(spec.title || '数值对比', `${body}`, caption)
}

/** 多曲线 / 散点折线：把几条函数或一组数据放在同一张图里。 */
function seriesSvg(spec) {
  // 曲线之间允许用逗号分隔（表达式语言里没有多参数函数，所以逗号是安全的）。
  const curves = String(spec.curves ?? '')
    .split(/[|｜\n;；]/)
    .flatMap((chunk) => chunk.split(/[,，]/))
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4)
  const dataRows = String(spec.data ?? '')
    .split(/[\n;；]+/)
    .map((row) => row.split(/[,\s]+/).map(Number).filter(Number.isFinite))
    .filter((row) => row.length >= 2)
    .slice(0, 60)
  if (!curves.length && !dataRows.length) throw new Error('series 需要 curves（如 "sin(x),cos(x)"）或 data（如 "1,2;2,5"）')
  const xMin = num(spec.xMin, dataRows.length ? Math.min(...dataRows.map((r) => r[0])) : -4)
  const xMax = num(spec.xMax, dataRows.length ? Math.max(...dataRows.map((r) => r[0])) : 4)
  if (!(xMax > xMin)) throw new Error('xMax 必须大于 xMin')
  const collected = []
  const seriesDefs = curves.map((expr, i) => {
    const fn = compileExpr(expr)
    const pts = sampleExpr(fn, xMin, xMax, 200)
    collected.push(...pts)
    return { name: expr, pts, color: PALETTE[i % PALETTE.length] }
  })
  if (dataRows.length) {
    const pts = dataRows.map(([x, y]) => ({ x, y }))
    collected.push(...pts)
    seriesDefs.push({ name: spec.label || '数据', pts, color: PALETTE[(seriesDefs.length) % PALETTE.length], dots: true })
  }
  const { yMin, yMax } = boundsY(collected)
  const g = axes(xMin, xMax, yMin, yMax)
  let body = g.grid
  for (const series of seriesDefs) {
    const d = pathFrom(series.pts, g.X, g.Y)
    body += `<path d="${d}" fill="none" stroke="${series.color}" stroke-width="2.2" stroke-linejoin="round"/>`
    if (series.dots) {
      for (const p of series.pts) {
        body += `<circle cx="${g.X(p.x).toFixed(1)}" cy="${g.Y(p.y).toFixed(1)}" r="3.2" fill="${series.color}"/>`
      }
    }
  }
  let legend = ''
  seriesDefs.forEach((series, i) => {
    const y = 44 + i * 16
    legend += `<line x1="${W - 180}" y1="${y}" x2="${W - 160}" y2="${y}" stroke="${series.color}" stroke-width="2.4"/>`
    legend += `<text x="${W - 154}" y="${y + 4}" fill="#1b2330" font-size="11" font-family="Palatino, Songti SC, serif">${esc(fitLabel(series.name, 14))}</text>`
  })
  return frame(spec.title || '曲线对照', `${body}${legend}`, spec.caption || '看趋势、看交点，不要只看某一个点。')
}

/** 表格：并列对照。 */
function tableSvg(spec) {
  const headers = list(spec.headers, 5)
  const rows = String(spec.rows ?? '')
    .split(/\n|;;/)
    .map((row) => row.split(/[|｜]/).map((cell) => cell.trim()))
    .filter((cells) => cells.some(Boolean))
    .slice(0, 8)
  if (!headers.length && !rows.length) throw new Error('table 需要 headers（如 "概念|定义|例子"）和 rows（每行用 | 分隔）')
  const cols = Math.max(headers.length, ...rows.map((r) => r.length), 1)
  const x0 = 24
  const x1 = W - 24
  const top = 64
  const colW = (x1 - x0) / cols
  const rowH = Math.min(46, (H - top - 46) / (rows.length + 1))
  let body = ''
  for (let c = 0; c <= cols; c += 1) {
    const x = x0 + c * colW
    body += `<line x1="${x.toFixed(1)}" y1="${top}" x2="${x.toFixed(1)}" y2="${(top + rowH * (rows.length + 1)).toFixed(1)}" stroke="#d8cfbd" stroke-width="1"/>`
  }
  body += `<rect x="${x0}" y="${top}" width="${(x1 - x0).toFixed(1)}" height="${rowH.toFixed(1)}" fill="#1b2330"/>`
  headers.forEach((header, c) => {
    body += `<text x="${(x0 + c * colW + 8).toFixed(1)}" y="${(top + rowH * 0.66).toFixed(1)}" fill="#f7f3ea" font-size="12" font-family="Palatino, Songti SC, serif">${esc(fitLabel(header, Math.max(4, Math.floor(colW / 13))))}</text>`
  })
  rows.forEach((cells, r) => {
    const y = top + rowH * (r + 1)
    if (r % 2 === 1) body += `<rect x="${x0}" y="${y.toFixed(1)}" width="${(x1 - x0).toFixed(1)}" height="${rowH.toFixed(1)}" fill="#efe8d9"/>`
    body += `<line x1="${x0}" y1="${y.toFixed(1)}" x2="${x1}" y2="${y.toFixed(1)}" stroke="#d8cfbd" stroke-width="1"/>`
    cells.slice(0, cols).forEach((cell, c) => {
      body += `<text x="${(x0 + c * colW + 8).toFixed(1)}" y="${(y + rowH * 0.66).toFixed(1)}" fill="#1b2330" font-size="12" font-family="Palatino, Songti SC, serif">${esc(fitLabel(cell, Math.max(4, Math.floor(colW / 13))))}</text>`
    })
  })
  body += `<line x1="${x0}" y1="${(top + rowH * (rows.length + 1)).toFixed(1)}" x2="${x1}" y2="${(top + rowH * (rows.length + 1)).toFixed(1)}" stroke="#d8cfbd" stroke-width="1"/>`
  return frame(spec.title || '对照表', body, spec.caption || '一次只比一列，比完再换。')
}

/** 结构树：用 "根>子>孙|根>子2" 表达层级。 */
function treeSvg(spec) {
  const paths = list(spec.tree, 14)
  if (!paths.length) throw new Error('tree 需要 tree，例如 "力学>升力>压力差|力学>阻力"')
  const nodes = []
  const edges = []
  const index = new Map()
  for (const raw of paths) {
    const parts = raw.split(/[>＞]/).map((s) => s.trim()).filter(Boolean).slice(0, 4)
    let parent = null
    for (const label of parts) {
      const key = `${parent ? parent.key : ''}/${label}`
      if (!index.has(key)) {
        const node = { key, label, depth: parts.indexOf(label), parent }
        nodes.push(node)
        index.set(key, node)
        if (parent) edges.push([parent, node])
      }
      parent = index.get(key)
    }
  }
  if (!nodes.length) throw new Error('tree 内容为空')
  const depthMax = Math.max(...nodes.map((node) => node.depth))
  const colW = (W - 60) / (depthMax + 1)
  const byDepth = new Map()
  for (const node of nodes) {
    if (!byDepth.has(node.depth)) byDepth.set(node.depth, [])
    byDepth.get(node.depth).push(node)
  }
  let body = ''
  for (const [depth, group] of byDepth) {
    group.forEach((node, i) => {
      node.x = 30 + depth * colW + colW / 2
      node.y = 70 + ((i + 1) / (group.length + 1)) * (H - 150)
    })
  }
  for (const [parent, child] of edges) {
    const midX = (parent.x + child.x) / 2
    body += `<path d="M${parent.x.toFixed(1)} ${parent.y.toFixed(1)} C${midX.toFixed(1)} ${parent.y.toFixed(1)} ${midX.toFixed(1)} ${child.y.toFixed(1)} ${child.x.toFixed(1)} ${child.y.toFixed(1)}" fill="none" stroke="#b7ac97" stroke-width="1.4"/>`
  }
  for (const node of nodes) {
    const w = Math.min(colW - 16, 132)
    const h = 34
    const fill = node.depth === 0 ? '#1b2330' : '#fffaf3'
    const color = node.depth === 0 ? '#f7f3ea' : '#1b2330'
    body += `<rect x="${(node.x - w / 2).toFixed(1)}" y="${(node.y - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h}" rx="6" fill="${fill}" stroke="#1b2330"/>`
    body += `<text x="${node.x.toFixed(1)}" y="${(node.y + 5).toFixed(1)}" text-anchor="middle" fill="${color}" font-size="12" font-family="Palatino, Songti SC, serif">${esc(fitLabel(node.label, 9))}</text>`
  }
  return frame(spec.title || '结构图', body, spec.caption || '只展开当前这一层。')
}

/** 时间线：按顺序看因果。 */
function timelineSvg(spec) {
  const events = list(spec.events, 6)
  if (!events.length) throw new Error('timeline 需要 events，例如 "1950:提出假设|1970:实验验证"')
  const x0 = 60
  const x1 = W - 40
  const y = H / 2
  const gap = events.length > 1 ? (x1 - x0) / (events.length - 1) : 0
  let body = `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="#1b2330" stroke-width="1.6"/>`
  events.forEach((raw, i) => {
    const [when, ...rest] = raw.split(/[:：]/)
    const text = rest.join('：').trim() || when
    const cx = x0 + gap * i
    const up = i % 2 === 0
    body += `<circle cx="${cx.toFixed(1)}" cy="${y}" r="6" fill="#c23b22"/>`
    body += `<line x1="${cx.toFixed(1)}" y1="${y}" x2="${cx.toFixed(1)}" y2="${(up ? y - 28 : y + 28).toFixed(1)}" stroke="#c23b22" stroke-width="1.2"/>`
    body += `<text x="${cx.toFixed(1)}" y="${(up ? y - 38 : y + 48).toFixed(1)}" text-anchor="middle" fill="#1b2330" font-size="12" font-family="Palatino, Songti SC, serif">${esc(fitLabel(text, 12))}</text>`
    body += `<text x="${cx.toFixed(1)}" y="${(up ? y + 22 : y - 18).toFixed(1)}" text-anchor="middle" fill="#5c564c" font-size="11" font-family="Palatino, Songti SC, serif">${esc(fitLabel(String(when).trim() === text ? '' : when, 12))}</text>`
  })
  return frame(spec.title || '时间线', body, spec.caption || '先后顺序比年份数字更重要。')
}

/** 代码执行追踪：左边代码，右边这一步发生了什么。 */
function codeSvg(spec) {
  const code = String(spec.code ?? '').split('\n').slice(0, 14)
  if (!code.filter((line) => line.trim()).length) throw new Error('code 需要 code（多行代码文本）')
  const notes = new Map()
  for (const raw of String(spec.trace ?? '').split(/[|｜\n;；]/)) {
    const [lineNo, ...rest] = raw.split(/[:：]/)
    const n = Number(lineNo)
    if (Number.isFinite(n) && rest.length) notes.set(n, rest.join('：').trim())
  }
  const lh = Math.min(26, (H - 90) / code.length)
  const top = 64
  const codeX = 28
  const noteX = 330
  let body = `<rect x="${codeX - 8}" y="${top - 18}" width="${W - 40}" height="${(lh * code.length + 26).toFixed(1)}" fill="#fffaf3" stroke="#d8cfbd"/>`
  code.forEach((line, i) => {
    const y = top + i * lh
    const hasNote = notes.has(i + 1)
    if (hasNote) body += `<rect x="${codeX - 8}" y="${(y - 13).toFixed(1)}" width="${W - 40}" height="${lh.toFixed(1)}" fill="#c23b22" fill-opacity="0.08"/>`
    body += `<text x="${codeX + 16}" y="${y.toFixed(1)}" text-anchor="end" fill="#8a8272" font-size="11" font-family="monospace">${i + 1}</text>`
    body += `<text x="${codeX + 26}" y="${y.toFixed(1)}" fill="#1b2330" font-size="12" font-family="monospace">${esc(fitLabel(line.replace(/\t/g, '  '), 30))}</text>`
    if (hasNote) {
      body += `<text x="${noteX}" y="${y.toFixed(1)}" fill="#c23b22" font-size="11" font-family="Palatino, Songti SC, serif">${esc(fitLabel(notes.get(i + 1), 30))}</text>`
    }
  })
  return frame(spec.title || '执行追踪', body, spec.caption || '一行一行对，不跳步。')
}
