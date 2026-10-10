'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const edit = require('../../src/ExpressionForge.Api/wwwroot/graph-edit.js');
const graph = require('../../src/ExpressionForge.Api/wwwroot/graph-model.js');

const root = path.resolve(__dirname, '../..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'examples/project-catalog.json'), 'utf8'));
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'examples/project-query.json'), 'utf8')).definition;
const unchanged = before => assert.deepEqual(fixture, before);

test('guided and Blueprint palettes are metadata driven and entity scoped', () => {
  const project = edit.options(catalog, 'Project');
  const task = edit.options(catalog, 'Task');
  assert.ok(project.some(x => x.field === 'Archived'));
  assert.ok(project.some(x => x.collection === 'Tasks'));
  assert.ok(task.some(x => x.field === 'Hours'));
  assert.ok(!task.some(x => x.collection === 'Tasks'));
  assert.ok(!task.some(x => x.field === 'Archived'));
  assert.equal(edit.options(catalog, 'Unregistered').length, 0);
});

test('adding fields connects to the existing root group and keeps input ordering', () => {
  const before = structuredClone(fixture);
  const result = edit.append(fixture, catalog, '$.query', { kind: 'expression', field: 'Archived' });
  assert.equal(result.query.expressions.length, fixture.query.expressions.length + 1);
  assert.equal(result.query.expressions.at(-1).field, 'Archived');
  assert.equal(result.query.expressions.at(-1).value, false);
  assert.equal(graph.project(result, catalog).graphs.length, 2);
  assert.deepEqual(result.query.expressions.slice(0, -1), before.query.expressions);
  unchanged(before);
});

test('adding to single child collection wraps its predicate safely without changing scope', () => {
  const definition = structuredClone(fixture);
  const collection = definition.query.expressions.find(x => x.type === 'collectionExpression');
  collection.expression = collection.expression.expressions[0];
  const pointer = '$.query.expressions[2].expression';
  const next = edit.append(definition, catalog, pointer, { kind: 'expression', field: 'Hours' });
  const nested = next.query.expressions[2].expression;
  assert.equal(nested.type, 'group');
  assert.equal(nested.operator, 'and');
  assert.equal(nested.expressions.length, 2);
  assert.equal(nested.expressions[0].field, 'State');
  assert.equal(nested.expressions[1].field, 'Hours');
  assert.equal(graph.project(next, catalog).graphs.find(x => x.kind === 'collection').entityId, 'Task');
  assert.equal(definition.query.expressions[2].expression.type, 'expression');
});

test('collection palette creates valid target-scope predicate', () => {
  const result = edit.append(fixture, catalog, '$.query', { kind: 'collection', collection: 'Tasks' });
  const added = result.query.expressions.at(-1);
  assert.equal(added.type, 'collectionExpression');
  assert.equal(added.collection, 'Tasks');
  assert.equal(added.expression.field, 'Id');
  assert.equal(graph.project(result, catalog).graphs.length, 3);
});

test('cross-scope field injection and unauthorized metadata are rejected', () => {
  const before = structuredClone(fixture);
  assert.throws(() => edit.append(fixture, catalog, '$.query.expressions[2].expression',
    { kind: 'expression', field: 'Archived' }), /scope/);
  assert.throws(() => edit.append(fixture, catalog, '$.query', { kind: 'collection', collection: 'Secret' }), /scope/);
  assert.throws(() => edit.change(fixture, catalog, '$.query.expressions[0]', { kind: 'field', value: 'Hours' }), /scope/);
  assert.throws(() => edit.change(fixture, catalog, '$.query.expressions[0]', { kind: 'operator', value: 'drop' }), /unavailable/);
  assert.throws(() => edit.change(fixture, catalog, '$.query.expressions[0]', { kind: 'parameter', value: 'bad name' }), /parameter/);
  unchanged(before);
});

