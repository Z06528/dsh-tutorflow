/**
 * Tiny safe math expression compiler.
 * No eval, no Function, no network. Variables: x. Constants: pi, e.
 * Functions: sin cos tan exp ln log sqrt abs.
 */

const FUNCS = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log,
  sqrt: Math.sqrt,
  abs: Math.abs,
}

export function compileExpr(source) {
  const src = String(source ?? '').trim()
  if (!src) throw new Error('表达式为空')
  if (src.length > 200) throw new Error('表达式过长')
  let i = 0
  const peek = () => src[i]
  const skip = () => { while (src[i] === ' ') i += 1 }
  function parseExpr() {
    let node = parseTerm()
    skip()
    while (peek() === '+' || peek() === '-') {
      const op = src[i++]
      const right = parseTerm()
      const left = node
      node = (x) => op === '+' ? left(x) + right(x) : left(x) - right(x)
    }
    return node
  }
  function parseTerm() {
    let node = parsePow()
    skip()
    while (peek() === '*' || peek() === '/') {
      const op = src[i++]
      const right = parsePow()
      const left = node
      node = (x) => op === '*' ? left(x) * right(x) : left(x) / right(x)
    }
    return node
  }
  function parsePow() {
    let node = parseUnary()
    skip()
    if (peek() === '^') {
      i += 1
      const right = parseUnary()
      const left = node
      node = (x) => Math.pow(left(x), right(x))
    }
    return node
  }
  function parseUnary() {
    skip()
    if (peek() === '-') {
      i += 1
      const inner = parseUnary()
      return (x) => -inner(x)
    }
    if (peek() === '+') { i += 1; return parseUnary() }
    return parsePrimary()
  }
  function parsePrimary() {
    skip()
    const c = peek()
    if (c === '(') {
      i += 1
      const inner = parseExpr()
      skip()
      if (peek() !== ')') throw new Error('缺少右括号')
      i += 1
      return inner
    }
    if (c >= '0' && c <= '9' || c === '.') {
      const start = i
      i += 1
      while ((src[i] >= '0' && src[i] <= '9') || src[i] === '.') i += 1
      const n = Number(src.slice(start, i))
      if (!Number.isFinite(n)) throw new Error('非法数字')
      return () => n
    }
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
      const start = i
      i += 1
      while ((src[i] >= 'a' && src[i] <= 'z') || (src[i] >= 'A' && src[i] <= 'Z')) i += 1
      const name = src.slice(start, i).toLowerCase()
      skip()
      if (peek() === '(') {
        const fn = FUNCS[name]
        if (!fn) throw new Error(`不支持的函数 ${name}`)
        i += 1
        const arg = parseExpr()
        skip()
        if (peek() !== ')') throw new Error('函数缺少右括号')
        i += 1
        return (x) => fn(arg(x))
      }
      if (name === 'x') return (x) => x
      if (name === 'pi') return () => Math.PI
      if (name === 'e') return () => Math.E
      throw new Error(`未知符号 ${name}`)
    }
    throw new Error(`无法解析：${src.slice(i, i + 12)}`)
  }
  const fn = parseExpr()
  skip()
  if (i !== src.length) throw new Error(`表达式有多余内容：${src.slice(i)}`)
  const probe = fn(0.25)
  if (typeof probe !== 'number') throw new Error('表达式没有返回数值')
  return fn
}

export function sampleExpr(fn, xMin, xMax, n = 160) {
  const count = Math.max(16, Math.min(400, n))
  const pts = []
  for (let k = 0; k < count; k += 1) {
    const x = xMin + (xMax - xMin) * (k / (count - 1))
    const y = fn(x)
    pts.push({ x, y: Number.isFinite(y) ? y : null })
  }
  return pts
}
