import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// Templates com variáveis NOMEADAS ({{nome}}): a Meta exige parameter_name em cada parâmetro.
const edge = fs.readFileSync(new URL('../supabase/functions/mugozap-api/index.ts', import.meta.url), 'utf8')
const grab = (name) => {
  const start = edge.indexOf(`const ${name} =`)
  assert.ok(start >= 0, name)
  const end = edge.indexOf('\nconst ', start + 10)
  return edge.slice(start, end).replace(/: any|: unknown|: string|: number/g, '')
}
const source = ['text', 'metaStatus', 'templateVariables', 'metaTemplateComponents'].map(grab).join('\n')
const lib = new Function(`${source}\nreturn { templateVariables, metaTemplateComponents }`)()

test('parameter_name chega à Meta quando é um nome válido; posicional continua igual', () => {
  const out = lib.metaTemplateComponents([{ type: 'body', parameters: [{ type: 'text', parameter_name: 'nome', text: 'Ana' }, { type: 'text', text: 'Roove' }] }])
  assert.deepEqual(out[0].parameters, [{ type: 'text', parameter_name: 'nome', text: 'Ana' }, { type: 'text', text: 'Roove' }])
  const bad = lib.metaTemplateComponents([{ type: 'body', parameters: [{ type: 'text', parameter_name: 'Nome Errado', text: 'Ana' }] }])
  assert.deepEqual(bad[0].parameters, [{ type: 'text', text: 'Ana' }])
})

test('conta variáveis nomeadas para conferir se todas vieram', () => {
  assert.equal(lib.templateVariables({ text: 'Olá, {{nome}}! {{quantidade}} da {{marca}}, {{nome}}' }), 3)
  assert.equal(lib.templateVariables({ text: 'Olá, {{1}} e {{2}}' }), 2)
})
