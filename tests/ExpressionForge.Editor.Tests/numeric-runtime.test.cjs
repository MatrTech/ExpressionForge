'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'examples/project-catalog.json'), 'utf8'));
const original = JSON.parse(fs.readFileSync(path.join(root, 'examples/project-query.json'), 'utf8')).definition;
const editor = require('../../src/ExpressionForge.Api/wwwroot/graph-edit.js');
const graph = require('../../src/ExpressionForge.Api/wwwroot/graph-model.js');
const preview = require('../../src/ExpressionForge.Api/wwwroot/graph-preview.js');
require('../../src/ExpressionForge.Api/wwwroot/parameter-utils.js');
const parameters = globalThis.ExpressionForgeParameters;

const add = () => editor.append(original, catalog, '$.query', { kind: 'arithmeticComparison' });
const address = '$.query.expressions[3]';

test('numeric operands support safe division and parameter source switching', () => {
  const first = add();
  const divided = editor.change(first, catalog, address, { kind: 'numericOperator', value: 'divide' });
  const parameterized = editor.change(divided, catalog, address, { kind: 'numericOperandMode', value: 'parameter' });
  const expression = parameterized.query.expressions[3];
  assert.equal(expression.left.operator, 'divide');
  assert.equal(expression.left.right.type, 'numericParameter');
  assert.match(expression.left.right.parameter, /^numeric\d+$/);
  assert.equal(first.query.expressions[3].left.operator, 'subtract');
  assert.deepEqual(graph.toDefinition(graph.project(parameterized, catalog)), parameterized);
  assert.match(preview.description({ kind: 'arithmeticComparison', data: expression }), /divide @numeric/);
});

test('numeric parameters are discoverable in the existing editor binding panel', () => {
  let query = editor.change(add(), catalog, address, { kind: 'numericOperandMode', value: 'parameter' });
  query = editor.change(query, catalog, address, { kind: 'numericThresholdMode', value: 'parameter' });
  const found = parameters.discover(query, catalog).filter(x => x.numeric);
  assert.equal(found.length, 2);
  assert.ok(found.every(x => x.dataType === 'decimal' && x.validName && !x.conflict));
  const names = found.map(x => x.name);
  assert.notEqual(names[0], names[1]);
  const bindings = parameters.buildBindings(found, Object.fromEntries(names.map((name, i) => [name, i ? '20.5' : '0'])));
  assert.deepEqual(bindings, { [names[0]]: 0, [names[1]]: 20.5 });
});

test('numeric parameter names are editable and invalid ones are rejected without mutating state', () => {
  const query = editor.change(add(), catalog, address, { kind: 'numericOperandMode', value: 'parameter' });
  const changed = editor.change(query, catalog, address, { kind: 'numericOperandParameter', value: 'divisor' });
  assert.equal(changed.query.expressions[3].left.right.parameter, 'divisor');
  assert.throws(() => editor.change(query, catalog, address, { kind: 'numericOperandParameter', value: 'bad name' }),
    /1–64/);
  assert.equal(query.query.expressions[3].left.right.parameter, 'numeric1');
  assert.throws(() => editor.change(query, catalog, address, { kind: 'numericOperand', value: 0 }), /Switch back/);
});

test('runtime bindings validate allowed numeric range and precision', () => {
  const query = editor.change(add(), catalog, address, { kind: 'numericThresholdMode', value: 'parameter' });
  const [definition] = parameters.discover(query, catalog).filter(x => x.numeric);
  for (const invalid of ['1.1234567', '1000000000001', '-1000000000001', 'wat']) {
    assert.throws(() => parameters.buildBindings([definition], { [definition.name]: invalid }));
  }
  assert.deepEqual(parameters.buildBindings([definition], { [definition.name]: '-1.123456' }),
    { [definition.name]: -1.123456 });
});

test('numeric bindings conflict with reused integer comparison parameter names', () => {
  const query = editor.change(add(), catalog, address, { kind: 'numericOperandMode', value: 'parameter' });
  query.query.expressions.push({ type: 'expression', field: 'Id', operator: 'equals', parameter: 'numeric1' });
  const definitions = parameters.discover(query, catalog);
  assert.equal(definitions.find(x => x.name === 'numeric1').conflict, true);
  assert.throws(() => parameters.buildBindings(definitions, { numeric1: '2' }), /incompatible/);
});

test('scoped numeric parameters support nested Task collection value trees', () => {
  const path = '$.query.expressions[2].expression';
  let query = editor.append(original, catalog, path, { kind: 'arithmeticComparison' });
  query = editor.change(query, catalog, path + '.expressions[2]',
    { kind: 'numericOperandMode', value: 'parameter' });
  const param = parameters.discover(query, catalog).find(x => x.numeric);
  assert.deepEqual(param.references, ['Task.numeric']);
  assert.deepEqual(graph.toDefinition(graph.project(query, catalog)), query);
});

test('numeric value switch back to fixed value removes runtime binding reference', () => {
  let query = editor.change(add(), catalog, address, { kind: 'numericOperandMode', value: 'parameter' });
  assert.equal(parameters.discover(query, catalog).filter(x => x.numeric).length, 1);
  query = editor.change(query, catalog, address, { kind: 'numericOperandMode', value: 'literal' });
  assert.equal(query.query.expressions[3].left.right.type, 'numericLiteral');
  assert.equal(parameters.discover(query, catalog).filter(x => x.numeric).length, 0);
});
