'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'examples/project-catalog.json'), 'utf8'));
const original = JSON.parse(fs.readFileSync(path.join(root, 'examples/project-query.json'), 'utf8')).definition;
const edit = require('../../src/ExpressionForge.Api/wwwroot/graph-edit.js');
const graph = require('../../src/ExpressionForge.Api/wwwroot/graph-model.js');
const preview = require('../../src/ExpressionForge.Api/wwwroot/graph-preview.js');

test('numeric arithmetic is offered only in metadata scopes with numeric fields', () => {
  assert.ok(edit.options(catalog, 'Project').some(x => x.kind === 'arithmeticComparison'));
  assert.ok(edit.options(catalog, 'Task').some(x => x.kind === 'arithmeticComparison'));
  assert.ok(!edit.options(catalog, 'Unknown').some(x => x.kind === 'arithmeticComparison'));
});

test('add a safe numeric calculation with a field, operation, operand and threshold', () => {
  const before = structuredClone(original);
  const result = edit.append(original, catalog, '$.query', { kind: 'arithmeticComparison' });
  const predicate = result.query.expressions.at(-1);
  assert.deepEqual(predicate, {
    type: 'arithmeticComparison',
    left: {
      type: 'numericBinary', operator: 'subtract',
      left: { type: 'numericField', field: 'Id' },
      right: { type: 'numericLiteral', value: 0 }
    },
    operator: 'greaterThan', right: { type: 'numericLiteral', value: 10 }
  });
  assert.deepEqual(graph.toDefinition(graph.project(result, catalog)), result);
  assert.deepEqual(original, before);
});

test('arithmetic editor can change operation, field, operand and threshold without mutating input', () => {
  const next = edit.append(original, catalog, '$.query', { kind: 'arithmeticComparison' });
  const pointer = '$.query.expressions[3]';
  const changed = edit.change(next, catalog, pointer, { kind: 'numericOperator', value: 'multiply' });
  const threshold = edit.change(changed, catalog, pointer, { kind: 'numericThreshold', value: 2500.125 });
  const source = edit.change(threshold, catalog, pointer, { kind: 'numericField', value: 'Budget' });
  assert.equal(source.query.expressions[3].left.operator, 'multiply');
  assert.equal(source.query.expressions[3].right.value, 2500.125);
  assert.equal(source.query.expressions[3].left.left.field, 'Budget');
  assert.equal(next.query.expressions[3].left.operator, 'subtract');
});

test('numeric editor rejects non-numeric fields, invalid operations and imprecise literals', () => {
  const next = edit.append(original, catalog, '$.query', { kind: 'arithmeticComparison' });
  const pointer = '$.query.expressions[3]';
  assert.throws(() => edit.change(next, catalog, pointer, { kind: 'numericField', value: 'Name' }), /numeric/);
  assert.throws(() => edit.change(next, catalog, pointer, { kind: 'numericField', value: 'Hours' }), /numeric/);
  assert.throws(() => edit.change(next, catalog, pointer, { kind: 'numericOperator', value: 'modulo' }), /Unknown/);
  assert.throws(() => edit.change(next, catalog, pointer, { kind: 'numericThreshold', value: NaN }), /numeric/);
  assert.throws(() => edit.change(next, catalog, pointer, { kind: 'numericThreshold', value: 0.1234567 }), /numeric/);
});

test('nested arithmetic trees survive canonical graph AST roundtrips', () => {
  const rootDef = structuredClone(original);
  const math = {
    type: 'arithmeticComparison', id: 'arithmetic-step',
    left: {
      type: 'numericBinary', operator: 'add',
      left: { type: 'numericField', field: 'Budget' },
      right: { type: 'numericBinary', operator: 'multiply',
        left: { type: 'numericLiteral', value: 2 }, right: { type: 'numericLiteral', value: 10 } }
    },
    operator: 'greaterThan', right: { type: 'numericLiteral', value: 1000 }
  };
  rootDef.query.expressions.push(math);
  const projection = graph.project(rootDef, catalog);
  assert.ok(projection.graphs[0].nodes.some(n => n.kind === 'arithmeticComparison'));
  assert.deepEqual(graph.toDefinition(projection), rootDef);
  assert.match(preview.description({ kind: 'arithmeticComparison', data: math }), /multiply/);
});

test('numeric value trees share the backend node and depth budgets', () => {
  const rootDef = structuredClone(original);
  let deep = { type: 'numericField', field: 'Budget' };
  for (let index = 0; index < 18; index++)
    deep = { type: 'numericBinary', operator: 'add', left: deep, right: { type: 'numericLiteral', value: 1 } };
  rootDef.query.expressions.push({
    type: 'arithmeticComparison', left: deep, operator: 'greaterThan',
    right: { type: 'numericLiteral', value: 0 }
  });
  assert.throws(() => graph.project(rootDef, catalog), /16 levels/);
});
