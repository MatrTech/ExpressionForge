'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '../../src/ExpressionForge.Api/wwwroot/parameter-utils.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(script, context);
const { discover, buildBindings } = context.ExpressionForgeParameters;

const catalog = {
  entities: [
    {
      id: 'Customer',
      properties: [
        { id: 'Age', dataType: 'integer' },
        { id: 'Name', dataType: 'string' },
        { id: 'IsActive', dataType: 'boolean' }
      ],
      relationships: [{ id: 'Orders', targetEntity: 'Order' }]
    },
    {
      id: 'Order',
      properties: [{ id: 'Total', dataType: 'decimal' }, { id: 'CustomerId', dataType: 'integer' }],
      relationships: []
    }
  ]
};

const comparison = (field, parameter, operator = 'equals') =>
  ({ type: 'expression', field, parameter, operator });
const definition = query => ({ version: 1, entity: 'Customer', query });

test('discover finds runtime bindings across nested group, NOT and collection scopes', () => {
  const query = definition({ type: 'group', expressions: [
    comparison('Age', 'minimumAge'),
    { type: 'not', expression: comparison('Name', 'name') },
    { type: 'collectionExpression', collection: 'Orders', expression: comparison('Total', 'minimumTotal') }
  ] });
  const found = discover(query, catalog);
  assert.deepEqual(Array.from(found, item => [item.name, item.dataType]),
    [['minimumAge', 'integer'], ['name', 'string'], ['minimumTotal', 'decimal']]);
  assert.deepEqual(Array.from(found[2].references), ['Order.Total']);
});

test('discover merges references for repeated parameter names', () => {
  const found = discover(definition({ type: 'group', expressions: [
    comparison('Age', 'threshold'), comparison('Age', 'threshold')
  ] }), catalog);
  assert.equal(found.length, 1);
  assert.equal(found[0].references.length, 2);
  assert.equal(found[0].conflict, false);
});

test('discover detects incompatible types and invalid names', () => {
  const found = discover(definition({ type: 'group', expressions: [
    comparison('Age', 'same'), comparison('Name', 'same'), comparison('Age', 'bad;name')
  ] }), catalog);
  assert.equal(found[0].conflict, true);
  assert.equal(found[1].validName, false);
  assert.throws(() => buildBindings(found, {}), /incompatible field types/);
});

test('discover ignores literal and null-check expressions', () => {
  const found = discover(definition({ type: 'group', expressions: [
    { type: 'expression', field: 'Age', operator: 'equals', value: 18 },
    comparison('Name', 'unused', 'isNull')
  ] }), catalog);
  assert.equal(found.length, 0);
});

test('buildBindings emits typed values and leaves missing parameters unbound', () => {
  const definitions = discover(definition({ type: 'group', expressions: [
    comparison('Age', 'age'), comparison('Name', 'name'),
    comparison('IsActive', 'active'),
    { type: 'collectionExpression', collection: 'Orders', expression: comparison('Total', 'total') }
  ] }), catalog);
  const bindings = buildBindings(definitions, { age: '21', name: '', active: 'false', total: '100.50' });
  assert.equal(bindings.age, 21);
  assert.equal(bindings.name, '');
  assert.equal(bindings.active, false);
  assert.equal(bindings.total, 100.5);
  assert.equal(typeof bindings.total, 'number');
  assert.equal(Object.keys(buildBindings(definitions, {})).length, 0);
});

test('buildBindings rejects integer overflow, malformed numbers and invalid boolean', () => {
  const age = discover(definition(comparison('Age', 'age')), catalog);
  const active = discover(definition(comparison('IsActive', 'active')), catalog);
  const total = discover(definition({
    type: 'collectionExpression', collection: 'Orders', expression: comparison('Total', 'total')
  }), catalog);
  assert.throws(() => buildBindings(age, { age: '2147483648' }), /32-bit/);
  assert.throws(() => buildBindings(age, { age: '1.5' }), /integer/);
  assert.throws(() => buildBindings(active, { active: 'yes' }), /true or false/);
  assert.throws(() => buildBindings(total, { total: 'Infinity' }), /decimal number/);
  assert.throws(() => buildBindings(total, { total: '1;DROP TABLE' }), /decimal number/);
});

test('buildBindings rejects oversized strings', () => {
  const names = discover(definition(comparison('Name', 'name')), catalog);
  assert.throws(() => buildBindings(names, { name: 'a'.repeat(1025) }), /1024 characters/);
});
