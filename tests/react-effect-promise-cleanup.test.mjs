import assert from 'node:assert/strict'
import fs from 'node:fs'

/**
 * Regressão financeira: /financeiro/fluxo-de-caixa e /financeiro/cobrancas caíam no
 * AppErrorBoundary ("Não foi possível carregar esta página.").
 *
 * Causa: `useEffect(load, [])` onde `load` devolve uma Promise (`.then().catch()`).
 * O React 19 guarda o retorno do efeito como função de cleanup; ao DESMONTAR o
 * componente (navegar para outra rota) ele executa `destroy()` — e `destroy` é a
 * Promise. Resultado: `TypeError: destroy is not a function` durante o commit de
 * unmount, capturado pelo AppErrorBoundary → a aplicação inteira quebra.
 *
 * Correção: `useEffect(() => { load() }, [])`.
 *
 * Este teste:
 *  1. reproduz o comportamento do React (mount + unmount de um filho, com um error
 *     boundary montado acima) para os dois padrões;
 *  2. trava por contrato que os componentes financeiros afetados não voltem ao
 *     padrão perigoso.
 */

// ---------------------------------------------------------------------------
// 1) Comportamento real do React 19 — shim de DOM mínimo (sem framework nova).
// ---------------------------------------------------------------------------
class DomNode {
  constructor(name) { this.nodeName = name; this.childNodes = []; this.parentNode = null; this.style = new Proxy({}, { get: () => '', set: () => true }) }
  get ownerDocument() { return doc }
  get firstChild() { return this.childNodes[0] || null }
  get nextSibling() { const p = this.parentNode; if (!p) return null; const i = p.childNodes.indexOf(this); return p.childNodes[i + 1] || null }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.childNodes.push(c); return c }
  insertBefore(c, r) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; const i = r ? this.childNodes.indexOf(r) : -1; i < 0 ? this.childNodes.push(c) : this.childNodes.splice(i, 0, c); return c }
  removeChild(c) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c }
  setAttribute() {} removeAttribute() {} getAttribute() { return null }
  addEventListener() {} removeEventListener() {} contains() { return false }
  set textContent(v) { this.childNodes = []; if (v != null && v !== '') this.appendChild(doc.createTextNode(String(v))) }
  get textContent() { return this.childNodes.map((c) => c.data ?? c.textContent).join('') }
  focus() {}
  get isConnected() { let n = this; while (n) { if (n === doc.documentElement) return true; n = n.parentNode } return false }
}
class DomText extends DomNode { constructor(d) { super('#text'); this.data = d } get nodeType() { return 3 } }
class DomElement extends DomNode { constructor(t) { super(String(t).toUpperCase()); this.tagName = String(t).toUpperCase(); this.namespaceURI = 'http://www.w3.org/1999/xhtml' } get nodeType() { return 1 } get children() { return this.childNodes.filter((c) => c.nodeType === 1) } }
const doc = {
  nodeType: 9, createElement: (t) => new DomElement(t), createElementNS: (_n, t) => new DomElement(t),
  createTextNode: (d) => new DomText(d), createComment: () => new DomText(''), createDocumentFragment: () => new DomNode('#f'),
  addEventListener() {}, removeEventListener() {}, activeElement: null, visibilityState: 'visible',
  querySelector: () => null, querySelectorAll: () => [],
}
doc.documentElement = new DomElement('html'); doc.body = new DomElement('body'); doc.documentElement.appendChild(doc.body)
class HTMLIFrameElement extends DomElement {}
const win = {
  location: { pathname: '/' }, history: { pushState() {} }, addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  requestAnimationFrame: (fn) => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout, HTMLIFrameElement,
}
win.window = win; win.document = doc; doc.defaultView = win
globalThis.window = win; globalThis.document = doc
globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return [] } }
globalThis.HTMLIFrameElement = HTMLIFrameElement
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { useState, useEffect } = React
const ReactDOM = await import('react-dom/client')
const flush = () => new Promise((r) => setTimeout(r, 20))
const silence = console.error
console.error = () => {}

let boundaryError = null
class Boundary extends React.Component {
  constructor(p) { super(p); this.state = {} }
  static getDerivedStateFromError(e) { return { e } }
  componentDidCatch(e) { boundaryError = e }
  render() { return this.state.e ? React.createElement('div', null, 'boundary') : this.props.children }
}

const mountThenUnmountChild = async (Child) => {
  boundaryError = null
  const container = new DomElement('div'); doc.body.appendChild(container)
  const root = ReactDOM.createRoot(container)
  let toggle
  function Host() { const [show, set] = useState(true); toggle = set; return show ? React.createElement(Child) : React.createElement('div', null, 'gone') }
  root.render(React.createElement(Boundary, null, React.createElement(Host)))
  await flush()
  const mountError = boundaryError; boundaryError = null
  toggle(false) // desmonta apenas o filho — o Boundary continua montado (como o AppErrorBoundary real)
  await flush()
  root.unmount()
  return { mountError, unmountError: boundaryError }
}

function DangerousEffect() {
  const [x, setX] = useState(0)
  const load = () => Promise.resolve().then(() => setX(1))
  useEffect(load, []) // <- padrão que quebrava
  return React.createElement('div', null, x)
}
function SafeEffect() {
  const [x, setX] = useState(0)
  const load = () => Promise.resolve().then(() => setX(1))
  useEffect(() => { load() }, []) // <- correção
  return React.createElement('div', null, x)
}

const dangerous = await mountThenUnmountChild(DangerousEffect)
assert.equal(dangerous.mountError, null, 'o padrão perigoso monta normalmente')
assert.ok(dangerous.unmountError, 'useEffect(load,[]) com load que devolve Promise DEVE quebrar ao desmontar')
assert.match(String(dangerous.unmountError.message), /destroy is not a function/, 'a exceção é "destroy is not a function"')

const safe = await mountThenUnmountChild(SafeEffect)
assert.equal(safe.mountError, null, 'a correção monta normalmente')
assert.equal(safe.unmountError, null, 'useEffect(() => { load() }, []) NÃO quebra ao desmontar')

console.error = silence

// ---------------------------------------------------------------------------
// 2) Contrato de código — os componentes financeiros afetados não podem voltar
//    a passar uma função-que-devolve-Promise direto para useEffect.
// ---------------------------------------------------------------------------
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
for (const file of [
  '../src/components/FinanceV2Pages.jsx',
  '../src/components/FinancialProductionPages.jsx',
  '../src/components/FinancialSettingsPage.jsx',
  '../src/components/ClientsPage.jsx',
]) {
  const src = read(file)
  // proibido: useEffect(load, ...) / useEffect(reload, ...) / useEffect(<qualquer identificador>, ...)
  assert.doesNotMatch(src, /useEffect\(\s*(load|reload|refresh|fetchData)\s*,/, `${file}: useEffect não pode receber a função de carga diretamente (ela devolve Promise)`)
  // cada `const load = () => ...Promise...` deve ser chamado dentro de um efeito com corpo em bloco
  if (/const load\s*=\s*\(\)\s*=>/.test(src)) {
    assert.match(src, /useEffect\(\s*\(\)\s*=>\s*\{[^}]*\bload\(\)/s, `${file}: load() deve ser chamado dentro de useEffect(() => { ... })`)
  }
}

console.log('React effect Promise cleanup: OK')
