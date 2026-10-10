'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'examples/project-catalog.json'), 'utf8'));
const original = JSON.parse(fs.readFileSync(path.join(root, 'examples/project-query.json'), 'utf8')).definition;
const edit = require('../../src/ExpressionForge.Api/wwwroot/graph-edit.js');
const tree = require('../../src/ExpressionForge.Api/wwwroot/numeric-tree.js');
const graph = require('../../src/ExpressionForge.Api/wwwroot/graph-model.js');
const preview = require('../../src/ExpressionForge.Api/wwwroot/graph-preview.js');

const appended = (kind = 'arithmeticComparison') => edit.append(original, catalog, '$.query', { kind });
const nodePath = '$.query.expressions[3]';

test('safe conversion is available only with a string field from current entity scope', () => {
  assert.ok(edit.options(catalog, 'Project').some(x => x.kind === 'tryParseDecimal'));
  const added = appended('tryParseDecimal');
  assert.deepEqual(added.query.expressions.at(-1), {
    type: 'arithmeticComparison',
    left: { type: 'tryParseDecimal', field: 'Name' },
    operator: 'greaterThan',
    right: { type: 'numericLiteral', value: 0 }
  });
  assert.deepEqual(graph.toDefinition(graph.project(added, catalog)), added);
  assert.match(preview.description({kind:'arithmeticComparison',data:added.query.expressions.at(-1)}), /Decimal\?\(Name\)/);
  assert.deepEqual(original.query.expressions.length, 3);
});

test('converting text is composable inside numeric arithmetic and parent AST remains immutable', () => {
  const added = appended();
  const changed = edit.editValue(added, catalog, nodePath, 'left.left',
    { kind: 'replace', type: 'tryParseDecimal' });
  const predicate = changed.query.expressions.at(-1);
  assert.deepEqual(predicate.left.left, { type: 'tryParseDecimal', field: 'Name' });
  assert.equal(added.query.expressions.at(-1).left.left.type, 'numericField');
  const wrapped = edit.editValue(changed, catalog, nodePath, 'left.left',
    { kind: 'wrap', operator: 'multiply' });
  assert.deepEqual(wrapped.query.expressions.at(-1).left.left, {
    type: 'numericBinary', operator: 'multiply',
    left: { type: 'tryParseDecimal', field: 'Name' },
    right: { type: 'numericLiteral', value: 1 }
  });
  assert.deepEqual(graph.toDefinition(graph.project(wrapped, catalog)), wrapped);
  const unwrapped = edit.editValue(wrapped, catalog, nodePath, 'left.left',
    { kind: 'unwrap' });
  assert.deepEqual(unwrapped.query, changed.query);
});

test('both comparison sides and nested calculation operands can change type safely', () => {
  const first = appended();
  const numericRight = edit.editValue(first, catalog, nodePath, 'right',
    { kind: 'replace', type: 'numericField' });
  assert.equal(numericRight.query.expressions[3].right.field, 'Id');
  const runtime = edit.editValue(first, catalog, nodePath, 'left.right',
    { kind: 'replace', type: 'numericParameter' });
  const changed = edit.editValue(runtime, catalog, nodePath, 'left.right',
    { kind: 'set', property: 'parameter', value: 'myThreshold' });
  assert.deepEqual(changed.query.expressions[3].left.right, {
    type: 'numericParameter', parameter: 'myThreshold'
  });
  assert.deepEqual(first.query.expressions[3].left.right, { type: 'numericLiteral', value: 0 });
});

test('value editing enforces canonical metadata typing and blocks unexpected paths', () => {
  const a = appended();
  assert.throws(() => edit.editValue(a, catalog, nodePath, '__proto__', { kind:'replace', type:'numericLiteral' }), /Invalid numeric value path/);
  assert.throws(() => edit.editValue(a, catalog, nodePath, 'left.left.right',
    { kind:'replace',type:'numericLiteral' }), /path does not exist/);
  assert.throws(() => edit.editValue(a, catalog, nodePath, 'left', { kind:'replace', type:'dateDiffDays' }), /metadata scope/);
  assert.throws(() => edit.editValue(a, catalog, nodePath, 'left.left',
    { kind:'set', property:'field', value:'Archived' }), /numeric/);
  assert.throws(() => edit.editValue(a, catalog, nodePath, 'left.left',
    { kind:'set', property:'field', value:'Tasks' }), /numeric/);
  assert.throws(() => edit.editValue(a, catalog, nodePath, 'left.right',
    { kind:'set', property:'value', value:0.1234567 }), /six fractional/);
  assert.throws(() => edit.editValue(a, catalog, nodePath, 'left',
    { kind:'wrap', operator:'EXEC' }), /Unsupported arithmetic/);
  assert.deepEqual(a.query.expressions[3].left.left, { type:'numericField', field:'Id' });
});

test('date difference value kind requires a compatible date field pair in a nested scope', () => {
  const metadata = structuredClone(catalog);
  const task = metadata.entities.find(e => e.id === 'Task');
  task.properties.push(
    { id: 'StartedAt', displayName: 'Started', dataType: 'date', operators: [] },
    { id: 'FinishedAt', displayName: 'Finished', dataType: 'date', operators: [] },
    { id: 'LastSeen', displayName: 'Last seen', dataType: 'dateTime', operators: [] }
  );
  const path = '$.query.expressions[2].expression';
  const added = edit.append(original, metadata, path, { kind:'arithmeticComparison' });
  const nested = path + '.expressions[2]';
  const converted = edit.editValue(added, metadata, nested, 'left',
    { kind:'replace', type:'dateDiffDays' });
  assert.deepEqual(edit.locate(converted, metadata, nested).node.left, {
    type:'dateDiffDays', startField:'StartedAt', endField:'FinishedAt'
  });
  assert.throws(() => edit.editValue(converted, metadata, nested, 'left',
    { kind:'set', property:'endField', value:'LastSeen' }), /same date\/dateTime/);
  assert.deepEqual(graph.toDefinition(graph.project(converted, metadata)), converted);
});

test('numeric trees are limited by the complexity budget', () => {
  let source = appended();
  for (let i = 0; i < 14; i++) {
    source = edit.editValue(source, catalog, nodePath, 'left',
      { kind: 'wrap', operator: 'add' });
  }
  assert.throws(() => edit.editValue(source, catalog, nodePath, 'left',
    { kind: 'wrap', operator: 'add' }), /depth/);
});

test('numeric-value tree is mounted in both API editor and static Pages', () => {
  const api = fs.readFileSync(path.join(root, 'src/ExpressionForge.Api/wwwroot/index.html'), 'utf8');
  const demo = fs.readFileSync(path.join(root, 'site/blueprint.html'), 'utf8');
  assert.match(api, /numeric-tree\.js/);
  assert.match(demo, /blueprint-assets\/numeric-tree\.js/);
  assert.ok(tree.choices(catalog, 'Project').some(x => x.type === 'tryParseDecimal'));
});
