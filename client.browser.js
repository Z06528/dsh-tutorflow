/* TutorFlow browser half. Classic script: registers a factory, does not touch the network. */
window.__ModuleLoader__.load({
  id: 'dsh-tutorflow',
  factory: function (require) {
    var React = require('react')
    var h = React.createElement

    function pdf(x, mu, sigma) {
      var z = (x - mu) / sigma
      return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI))
    }

    function curve(mu, sigma, from, to) {
      var x0 = mu - 4 * sigma
      var x1 = mu + 4 * sigma
      var pts = []
      var peak = 0
      for (var i = 0; i <= 80; i++) {
        var x = x0 + (x1 - x0) * (i / 80)
        var y = pdf(x, mu, sigma)
        if (y > peak) peak = y
        pts.push({ x: x, y: y })
      }
      var left = 36
      var right = 520
      var top = 20
      var bottom = 168
      function X(x) { return left + (x - x0) / (x1 - x0) * (right - left) }
      function Y(y) { return bottom - (y / (peak * 1.15 || 1)) * (bottom - top) }
      var d = pts.map(function (p, i) {
        return (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1)
      }).join(' ')
      var shade = ''
      if (from < to) {
        var sp = pts.filter(function (p) { return p.x >= from && p.x <= to })
        if (sp.length) {
          var sd = sp.map(function (p, i) {
            return (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1)
          }).join(' ')
          shade = '<path d="' + sd + ' L' + X(sp[sp.length - 1].x).toFixed(1) + ' ' + bottom + ' L' + X(sp[0].x).toFixed(1) + ' ' + bottom + ' Z" fill="#2a6a4b" fill-opacity="0.22"/>'
        }
      }
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 190" width="100%">' +
        '<rect width="540" height="190" fill="#f7f3ea"/>' +
        '<line x1="36" y1="168" x2="520" y2="168" stroke="#1b2330"/>' +
        shade +
        '<path d="' + d + '" fill="none" stroke="#c23b22" stroke-width="2"/>' +
        '</svg>'
    }

    function Panel(props) {
      var muS = React.useState(0)
      var sigS = React.useState(1)
      var zoomS = React.useState(100)
      var aS = React.useState(-1)
      var bS = React.useState(1)
      var mu = muS[0]
      var sigma = Math.max(0.2, sigS[0])
      var markup = curve(mu, sigma, aS[0], bS[0])
      return h('div', {
        style: {
          position: 'fixed', top: 64, right: 16, width: 'min(400px, calc(100vw - 24px))',
          maxHeight: '78vh', overflow: 'auto', zIndex: 30, background: '#f7f3ea', color: '#1b2330',
          border: '1px solid #1b2330', boxShadow: '4px 4px 0 #1b2330', padding: 16,
          fontFamily: 'Palatino, "Songti SC", serif',
        },
      },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } },
          h('strong', null, 'TutorFlow'),
          h('button', { type: 'button', onClick: props.onClose, style: btn() }, '关闭')),
        h('p', { style: { fontSize: 13, lineHeight: 1.55 } }, '教学在当前对话里进行，用的是你已经配置的模型。这里只放本地图和进度说明，不另接模型。'),
        h('p', { style: { fontSize: 13 } }, '五种模式：循序渐进、考题攻坚、查漏补缺、快速讲解、自主探索。对老师说「换成查漏补缺」即可切换。'),
        h('p', { style: { fontSize: 13 } }, '进度写在本机 DSH 目录的 dsh-tutorflow/state.json。对话里说「查看学习进度」或「清除学习记录」。'),
        h('h3', { style: { fontSize: 14, margin: '12px 0 6px' } }, '正态分布（本地绘制，可缩放）'),
        slider('均值', mu, -3, 3, 0.1, muS[1]),
        slider('标准差', sigS[0], 0.3, 3, 0.1, sigS[1]),
        slider('阴影左', aS[0], -4, 4, 0.1, aS[1]),
        slider('阴影右', bS[0], -4, 4, 0.1, bS[1]),
        slider('缩放', zoomS[0], 70, 160, 1, zoomS[1]),
        h('div', { style: { width: zoomS[0] + '%', maxWidth: '100%' }, dangerouslySetInnerHTML: { __html: markup } }),
        h('p', { style: { fontSize: 12, color: '#5c564c' } }, '阴影是区间上的面积。把阴影收成一个点，面积会消失。'))
    }

    function slider(label, value, min, max, step, set) {
      return h('label', { style: { display: 'grid', gridTemplateColumns: '64px 1fr 48px', gap: 8, fontSize: 12, alignItems: 'center', marginBottom: 6 } },
        label,
        h('input', { type: 'range', min: min, max: max, step: step, value: value, onChange: function (e) { set(Number(e.target.value)) } }),
        h('span', null, String(Math.round(value * 10) / 10)))
    }

    function btn() {
      return {
        font: 'inherit', fontSize: 12, padding: '2px 8px', border: '1px solid currentColor',
        background: 'transparent', color: 'inherit', cursor: 'pointer',
      }
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
