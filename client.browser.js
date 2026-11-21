/* TutorFlow 浏览器端。普通脚本：注册一个工厂，不访问网络、不加载外部资源。 */
window.__ModuleLoader__.load({
  id: 'dsh-tutorflow',
  factory: function (require) {
    var React = require('react')
    var h = React.createElement

    /* ---- 本地表达式：不 eval，只认一个小文法 ---- */
    var FUNCS = {
      sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp,
      ln: Math.log, log: Math.log, sqrt: Math.sqrt, abs: Math.abs,
    }

    function compile(source) {
      var src = String(source || '').trim()
      if (!src) throw new Error('表达式是空的')
      if (src.length > 120) throw new Error('表达式太长')
      var i = 0
      function peek() { return src[i] }
      function skip() { while (src[i] === ' ') i++ }
      function expr() {
        var node = term()
        skip()
        while (peek() === '+' || peek() === '-') {
          var op = src[i++]; var left = node; var right = term()
          node = (function (l, r, o) { return function (x) { return o === '+' ? l(x) + r(x) : l(x) - r(x) } })(left, right, op)
        }
        return node
      }
      function term() {
        var node = power()
        skip()
        while (peek() === '*' || peek() === '/') {
          var op = src[i++]; var left = node; var right = power()
          node = (function (l, r, o) { return function (x) { return o === '*' ? l(x) * r(x) : l(x) / r(x) } })(left, right, op)
        }
        return node
      }
      function power() {
        var node = unary()
        skip()
        if (peek() === '^') {
          i++; var left = node; var right = unary()
          node = (function (l, r) { return function (x) { return Math.pow(l(x), r(x)) } })(left, right)
        }
        return node
      }
      function unary() {
        skip()
        if (peek() === '-') { i++; var inner = unary(); return function (x) { return -inner(x) } }
        if (peek() === '+') { i++; return unary() }
        return primary()
      }
      function primary() {
        skip()
        var c = peek()
        if (c === '(') {
          i++; var inner = expr(); skip()
          if (peek() !== ')') throw new Error('缺少右括号')
          i++; return inner
        }
        if ((c >= '0' && c <= '9') || c === '.') {
          var start = i; i++
          while ((src[i] >= '0' && src[i] <= '9') || src[i] === '.') i++
          var n = Number(src.slice(start, i))
          if (!isFinite(n)) throw new Error('数字写错了')
          return function () { return n }
        }
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
          var s2 = i; i++
          while ((src[i] >= 'a' && src[i] <= 'z') || (src[i] >= 'A' && src[i] <= 'Z')) i++
          var name = src.slice(s2, i).toLowerCase()
          skip()
          if (peek() === '(') {
            var fn = FUNCS[name]
            if (!fn) throw new Error('不支持的函数 ' + name)
            i++; var arg = expr(); skip()
            if (peek() !== ')') throw new Error('函数缺少右括号')
            i++
            return (function (f, a) { return function (x) { return f(a(x)) } })(fn, arg)
          }
          if (name === 'x') return function (x) { return x }
          if (name === 'pi') return function () { return Math.PI }
          if (name === 'e') return function () { return Math.E }
          throw new Error('不认识的符号 ' + name)
        }
        throw new Error('看不懂：' + src.slice(i, i + 10))
      }
      var fn = expr(); skip()
      if (i !== src.length) throw new Error('有多余内容：' + src.slice(i))
      return fn
    }

    /* ---- 本地 SVG：带坐标轴与自适应纵轴 ---- */
    var W = 560
    var H = 260
    var PAD = { l: 46, r: 14, t: 18, b: 32 }

    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    }

    function niceStep(span) {
      var raw = span / 5
      var pow = Math.pow(10, Math.floor(Math.log(Math.abs(raw) || 1) / Math.LN10))
      var n = raw / pow
      var m = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10
      return m * pow
    }

    function tick(n) {
      if (!isFinite(n)) return ''
      var a = Math.abs(n)
      if (a !== 0 && (a < 0.01 || a >= 10000)) return n.toExponential(1)
      return String(Math.round(n * 1000) / 1000)
    }

    function plot(fn, xMin, xMax, color, title) {
      var pts = []
      var yMin = Infinity
      var yMax = -Infinity
      var count = 200
      for (var k = 0; k < count; k++) {
        var x = xMin + (xMax - xMin) * (k / (count - 1))
        var y = fn(x)
        if (!isFinite(y)) { pts.push(null); continue }
        if (y < yMin) yMin = y
        if (y > yMax) yMax = y
        pts.push({ x: x, y: y })
      }
      if (!isFinite(yMin) || !isFinite(yMax)) throw new Error('这段区间上没有有效取值')
      if (yMin === yMax) { yMin -= 1; yMax += 1 }
      var padY = (yMax - yMin) * 0.12
      yMin -= padY; yMax += padY
      if (yMin > 0) yMin = 0
      if (yMax < 0) yMax = 0
      if (!(xMax > xMin)) throw new Error('右端必须大于左端')

      var x0 = PAD.l, x1 = W - PAD.r, y0 = PAD.t, y1 = H - PAD.b
      function X(x) { return x0 + ((x - xMin) / (xMax - xMin)) * (x1 - x0) }
      function Y(y) { return y1 - ((y - yMin) / (yMax - yMin)) * (y1 - y0) }

      var grid = ''
      var stepX = niceStep(xMax - xMin)
      for (var gx = Math.ceil(xMin / stepX) * stepX; gx <= xMax + 1e-9; gx += stepX) {
        grid += '<line x1="' + X(gx).toFixed(1) + '" y1="' + y0 + '" x2="' + X(gx).toFixed(1) + '" y2="' + y1 + '" stroke="#e4dccb"/>'
        grid += '<text x="' + X(gx).toFixed(1) + '" y="' + (y1 + 15) + '" text-anchor="middle" fill="#5c564c" font-size="10" font-family="Palatino, serif">' + tick(gx) + '</text>'
      }
      var stepY = niceStep(yMax - yMin)
      for (var gy = Math.ceil(yMin / stepY) * stepY; gy <= yMax + 1e-9; gy += stepY) {
        grid += '<line x1="' + x0 + '" y1="' + Y(gy).toFixed(1) + '" x2="' + x1 + '" y2="' + Y(gy).toFixed(1) + '" stroke="#e4dccb"/>'
        grid += '<text x="' + (x0 - 6) + '" y="' + (Y(gy) + 4).toFixed(1) + '" text-anchor="end" fill="#5c564c" font-size="10" font-family="Palatino, serif">' + tick(gy) + '</text>'
      }
      var zx = xMin <= 0 && xMax >= 0 ? X(0) : x0
      var zy = yMin <= 0 && yMax >= 0 ? Y(0) : y1
      grid += '<line x1="' + zx.toFixed(1) + '" y1="' + y0 + '" x2="' + zx.toFixed(1) + '" y2="' + y1 + '" stroke="#1b2330" stroke-width="1.1"/>'
      grid += '<line x1="' + x0 + '" y1="' + zy.toFixed(1) + '" x2="' + x1 + '" y2="' + zy.toFixed(1) + '" stroke="#1b2330" stroke-width="1.1"/>'

      var d = ''
      var pen = false
      for (var p = 0; p < pts.length; p++) {
        var pt = pts[p]
        if (!pt) { pen = false; continue }
        d += (pen ? 'L' : 'M') + X(pt.x).toFixed(1) + ' ' + Y(pt.y).toFixed(1) + ' '
        pen = true
      }
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(title || '') + '">' +
        '<rect width="' + W + '" height="' + H + '" fill="#f7f3ea"/>' +
        (title ? '<text x="12" y="14" fill="#1b2330" font-size="12" font-family="Palatino, Songti SC, serif">' + esc(title) + '</text>' : '') +
        grid +
        '<path d="' + d.trim() + '" fill="none" stroke="' + color + '" stroke-width="2"/>' +
        '</svg>'
    }

    function pdf(x, mu, sigma) {
      var z = (x - mu) / sigma
      return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI))
    }

    function btn() {
      return {
        font: 'inherit', fontSize: 12, padding: '2px 8px', border: '1px solid currentColor',
        background: 'transparent', color: 'inherit', cursor: 'pointer',
      }
    }

    function slider(label, value, min, max, step, set) {
      return h('label', { style: { display: 'grid', gridTemplateColumns: '52px 1fr 44px', gap: 8, fontSize: 12, alignItems: 'center', marginBottom: 5 } },
        label,
        h('input', { type: 'range', min: min, max: max, step: step, value: value, onChange: function (e) { set(Number(e.target.value)) } }),
        h('span', null, String(Math.round(value * 100) / 100)))
    }

    function Field(props) {
      return h('label', { style: { display: 'block', fontSize: 12, marginBottom: 6 } },
        props.label,
        h('input', {
          type: 'text', value: props.value, onChange: function (e) { props.set(e.target.value) },
          style: { display: 'block', width: '100%', marginTop: 3, padding: '3px 6px', fontSize: 12, fontFamily: 'monospace', border: '1px solid #1b2330', background: '#fffaf3', color: '#1b2330' },
        }))
    }

    function Panel(props) {
      var exprS = React.useState('exp(-x^2/2)')
      var minS = React.useState(-4)
      var maxS = React.useState(4)
      var muS = React.useState(0)
      var sigS = React.useState(1)
      var zoomS = React.useState(100)
      var aS = React.useState(-1)
      var bS = React.useState(1)

      var markup = ''
      var error = ''
      try {
        var fn = compile(exprS[0])
        markup = plot(fn, Math.min(minS[0], maxS[0] - 0.01), Math.max(maxS[0], minS[0] + 0.01), '#c23b22', 'y = ' + exprS[0])
      } catch (e) {
        error = String(e && e.message ? e.message : e)
      }

      var normal = ''
      try {
        normal = plot(function (x) { return pdf(x, muS[0], Math.max(0.2, sigS[0])) }, muS[0] - 4 * Math.max(0.2, sigS[0]), muS[0] + 4 * Math.max(0.2, sigS[0]), '#2a6a4b', '正态密度')
      } catch (e2) {
        normal = ''
      }

      return h('div', {
        style: {
          position: 'fixed', top: 64, right: 16, width: 'min(420px, calc(100vw - 24px))',
          maxHeight: '80vh', overflow: 'auto', zIndex: 30, background: '#f7f3ea', color: '#1b2330',
          border: '1px solid #1b2330', boxShadow: '4px 4px 0 #1b2330', padding: 16,
          fontFamily: 'Palatino, "Songti SC", serif',
        },
      },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } },
          h('strong', null, 'TutorFlow'),
          h('button', { type: 'button', onClick: props.onClose, style: btn() }, '关闭')),
        h('p', { style: { fontSize: 12.5, lineHeight: 1.6 } },
          '教学在对话里进行，用的是你已经配置好的模型。这里只做本地绘图，不联网、不另接模型。'),
        h('p', { style: { fontSize: 12, color: '#5c564c', lineHeight: 1.6 } },
          '对老师说「换成查漏补缺」可换姿态；说「查看学习进度」「开始复习」；说「画一张……」让老师画图。记录写在本机 DSH 目录的 dsh-tutorflow/state.json。'),

        h('h3', { style: { fontSize: 13, margin: '12px 0 6px' } }, '本地画一张函数图'),
        Field({ label: '表达式（变量 x）', value: exprS[0], set: exprS[1] }),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } },
          Field({ label: '左端', value: String(minS[0]), set: function (v) { minS[1](Number(v) || 0) } }),
          Field({ label: '右端', value: String(maxS[0]), set: function (v) { maxS[1](Number(v) || 0) } })),
        error
          ? h('p', { style: { fontSize: 12, color: '#c23b22' } }, '画不出来：' + error)
          : h('div', { style: { width: zoomS[0] + '%', maxWidth: '100%' }, dangerouslySetInnerHTML: { __html: markup } }),
        slider('缩放', zoomS[0], 70, 160, 1, zoomS[1]),

        h('h3', { style: { fontSize: 13, margin: '14px 0 6px' } }, '正态分布（原来的功能，保留）'),
        slider('均值', muS[0], -3, 3, 0.1, muS[1]),
        slider('标准差', sigS[0], 0.3, 3, 0.1, sigS[1]),
        normal ? h('div', { dangerouslySetInnerHTML: { __html: normal } }) : null,
        h('p', { style: { fontSize: 11.5, color: '#5c564c' } },
          '曲线下的面积才是概率；单点没有宽度，概率为 0。区间阴影请让老师在对话里画。'),

        h('h3', { style: { fontSize: 13, margin: '14px 0 6px' } }, '老师能画的图型'),
        h('p', { style: { fontSize: 12, lineHeight: 1.7 } },
          '函数曲线、正态密度与分布函数、积分区域、坐标、知识结构、流程图、离散连续对照、柱状对比、多曲线对照、表格、结构树、时间线、代码执行追踪。全部本地生成。'))
    }

    var ReactDOM = null
    try { ReactDOM = require('react-dom') } catch (e) { ReactDOM = null }

    function TutorButton() {
      var openS = React.useState(false)
      var open = openS[0]
      var setOpen = openS[1]
      var panel = open ? h(Panel, { onClose: function () { setOpen(false) } }) : null
      if (panel && ReactDOM && typeof ReactDOM.createPortal === 'function' && typeof document !== 'undefined') {
        panel = ReactDOM.createPortal(panel, document.body)
      }
      return h(React.Fragment, null,
        h('button', { type: 'button', onClick: function () { setOpen(!open) }, style: btn(), title: 'TutorFlow 教学' }, '教学'),
        panel)
    }

    return {
      name: 'tutorflow-client',
      inject: ['slots'],
      apply: function (ctx) {
        if (!ctx.slots || typeof ctx.slots.inject !== 'function') return
        ctx.slots.inject('conversation.session.header.actions', function () {
          ctx.slots.register({
            name: 'conversation.session.header.actions',
            id: 'tutorflow',
            order: 40,
          }, TutorButton)
        })
      },
    }
  },
})
