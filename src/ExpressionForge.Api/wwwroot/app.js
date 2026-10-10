'use strict';

const $ = id => document.getElementById(id);
const state = { catalog: null, definition: null };
const sample = {
  version: 1,
  entity: 'Customer',
  query: { type: 'group', operator: 'and', expressions: [
    { type: 'expression', field: 'FirstName', operator: 'equals', value: 'John' },
    { type: 'group', operator: 'or', expressions: [
      { type: 'expression', field: 'Age', operator: 'greaterThan', value: 18 },
      { type: 'expression', field: 'IsActive', operator: 'equals', value: true }
    ] },
    { type: 'collectionExpression', collection: 'Orders', quantifier: 'any', expression: {
      type: 'expression', field: 'Total', operator: 'greaterThan', value: 100
    } }
  ] }
};

function element(tag, className = '', content) {
  const node = document.createElement(tag);
  node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}
function button(text, action, className = 'button small') {
  const node = element('button', className, text);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
function select(options, selected, action) {
  const node = element('select', 'control');
  for (const option of options) {
    const child = element('option', '', option.label);
    child.value = option.value;
    node.append(child);
  }
  node.value = selected;
  node.addEventListener('change', () => action(node.value));
  return node;
}
function fieldRow(label, control) {
  const row = element('div', 'node-field');
  row.append(element('label', '', label), control);
  return row;
}
function entity(id) { return state.catalog.entities.find(item => item.id === id); }
function property(entityId, id) { return entity(entityId)?.properties.find(item => item.id === id); }
function defaultValue(dataType) {
  return ({ integer: 18, decimal: 100, boolean: true })[dataType] ?? 'John';
}
function comparison(entityId) {
  const field = entity(entityId).properties[0];
  return { type: 'expression', field: field.id, operator: field.operators[0], value: defaultValue(field.dataType) };
}
function group(entityId) { return { type: 'group', operator: 'and', expressions: [comparison(entityId)] }; }
function collection(entityId) {
  const rel = entity(entityId).relationships[0];
  return { type: 'collectionExpression', collection: rel.id, quantifier: 'any', expression: group(rel.targetEntity) };
}
function fieldInput(dataType, value, action) {
  if (dataType === 'boolean')
    return select([{ value: 'true', label: 'True' }, { value: 'false', label: 'False' }], String(value), v => action(v === 'true'));
  const node = element('input', 'control');
  node.type = ['integer', 'decimal'].includes(dataType) ? 'number' : 'text';
  if (node.type === 'number') node.step = dataType === 'integer' ? '1' : 'any';
  node.value = String(value ?? '');
  node.addEventListener('input', () => {
    const parsed = node.type === 'number' ? Number(node.value) : node.value;
    action(node.type === 'number' && node.value === '' ? null : parsed);
  });
  return node;
}
function header(node, title, remove) {
  const head = element('div', 'node-head');
  head.append(element('span', 'node-icon'), element('span', 'node-name', title));
  if (remove) head.append(button('✕', remove, 'button danger'));
  node.append(head);
  return head;
}
function createNode(expression, entityId, remove) {
  const kind = expression.type === 'collectionExpression' ? 'collection' : expression.type === 'expression' ? 'comparison' : expression.type;
  const node = element('div', `node node-${kind}`);
  const titles = { group: 'Logical group', comparison: 'Comparison', collection: 'Collection predicate', not: 'Negation' };
  const head = header(node, titles[kind] || kind, remove);
  const body = element('div', 'node-body');

  if (expression.type === 'expression') {
    const current = property(entityId, expression.field);
    if (!current) {
      body.append(element('div', 'empty', `Unknown field: ${expression.field}`));
    } else {
      const fieldOptions = entity(entityId).properties.map(p => ({ value: p.id, label: p.displayName }));
      body.append(fieldRow('Field', select(fieldOptions, expression.field, value => {
        expression.field = value;
        const next = property(entityId, value);
        expression.operator = next.operators[0];
        expression.value = defaultValue(next.dataType);
        render();
      })));
      body.append(fieldRow('Operator', select(current.operators.map(id => {
        const op = state.catalog.operators.find(o => o.id === id);
        return { value: id, label: op?.displayName || id };
      }), expression.operator, value => { expression.operator = value; render(); })));
      if (!['isNull', 'isNotNull'].includes(expression.operator))
        body.append(fieldRow('Value', fieldInput(current.dataType, expression.value, value => { expression.value = value; updateJson(); })));
    }
    node.append(body);
  } else if (expression.type === 'group') {
    head.insertBefore(select([{ value: 'and', label: 'AND' }, { value: 'or', label: 'OR' }], expression.operator, value => {
      expression.operator = value; updateJson();
    }), head.lastChild.classList.contains('danger') ? head.lastChild : null);
    const children = element('div', 'children');
    for (const child of expression.expressions) {
      const wrapper = element('div', 'child');
      wrapper.append(createNode(child, entityId, () => {
        expression.expressions.splice(expression.expressions.indexOf(child), 1); render();
      }));
      children.append(wrapper);
    }
    if (!expression.expressions.length) children.append(element('div', 'empty', 'Empty group — add an expression.'));
    node.append(children);
    const actions = element('div', 'actions');
    actions.append(button('+ Expression', () => { expression.expressions.push(comparison(entityId)); render(); }));
    actions.append(button('+ Group', () => { expression.expressions.push(group(entityId)); render(); }));
    if (entity(entityId).relationships.length)
      actions.append(button('+ Collection', () => { expression.expressions.push(collection(entityId)); render(); }));
    actions.append(button('+ NOT', () => { expression.expressions.push({ type: 'not', expression: comparison(entityId) }); render(); }));
    node.append(actions);
  } else if (expression.type === 'collectionExpression') {
    const relations = entity(entityId).relationships;
    const relation = relations.find(r => r.id === expression.collection);
    body.append(fieldRow('Collection', select(relations.map(r => ({ value: r.id, label: r.displayName })), expression.collection, value => {
      expression.collection = value;
      expression.expression = group(relations.find(r => r.id === value).targetEntity);
      render();
    })));
    body.append(fieldRow('Quantifier', select(['any', 'all', 'none'].map(x => ({ value: x, label: x.toUpperCase() })),
      expression.quantifier, value => { expression.quantifier = value; updateJson(); })));
    node.append(body);
    if (relation) {
      const children = element('div', 'children');
      const wrapper = element('div', 'child');
      wrapper.append(createNode(expression.expression, relation.targetEntity, null));
      children.append(wrapper);
      node.append(children);
    }
  } else if (expression.type === 'not') {
    const children = element('div', 'children');
    const wrapper = element('div', 'child');
    wrapper.append(createNode(expression.expression, entityId, null));
    children.append(wrapper);
    node.append(children);
  }
  return node;
}
function countNodes(expr) {
  if (!expr || typeof expr !== 'object') return 0;
  if (expr.type === 'group') return 1 + expr.expressions.reduce((n, x) => n + countNodes(x), 0);
  if (['not', 'collectionExpression'].includes(expr.type)) return 1 + countNodes(expr.expression);
  return 1;
}
function ensureNodeIds(expression) {
  if (!expression || typeof expression !== 'object') return;
  if (expression.id === undefined) expression.id = crypto.randomUUID();
  if (expression.type === 'group' && Array.isArray(expression.expressions))
    expression.expressions.forEach(ensureNodeIds);
  else if (['not', 'collectionExpression'].includes(expression.type))
    ensureNodeIds(expression.expression);
}
function updateJson() {
  ensureNodeIds(state.definition.query);
  $('json').value = JSON.stringify(state.definition, null, 2);
  $('node-count').textContent = `${countNodes(state.definition.query)} nodes`;
}
function renderSchema() {
  const container = $('schema');
  container.replaceChildren();
  const metadata = entity(state.definition.entity);
  if (!metadata) return;
  container.append(element('p', 'entity-name', `${metadata.id} · Fields`));
  for (const field of metadata.properties) {
    const row = element('div', 'schema-field');
    row.append(element('span', '', `● ${field.displayName}`), element('span', 'schema-type', field.dataType));
    container.append(row);
  }
  if (metadata.relationships.length) container.append(element('p', 'entity-name', 'Relationships'));
  for (const relation of metadata.relationships) {
    const row = element('div', 'schema-field relationship');
    row.append(element('span', '', `◇ ${relation.displayName}`), element('span', 'schema-type', `→ ${relation.targetEntity}[]`));
    container.append(row);
  }
}
function render() {
  const root = $('graph');
  root.replaceChildren(createNode(state.definition.query, state.definition.entity, null));
  $('entity').value = state.definition.entity;
  renderSchema();
  updateJson();
}
function show(message, type = '') { $('message').className = `message ${type}`; $('message').textContent = message; }
async function request(endpoint) {
  const limit = Number($('limit').value) || 25;
  const response = await fetch(`/api/query/${endpoint}?limit=${encodeURIComponent(limit)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.definition)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data, null, 2));
  return data;
}
async function perform(endpoint) {
  try {
    show('Checking query…');
    const result = await request(endpoint);
    if (endpoint === 'validate') {
      $('output').textContent = JSON.stringify(result, null, 2);
      show(result.isValid ? 'Query structure and types are valid.' : `${result.issues.length} validation issues found.`,
        result.isValid ? 'success' : 'error');
    } else if (endpoint === 'compile') {
      $('output').textContent = result.sql + '\n\n-- Parameters\n' + JSON.stringify(result.parameters, null, 2);
      show('Parameterized SQL Server query generated.', 'success');
    } else {
      $('output').textContent = JSON.stringify(result, null, 2);
      show(`Preview returned ${result.rows.length} row(s).`, 'success');
    }
  } catch (error) {
    $('output').textContent = error.message;
    show(error.message, 'error');
  }
}
async function start() {
  for (const endpoint of ['validate', 'compile', 'preview']) $(endpoint).addEventListener('click', () => perform(endpoint));
  $('reset').addEventListener('click', () => { state.definition = structuredClone(sample); render(); show(''); });
  $('load-json').addEventListener('click', () => {
    try {
      const value = JSON.parse($('json').value);
      if (!value || !entity(value.entity) || !value.query || !['group', 'expression', 'collectionExpression', 'not'].includes(value.query.type))
        throw new Error('Select a registered entity and a supported expression root.');
      const previous = state.definition;
      try { state.definition = value; render(); } catch (error) { state.definition = previous; render(); throw error; }
      show('JSON loaded. Validate it before execution.', 'success');
    } catch (error) { show(`Invalid JSON: ${error.message}`, 'error'); }
  });
  $('copy-json').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('json').value); show('JSON copied.', 'success'); }
    catch { show('Clipboard access is unavailable. Select and copy the JSON manually.', 'error'); }
  });
  try {
    const response = await fetch('/api/query/metadata');
    if (!response.ok) throw new Error(`Metadata request failed: ${response.status}`);
    state.catalog = await response.json();
    state.definition = structuredClone(sample);
    const options = state.catalog.entities.map(e => ({ value: e.id, label: e.displayName }));
    $('entity').replaceWith(Object.assign(select(options, state.definition.entity, value => {
      state.definition.entity = value;
      state.definition.query = group(value);
      render(); show('');
    }), { id: 'entity' }));
    $('connection').textContent = `Catalog ${state.catalog.catalogVersion} connected`;
    render();
  } catch (error) { show(error.message, 'error'); $('connection').textContent = 'Metadata unavailable'; }
}
start();
