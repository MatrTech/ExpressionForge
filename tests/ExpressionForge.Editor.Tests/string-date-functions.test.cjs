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

const withDateMetadata = () => {
  const modified = structuredClone(catalog);
  modified.entities[1].properties.push(
    { id: 'StartedAt', displayName: 'Started', dataType: 'date', operators: [], nullable: true },
    { id: 'FinishedAt', displayName: 'Finished', dataType: 'date', operators: [], nullable: true },
    { id: 'LastSeen', displayName: 'Last seen', dataType: 'dateTime', operators: [], nullable: true }
  );
  return modified;
};

test('palette offers text length only for visible strings and date differences only for matching date pairs', () => {
  const project = edit.options(catalog, 'Project');
  assert.ok(project.some(x => x.kind === 'stringLength' && x.label === 'Text length'));
  assert.ok(!project.some(x => x.kind === 'dateDiffDays'));
  const expanded = withDateMetadata();
  assert.ok(edit.options(expanded, 'Task').some(x => x.kind === 'dateDiffDays'));
  assert.ok(!edit.options(expanded, 'Project').some(x => x.kind === 'dateDiffDays'));
});

test('text-length predicate uses canonical arithmetic comparison and round trips', () => {
  const result = edit.append(original, catalog, '$.query', { kind: 'stringLength' });
  const node = result.query.expressions.at(-1);
  assert.deepEqual(node, {
    type: 'arithmeticComparison',
    left: { type: 'stringLength', field: 'Name' },
    operator: 'greaterThan',
    right: { type: 'numericLiteral', value: 10 }
  });
  assert.deepEqual(graph.toDefinition(graph.project(result, catalog)), result);
  assert.deepEqual(original.query.expressions.length, 3);
  assert.match(preview.description({ kind: 'arithmeticComparison', data: node }), /Length\(Name\)/);
});

test('metadata-safe text-length changes and numeric comparisons are immutable', () => {
  const before = edit.append(original, catalog, '$.query', { kind: 'stringLength' });
  const address = '$.query.expressions[3]';
  const updated = edit.change(before, catalog, address, { kind: 'numericThreshold', value: 6 });
  assert.equal(updated.query.expressions[3].right.value, 6);
  assert.equal(before.query.expressions[3].right.value, 10);
  assert.throws(() => edit.change(before, catalog, address, { kind: 'stringField', value: 'Archived' }), /String field/);
  assert.throws(() => edit.change(before, catalog, address, { kind: 'stringField', value: 'State' }), /String field/);
  assert.throws(() => edit.change(before, catalog, address, { kind: 'numericComparator', value: 'contains' }), /comparison/);
});

test('dateDifference validates date-field types within the current subgraph', () => {
  const expanded = withDateMetadata();
  const base = edit.append(original, expanded, '$.query.expressions[2].expression', { kind: 'dateDiffDays' });
  const path = '$.query.expressions[2].expression.expressions[2]';
  const predicate = edit.locate(base, expanded, path).node;
  assert.deepEqual(predicate.left, {
    type: 'dateDiffDays', startField: 'StartedAt', endField: 'FinishedAt'
  });
  assert.deepEqual(graph.toDefinition(graph.project(base, expanded)), base);
  const changed = edit.change(base, expanded, path, { kind: 'startDateField', value: 'FinishedAt' });
  assert.equal(edit.locate(changed, expanded, path).node.left.startField, 'FinishedAt');
  assert.throws(() => edit.change(base, expanded, path, { kind: 'endDateField', value: 'LastSeen' }),
    /identical types/);
  assert.throws(() => edit.change(base, expanded, path, { kind: 'endDateField', value: 'Name' }),
    /identical types/);
});

test('function value expressions participate in the same recursion and node budgets', () => {
  const sample = structuredClone(original);
  sample.query.expressions.push({ type: 'arithmeticComparison',
    left: { type: 'numericBinary', operator: 'add',
      left: { type: 'stringLength', field: 'Name' },
      right: { type: 'numericLiteral', value: 5 } },
    operator: 'greaterThan', right: { type: 'numericLiteral', value: 12 } });
  assert.deepEqual(graph.toDefinition(graph.project(sample, catalog)), sample);
  let value = { type: 'stringLength', field: 'Name' };
  for (let i = 0; i < 18; i++) value = {
    type: 'numericBinary', operator: 'add', left: value,
    right: { type: 'numericLiteral', value: 1 } };
  sample.query.expressions.at(-1).left = value;
  assert.throws(() => graph.project(sample, catalog), /16 levels/);
});