test('editor preserves identity and runtime parameters while changing group and comparison', () => {
  const before = structuredClone(fixture);
  const operator = edit.change(fixture, catalog, '$.query', { kind: 'operator', value: 'or' });
  assert.equal(operator.query.operator, 'or');
  assert.equal(operator.query.id, 'project-root');
  const field = edit.change(fixture, catalog, '$.query.expressions[1]', { kind: 'field', value: 'Archived' });
  const changed = field.query.expressions[1];
  assert.equal(changed.field, 'Archived');
  assert.equal(changed.value, false);
  assert.equal(changed.parameter, undefined);
  assert.equal(changed.id, 'project-budget');
  const renamed = edit.change(fixture, catalog, '$.query.expressions[1]',
    { kind: 'parameter', value: 'customBudget' });
  assert.equal(renamed.query.expressions[1].parameter, 'customBudget');
  assert.equal(renamed.query.expressions[1].value, undefined);
  unchanged(before);
});

test('typed comparison editor rejects invalid values and supports null operators', () => {
  const booleanPath = '$.query.expressions[0]';
  assert.throws(() => edit.change(fixture, catalog, booleanPath, { kind: 'value', value: 1 }), /boolean/);
  assert.equal(edit.change(fixture, catalog, booleanPath, { kind: 'value', value: true })
    .query.expressions[0].value, true);
  const sample = structuredClone(fixture);
  sample.query.expressions[0] = { type: 'expression', field: 'Name', operator: 'equals', value: 'demo' };
  const checked = edit.change(sample, catalog, booleanPath, { kind: 'operator', value: 'isNull' });
  assert.equal(checked.query.expressions[0].value, undefined);
  assert.throws(() => edit.change(checked, catalog, booleanPath, { kind: 'value', value: 'anything' }), /scalar|value/);
  const reverted = edit.change(checked, catalog, booleanPath, { kind: 'operator', value: 'equals' });
  assert.equal(reverted.query.expressions[0].value, '');
});

test('moving sibling predicate to another same-scope AND/OR group is atomic', () => {
  const definition = structuredClone(fixture);
  definition.query.expressions.unshift({ type: 'group', id: 'optional-group', operator: 'or', expressions: [
    { type: 'expression', id: 'only-child', field: 'Archived', operator: 'equals', value: true }
  ] });
  const result = edit.reconnect(definition, catalog, '$.query.expressions[2]', '$.query.expressions[0]');
  assert.equal(result.query.expressions.length, 3);
  const group = result.query.expressions[0];
  assert.equal(group.expressions.length, 2);
  assert.equal(group.expressions[1].id, 'project-budget');
  assert.equal(graph.project(result, catalog).graphs[0].entityId, 'Project');
  assert.equal(definition.query.expressions.length, 4);
});

test('socket reconnection refuses cross-scope, cycles and disconnection of last child', () => {
  const before = structuredClone(fixture);
  assert.throws(() => edit.reconnect(fixture, catalog,
    '$.query.expressions[0]', '$.query.expressions[2].expression'), /incompatible/);
  assert.throws(() => edit.reconnect(fixture, catalog, '$.query', '$.query.expressions[2].expression'), /descendant/);
  assert.throws(() => edit.reconnect(fixture, catalog,
    '$.query.expressions[2].expression.expressions[0]', '$.query'), /incompatible/);
  unchanged(before);
});

test('only real AST child paths are accepted and failed commands never mutate input', () => {
  const before = structuredClone(fixture);
  for (const invalid of ['$.entity', '$.query.notAChild', '$.query.expressions[-1]',
    '$.query.expressions[999]', '$.query.expression']) {
    assert.throws(() => edit.append(fixture, catalog, invalid, { kind: 'expression', field: 'Archived' }));
  }
  unchanged(before);
});

test('web editor registers graph command script and typed interaction controls', () => {
  const html = fs.readFileSync(path.join(root, 'src/ExpressionForge.Api/wwwroot/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src/ExpressionForge.Api/wwwroot/app.js'), 'utf8');
  const canvas = fs.readFileSync(path.join(root, 'src/ExpressionForge.Api/wwwroot/graph-preview.js'), 'utf8');
  const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.match(html, /graph-edit\.js/);
  assert.match(app, /ExpressionForgeGraphEdit\.append/);
  assert.match(app, /ExpressionForgeGraphEdit\.reconnect/);
  assert.match(canvas, /blueprint-socket-input/);
  assert.match(canvas, /blueprint-inline-inspector/);
  assert.match(canvas, /blueprint-palette/);
  assert.match(ci, /node --check src\/ExpressionForge.Api\/wwwroot\/graph-edit\.js/);
});
