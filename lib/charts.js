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
