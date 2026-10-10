'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const history = require('../../src/ExpressionForge.Api/wwwroot/graph-history.js');
const edit = require('../../src/ExpressionForge.Api/wwwroot/graph-edit.js');
const graph = require('../../src/ExpressionForge.Api/wwwroot/graph-model.js');
const root = path.resolve(__dirname, '../..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'examples/project-catalog.json'), 'utf8'));
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'examples/project-query.json'), 'utf8')).definition;
const snapshot = (definition, positions = {}) => ({
  definition: structuredClone(definition), graphLayout: { version: 1, graphs: { root: { positions, viewport: null } } },
  parameters: { minimumBudget: 10000, minimumHours: 12 }
});

test('delete removes a predicate without losing siblings or changing the input', () => {
  const original = structuredClone(fixture);
  const result = edit.remove(fixture, catalog, '$.query.expressions[1]');
  assert.deepEqual(result.query.expressions.map(item => item.id), ['project-active', 'project-tasks']);
  assert.equal(graph.project(result, catalog).graphs.length, 2);
  assert.deepEqual(fixture, original);
});

test('deleting the root, a collection child or the last group child is forbidden', () => {
  assert.equal(edit.canRemove(fixture, catalog, '$.query'), false);
  assert.equal(edit.canRemove(fixture, catalog, '$.query.expressions[2].expression'), false);
  assert.equal(edit.canRemove(fixture, catalog, '$.query.expressions[0]'), true);
  assert.throws(() => edit.remove(fixture, catalog, '$.query'), /Only predicates/);
  assert.throws(() => edit.remove(fixture, catalog, '$.query.expressions[2].expression'), /Only predicates/);
  const oneChild = { version: 1, entity: 'Project', query: { type: 'group', operator: 'and',
    expressions: [{ type: 'expression', field: 'Archived', operator: 'equals', value: true }] } };
  assert.equal(edit.canRemove(oneChild, catalog, '$.query.expressions[0]'), false);
  assert.throws(() => edit.remove(oneChild, catalog, '$.query.expressions[0]'), /only predicate/);
});

test('insert a logical predicate on an edge preserves the previous subtree and its identity', () => {
  const original = structuredClone(fixture);
  const result = edit.insert(fixture, catalog, '$.query.expressions[1]', { operator: 'or', field: 'Archived' });
  const wrapper = result.query.expressions[1];
  assert.equal(wrapper.type, 'group');
  assert.equal(wrapper.operator, 'or');
  assert.equal(wrapper.expressions[0].id, 'project-budget');
  assert.equal(wrapper.expressions[0].parameter, 'minimumBudget');
  assert.equal(wrapper.expressions[1].field, 'Archived');
  assert.equal(wrapper.expressions[1].value, false);
  assert.deepEqual(graph.toDefinition(graph.project(result, catalog)), result);
  assert.deepEqual(fixture, original);
});

test('wrap in NOT on root or nested Task scope without schema-crossing', () => {
  const root = edit.insert(fixture, catalog, '$.query', { kind: 'not' });
  assert.equal(root.query.type, 'not');
  assert.equal(root.query.expression.id, 'project-root');
  const task = edit.insert(fixture, catalog, '$.query.expressions[2].expression.expressions[0]', { kind: 'not' });
  assert.equal(task.query.expressions[2].expression.expressions[0].type, 'not');
  assert.equal(task.query.expressions[2].expression.expressions[0].expression.field, 'State');
  assert.deepEqual(graph.toDefinition(graph.project(task, catalog)), task);
});

test('insert rejects invalid metadata fields and unsupported operator choices', () => {
  assert.throws(() => edit.insert(fixture, catalog, '$.query.expressions[2].expression',
    { operator: 'and', field: 'Archived' }), /scope/);
  assert.throws(() => edit.insert(fixture, catalog, '$.query.expressions[0]',
    { operator: 'xor', field: 'Archived' }), /Choose AND\/OR/);
  assert.throws(() => edit.insert(fixture, catalog, '$.query.expressions[0]',
    { operator: 'and', field: 'SecretField' }), /scope/);
});

test('history records AST edits, runtime bindings and layout as atomic snapshots', () => {
  const initial = snapshot(fixture);
  const record = history.create(initial);
  const changed = edit.remove(fixture, catalog, '$.query.expressions[1]');
  const updated = snapshot(changed, { 'id:project-root': { x: 30, y: 40 } });
  updated.parameters.minimumBudget = 20000;
  assert.equal(history.commit(record, updated), true);
  assert.deepEqual(history.available(record), { undo: true, redo: false });
  const back = history.undo(record);
  assert.deepEqual(back, initial);
  assert.equal(back.definition.query.expressions.length, 3);
  assert.deepEqual(history.redo(record), updated);
});

test('redo is cleared after a new edit and no-op history does not grow', () => {
  const initial = snapshot(fixture);
  const record = history.create(initial);
  assert.equal(history.commit(record, snapshot(fixture)), false);
  const changed = snapshot(edit.change(fixture, catalog, '$.query', { kind: 'operator', value: 'or' }));
  history.commit(record, changed);
  history.undo(record);
  assert.equal(history.available(record).redo, true);
  const alternate = snapshot(edit.remove(fixture, catalog, '$.query.expressions[1]'));
  history.commit(record, alternate);
  assert.equal(history.available(record).redo, false);
  assert.equal(history.redo(record), null);
});

test('history holds bounded snapshots and defensive clones', () => {
  const initial = snapshot(fixture);
  const record = history.create(initial, 3);
  for (let x = 0; x < 9; x++) history.commit(record, { ...snapshot(fixture), parameters: { value: x } });
  assert.equal(record.past.length, 3);
  const state = history.undo(record);
  state.parameters.value = 9999;
  assert.notEqual(record.current.parameters.value, 9999);
  assert.equal(history.available(record).redo, true);
});

test('same-scope socket checks preserve the existing AST on rejected reconnections', () => {
  const before = structuredClone(fixture);
  const status = edit.canReconnect(fixture, catalog, '$.query.expressions[0]',
    '$.query.expressions[2].expression');
  assert.equal(status.valid, false);
  assert.match(status.reason, /incompatible/);
  assert.deepEqual(fixture, before);
});

test('editor wires gesture, insertion and undo controls and checks history module', () => {
  const editor = fs.readFileSync(path.join(root, 'src/ExpressionForge.Api/wwwroot/app.js'), 'utf8');
  const canvas = fs.readFileSync(path.join(root, 'src/ExpressionForge.Api/wwwroot/graph-preview.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src/ExpressionForge.Api/wwwroot/index.html'), 'utf8');
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.match(editor, /restoreHistory/);
  assert.match(editor, /ExpressionForgeGraphEdit\.insert/);
  assert.match(editor, /ExpressionForgeGraphEdit\.remove/);
  assert.match(canvas, /setPointerCapture/);
  assert.match(canvas, /blueprint-wire-pending/);
  assert.match(canvas, /onCheckReconnect/);
  assert.match(canvas, /blueprint-wire-add/);
  assert.match(html, /graph-history\.js/);
  assert.match(html, /id="undo-edit"/);
  assert.match(html, /id="redo-edit"/);
  assert.match(workflow, /node --check src\/ExpressionForge.Api\/wwwroot\/graph-history\.js/);
});
