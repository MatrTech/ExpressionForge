'use strict';

const $ = id => document.getElementById(id);
const state = { catalog: null, catalogs: [], definition: null, parameters: {}, drafts: new Map(),
  graphPreview: false, activeGraphKey: 'root', graphSubgraphs: new Set(),
  graphLayout: null, layoutKey: null, expandedNodePath: null,
  pendingSourcePath: null, pendingSourceEntity: null, history: null, historyRestoring: false };
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
function createNode(expression, entityId, remove, path = '$.query') {
  const kind = expression.type === 'collectionExpression' ? 'collection' : ['expression', 'fieldComparison', 'arithmeticComparison'].includes(expression.type) ? 'comparison' : expression.type;
  const node = element('div', `node node-${kind}`);
  const titles = { group: 'Logical group', comparison: expression.type === 'fieldComparison' ? 'Field comparison' : expression.type === 'arithmeticComparison' ? 'Calculation' : 'Comparison', collection: 'Collection predicate', not: 'Negation' };
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
        if (expression.parameter === undefined) expression.value = defaultValue(next.dataType);
        render();
      })));
      body.append(fieldRow('Operator', select(current.operators.map(id => {
        const op = state.catalog.operators.find(o => o.id === id);
        return { value: id, label: op?.displayName || id };
      }), expression.operator, value => {
        expression.operator = value;
        if (['isNull', 'isNotNull'].includes(value)) {
          delete expression.parameter;
          delete expression.value;
        } else if (expression.parameter === undefined && expression.value === undefined) {
          expression.value = defaultValue(current.dataType);
        }
        render();
      })));
      if (!['isNull', 'isNotNull'].includes(expression.operator)) {
        const mode = expression.parameter === undefined ? 'literal' : 'parameter';
        body.append(fieldRow('Value source', select([
          { value: 'literal', label: 'Fixed value' },
          { value: 'parameter', label: 'Runtime parameter' }
        ], mode, value => {
          if (value === 'parameter') {
            delete expression.value;
            expression.parameter = `parameter_${crypto.randomUUID().slice(0, 8)}`;
          } else {
            delete expression.parameter;
            expression.value = defaultValue(current.dataType);
          }
          render();
        })));
        if (mode === 'literal')
          body.append(fieldRow('Value', fieldInput(current.dataType, expression.value, value => { expression.value = value; updateJson(); })));
        else {
          const name = element('input', 'control');
          name.type = 'text';
          name.maxLength = 64;
          name.placeholder = 'parameterName';
          name.value = expression.parameter;
          name.addEventListener('input', () => { expression.parameter = name.value; updateJson(); });
          body.append(fieldRow('Parameter', name));
        }
      }
    }
    node.append(body);
  } else if (expression.type === 'fieldComparison') {
    const properties = entity(entityId).properties;
    const left = property(entityId, expression.leftField);
    const right = property(entityId, expression.rightField);
    const ops = (a, b) => a && b && a.dataType === b.dataType ?
      a.operators.filter(op => b.operators.includes(op) && (['equals', 'notEquals'].includes(op) ||
        (['integer', 'decimal'].includes(a.dataType) &&
          ['greaterThan', 'greaterThanOrEqual', 'lessThan', 'lessThanOrEqual'].includes(op)))) : [];
    body.append(fieldRow('Left field', select(properties.filter(p => ops(p, right).length)
      .map(p => ({ value: p.id, label: p.displayName })), expression.leftField,
    value => applyGraphEdit(() => ExpressionForgeGraphEdit.change(state.definition, state.catalog, path,
      { kind: 'leftField', value })))));
    body.append(fieldRow('Right field', select(properties.filter(p => ops(left, p).length)
      .map(p => ({ value: p.id, label: p.displayName })), expression.rightField,
    value => applyGraphEdit(() => ExpressionForgeGraphEdit.change(state.definition, state.catalog, path,
      { kind: 'rightField', value })))));
    body.append(fieldRow('Operator', select(ops(left, right).map(op => ({ value: op,
      label: state.catalog.operators.find(x => x.id === op)?.displayName || op })), expression.operator,
    value => applyGraphEdit(() => ExpressionForgeGraphEdit.change(state.definition, state.catalog, path,
      { kind: 'operator', value })))));
    node.append(body);
  } else if (expression.type === 'arithmeticComparison') {
    const arithmetic = expression.left;
    if (arithmetic?.type === 'numericBinary' && arithmetic.left?.type === 'numericField' &&
      ['numericLiteral', 'numericParameter'].includes(arithmetic.right?.type) &&
      ['numericLiteral', 'numericParameter'].includes(expression.right?.type)) {
      const numeric = entity(entityId).properties.filter(p => ['integer', 'decimal'].includes(p.dataType));
      function modify(kind, value) {
        applyGraphEdit(() => ExpressionForgeGraphEdit.change(state.definition, state.catalog, path, { kind, value }));
      }
      body.append(fieldRow('Field', select(numeric.map(p => ({ value: p.id, label: p.displayName })),
        arithmetic.left.field, value => modify('numericField', value))));
      body.append(fieldRow('Calculation', select([
        { value: 'add', label: 'Add (+)' }, { value: 'subtract', label: 'Subtract (-)' },
        { value: 'multiply', label: 'Multiply (×)' }, { value: 'divide', label: 'Divide (÷)' }
      ], arithmetic.operator, value => modify('numericOperator', value))));
      for (const [title, value, kind] of [
        ['Operand', arithmetic.right, 'numericOperand'], ['Threshold', expression.right, 'numericThreshold']
      ]) {
        body.append(fieldRow(title + ' source', select([
          { value: 'literal', label: 'Fixed value' },
          { value: 'parameter', label: 'Runtime parameter' }
        ], value.type === 'numericLiteral' ? 'literal' : 'parameter',
        source => modify(kind + 'Mode', source))));
        const input = element('input', 'control');
        input.type = value.type === 'numericLiteral' ? 'number' : 'text';
        if (input.type === 'number') input.step = 'any';
        input.value = String(value.type === 'numericLiteral' ? value.value : value.parameter);
        input.addEventListener('change', () => modify(value.type === 'numericLiteral' ? kind : kind + 'Parameter',
          value.type === 'numericLiteral' ? Number(input.value) : input.value));
        body.append(fieldRow(value.type === 'numericLiteral' ? title : title + ' parameter name', input));
      }
      body.append(fieldRow('Compare', select(
        ['equals','notEquals','greaterThan','greaterThanOrEqual','lessThan','lessThanOrEqual']
          .map(value => ({ value, label: value })), expression.operator, value => modify('numericComparator', value))));
    } else if (['stringLength', 'dateDiffDays'].includes(arithmetic?.type) &&
      expression.right?.type === 'numericLiteral') {
      const props = entity(entityId).properties;
      function modify(kind, value) {
        applyGraphEdit(() => ExpressionForgeGraphEdit.change(state.definition, state.catalog, path, { kind, value }));
      }
      if (arithmetic.type === 'stringLength') {
        body.append(fieldRow('Text field', select(props.filter(p => p.dataType === 'string')
          .map(p => ({ value: p.id, label: p.displayName })), arithmetic.field,
          value => modify('stringField', value))));
      } else {
        const dataType = props.find(p => p.id === arithmetic.startField)?.dataType;
        const dates = props.filter(p => p.dataType === dataType && ['date','dateTime'].includes(p.dataType));
        body.append(fieldRow('Start date', select(dates.map(p => ({ value: p.id, label: p.displayName })),
          arithmetic.startField, value => modify('startDateField', value))));
        body.append(fieldRow('End date', select(dates.map(p => ({ value: p.id, label: p.displayName })),
          arithmetic.endField, value => modify('endDateField', value))));
      }
      body.append(fieldRow('Compare', select(
        ['equals','notEquals','greaterThan','greaterThanOrEqual','lessThan','lessThanOrEqual']
          .map(value => ({ value, label: value })), expression.operator,
        value => modify('numericComparator', value))));
      const input = element('input', 'control');
      input.type = 'number';
      input.step = 'any';
      input.value = String(expression.right.value);
      input.addEventListener('change', () => modify('numericThreshold', Number(input.value)));
      body.append(fieldRow('Threshold', input));
    } else {
      body.append(element('p', 'empty', 'Advanced numeric AST — edit using JSON.'));
    }
    node.append(body);
  } else if (expression.type === 'group') {
    head.insertBefore(select([{ value: 'and', label: 'AND' }, { value: 'or', label: 'OR' }], expression.operator, value => {
      expression.operator = value; updateJson();
    }), head.lastChild.classList.contains('danger') ? head.lastChild : null);
    const children = element('div', 'children');
    for (const [index, child] of expression.expressions.entries()) {
      const wrapper = element('div', 'child');
      wrapper.append(createNode(child, entityId, () => {
        expression.expressions.splice(expression.expressions.indexOf(child), 1); render();
      }, path + '.expressions[' + index + ']'));
      children.append(wrapper);
    }
    if (!expression.expressions.length) children.append(element('div', 'empty', 'Empty group — add an expression.'));
    node.append(children);
    const actions = element('div', 'actions');
    const choices = ExpressionForgeGraphEdit.options(state.catalog, entityId);
    if (choices.length) {
      const palette = select(choices.map((option, index) =>
        ({ value: String(index), label: option.label })), '0', () => {});
      palette.setAttribute('aria-label', 'Choose a condition for ' + entityId);
      palette.classList.add('guided-condition-picker');
      actions.append(palette, button('+ Add condition', () =>
        applyGraphEdit(() => ExpressionForgeGraphEdit.append(state.definition, state.catalog,
          path, choices[Number(palette.value)]))));
    }
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
      wrapper.append(createNode(expression.expression, relation.targetEntity, null, path + '.expression'));
      children.append(wrapper);
      node.append(children);
    }
  } else if (expression.type === 'not') {
    const children = element('div', 'children');
    const wrapper = element('div', 'child');
    wrapper.append(createNode(expression.expression, entityId, null, path + '.expression'));
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
function captureSnapshot() {
  return { definition: structuredClone(state.definition), parameters: structuredClone(state.parameters),
    graphLayout: structuredClone(state.graphLayout) };
}
function refreshHistoryButtons() {
  const available = ExpressionForgeHistory.available(state.history);
  $('undo-edit').disabled = !available.undo;
  $('redo-edit').disabled = !available.redo;
}
function recordHistory() {
  if (state.historyRestoring || !state.definition || !state.graphLayout) return;
  const snapshot = captureSnapshot();
  if (!state.history) state.history = ExpressionForgeHistory.create(snapshot);
  else ExpressionForgeHistory.commit(state.history, snapshot);
  refreshHistoryButtons();
}
function restoreHistory(direction) {
  if (!state.history) return;
  const previous = direction === 'undo' ? ExpressionForgeHistory.undo(state.history)
    : ExpressionForgeHistory.redo(state.history);
  if (!previous) return;
  state.historyRestoring = true;
  try {
    state.definition = previous.definition;
    state.parameters = previous.parameters;
    state.graphLayout = previous.graphLayout;
    state.expandedNodePath = null;
    state.pendingSourcePath = null;
    state.pendingSourceEntity = null;
    ExpressionForgeGraphLayout.write(browserStorage(), state.layoutKey, state.graphLayout);
    render();
  } finally {
    state.historyRestoring = false;
    refreshHistoryButtons();
  }
}
function updateJson() {
  ensureNodeIds(state.definition.query);
  $('json').value = JSON.stringify(state.definition, null, 2);
  $('node-count').textContent = `${countNodes(state.definition.query)} nodes`;
  renderParameters();
  recordHistory();
  if (state.graphPreview) renderGraphPreview();
}
function renderParameters() {
  const definitions = ExpressionForgeParameters.discover(state.definition, state.catalog);
  const section = $('parameter-section');
  const container = $('runtime-parameters');
  section.hidden = definitions.length === 0;
  container.replaceChildren();
  for (const definition of definitions) {
    const row = element('div', 'runtime-parameter');
    const label = element('label', 'parameter-label', definition.name);
    const detail = element('span', 'parameter-detail',
      `${definition.dataType} · ${definition.references.join(', ')}`);
    const input = element(definition.dataType === 'boolean' ? 'select' : 'input', 'control');
    input.id = `binding-${definition.name}`;
    label.htmlFor = input.id;
    if (definition.dataType === 'boolean') {
      for (const [value, title] of [['', 'Choose…'], ['true', 'True'], ['false', 'False']]) {
        const option = element('option', '', title);
        option.value = value;
        input.append(option);
      }
    } else {
      input.type = 'text';
      input.placeholder = definition.dataType === 'string' ? 'Enter a value' : `Enter ${definition.dataType}`;
      input.autocomplete = 'off';
    }
    input.value = state.parameters[definition.name] ?? '';
    input.addEventListener('input', () => {
      if (input.value === '' && definition.dataType !== 'string') delete state.parameters[definition.name];
      else state.parameters[definition.name] = input.value;
      recordHistory();
    });
    if (definition.conflict || !definition.validName) {
      const issue = element('span', 'parameter-error',
        definition.conflict ? 'Conflicting field types for this name.' : 'Use 1–64 letters, digits, _ or -.');
      row.append(label, detail, input, issue);
    } else {
      row.append(label, detail, input);
    }
    container.append(row);
  }
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
function browserStorage() {
  try { return window.localStorage; } catch { return null; }
}
function useCanvasLayout(catalogId, entityId) {
  state.layoutKey = ExpressionForgeGraphLayout.storageKey(catalogId, entityId);
  state.graphLayout = ExpressionForgeGraphLayout.read(browserStorage(), state.layoutKey);
}
function saveCanvasLayout() {
  ExpressionForgeGraphLayout.write(browserStorage(), state.layoutKey, state.graphLayout);
  recordHistory();
}
function applyGraphEdit(operation) {
  try {
    state.definition = operation();
    state.pendingSourcePath = null;
    state.pendingSourceEntity = null;
    state.expandedNodePath = null;
    render();
    show('Query updated. Validate before execution.', 'success');
  } catch (error) { show(error.message, 'error'); }
}
function renderGraphPreview() {
  const host = $('graph-preview');
  try {
    const projection = ExpressionForgeGraph.project(state.definition, state.catalog,
      { subgraphNodeIds: Array.from(state.graphSubgraphs) });
    state.activeGraphKey = ExpressionForgeGraphPreview.render(host, projection, state.activeGraphKey, (graphKey, node) => {
      if (node?.kind === 'group' && !node.childGraphKey)
        state.graphSubgraphs.add(node.astId || node.path);
      state.activeGraphKey = graphKey;
      renderGraphPreview();
    }, {
      layoutState: state.graphLayout, onLayoutChange: saveCanvasLayout, catalog: state.catalog,
      onCanRemove: path => ExpressionForgeGraphEdit.canRemove(state.definition, state.catalog, path),
      onRemove: path => applyGraphEdit(() =>
        ExpressionForgeGraphEdit.remove(state.definition, state.catalog, path)),
      onInsert: (path, spec) => applyGraphEdit(() =>
        ExpressionForgeGraphEdit.insert(state.definition, state.catalog, path, spec)),
      onCheckReconnect: (source, target) => ExpressionForgeGraphEdit.canReconnect(
        state.definition, state.catalog, source, target),
      expandedPath: state.expandedNodePath, pendingSourcePath: state.pendingSourcePath,
      pendingSourceEntity: state.pendingSourceEntity,
      onExpand: path => {
        state.expandedNodePath = state.expandedNodePath === path ? null : path;
        renderGraphPreview();
      },
      onAdd: (path, spec) => applyGraphEdit(() =>
        ExpressionForgeGraphEdit.append(state.definition, state.catalog, path, spec)),
      onChange: (path, patch) => applyGraphEdit(() =>
        ExpressionForgeGraphEdit.change(state.definition, state.catalog, path, patch)),
      onSource: (path, entityId) => {
        state.pendingSourcePath = path;
        state.pendingSourceEntity = entityId || null;
        renderGraphPreview();
      },
      onReconnect: (source, target) => {
        try {
          const next = ExpressionForgeGraphEdit.reconnect(state.definition, state.catalog, source, target);
          state.pendingSourcePath = null;
          state.pendingSourceEntity = null;
          state.expandedNodePath = null;
          state.definition = next;
          render();
          show('Predicate reconnected within its compatible entity scope.', 'success');
        } catch (error) { show(error.message, 'error'); }
      }
    });
  } catch (error) {
    host.textContent = 'Blueprint preview unavailable: ' + error.message;
  }
}
function setEditorMode(blueprint) {
  state.graphPreview = blueprint;
  $('graph').hidden = blueprint;
  $('graph-preview').hidden = !blueprint;
  $('guided-mode').className = blueprint ? 'button ghost' : 'button secondary';
  $('blueprint-mode').className = blueprint ? 'button secondary' : 'button ghost';
  $('guided-mode').setAttribute('aria-pressed', String(!blueprint));
  $('blueprint-mode').setAttribute('aria-pressed', String(blueprint));
  if (blueprint) renderGraphPreview();
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
  const definitions = ExpressionForgeParameters.discover(state.definition, state.catalog);
  const isBound = definitions.length > 0;
  const payload = isBound
    ? { definition: state.definition, parameters: ExpressionForgeParameters.buildBindings(definitions, state.parameters) }
    : state.definition;
  const route = isBound ? `${endpoint}/bound` : endpoint;
  const response = await fetch(`/api/query/${route}?limit=${encodeURIComponent(limit)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
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
async function activateCatalog(catalogId, imported = null) {
  const response = await fetch(ExpressionForgeCatalogs.metadataUrl(catalogId));
  if (!response.ok) throw new Error(`Cannot load catalog ${catalogId}: HTTP ${response.status}`);
  const metadata = await response.json();
  if (metadata.catalogId !== catalogId)
    throw new Error('Catalog metadata did not match the selected catalog.');

  const draft = state.drafts.get(catalogId);
  const definition = imported
    ? ExpressionForgeCatalogs.importDefinition(imported, metadata)
    : draft?.definition ?? ExpressionForgeCatalogs.makeDefinition(metadata, sample);

  if (state.catalog && state.definition)
    state.drafts.set(state.catalog.catalogId, { definition: structuredClone(state.definition), parameters: { ...state.parameters } });
  state.catalog = metadata;
  state.definition = definition;
  state.history = null;
  state.expandedNodePath = null;
  state.pendingSourcePath = null;
  state.pendingSourceEntity = null;
  useCanvasLayout(catalogId, definition.entity);
  state.activeGraphKey = 'root';
  state.graphSubgraphs.clear();
  state.parameters = imported ? {} : { ...(draft?.parameters ?? {}) };
  $('catalog').value = catalogId;

  const options = metadata.entities.map(item => ({ value: item.id, label: item.displayName }));
  $('entity').replaceWith(Object.assign(select(options, definition.entity, value => {
    state.definition.entity = value;
    state.definition.query = group(value);
    state.expandedNodePath = null;
    state.pendingSourcePath = null;
    state.pendingSourceEntity = null;
    useCanvasLayout(state.catalog.catalogId, value);
    state.history = null;
    state.activeGraphKey = 'root';
    state.graphSubgraphs.clear();
    render(); show('');
  }), { id: 'entity' }));
  $('connection').textContent = `Catalog ${catalogId} · ${metadata.catalogVersion}`;
  render();
}

async function start() {
  $('start-tour').addEventListener('click', () => ExpressionForgeTour.start());
  $('undo-edit').addEventListener('click', () => restoreHistory('undo'));
  $('redo-edit').addEventListener('click', () => restoreHistory('redo'));
  window.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.target.closest('input, textarea, select, [contenteditable]'))
      return;
    const key = event.key.toLowerCase();
    const direction = key === 'z' ? (event.shiftKey ? 'redo' : 'undo') :
      key === 'y' && !event.shiftKey ? 'redo' : null;
    if (!direction) return;
    event.preventDefault();
    restoreHistory(direction);
  });
  refreshHistoryButtons();
  $('guided-mode').addEventListener('click', () => setEditorMode(false));
  $('blueprint-mode').addEventListener('click', () => setEditorMode(true));
  for (const endpoint of ['validate', 'compile', 'preview']) $(endpoint).addEventListener('click', () => perform(endpoint));
  $('reset').addEventListener('click', () => {
    state.definition = ExpressionForgeCatalogs.makeDefinition(state.catalog, sample);
    state.parameters = {};
    state.expandedNodePath = null;
    state.pendingSourcePath = null;
    state.pendingSourceEntity = null;
    state.graphLayout = ExpressionForgeGraphLayout.empty();
    saveCanvasLayout();
    state.activeGraphKey = 'root';
    state.graphSubgraphs.clear();
    render(); show('');
  });
  $('load-json').addEventListener('click', async () => {
    try {
      const value = JSON.parse($('json').value);
      if (!value || !value.query || !['group', 'expression', 'fieldComparison', 'arithmeticComparison', 'collectionExpression', 'not'].includes(value.query.type))
        throw new Error('Load a supported expression tree.');
      const requested = value.catalogId ?? state.catalog.catalogId;
      if (!state.catalogs.some(item => item.id === requested))
        throw new Error('The query references an unavailable catalog.');
      await activateCatalog(requested, value);
      show('JSON loaded in its registered catalog. Validate before execution.', 'success');
    } catch (error) { show(`Invalid JSON: ${error.message}`, 'error'); }
  });
  $('copy-json').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('json').value); show('JSON copied.', 'success'); }
    catch { show('Clipboard access is unavailable. Select and copy the JSON manually.', 'error'); }
  });
  try {
    const response = await fetch('/api/query/catalogs');
    if (!response.ok) throw new Error(`Catalog list failed: HTTP ${response.status}`);
    const listing = await response.json();
    state.catalogs = listing.catalogs;
    if (!state.catalogs.length) throw new Error('No metadata catalogs are available for this user.');
    const initialId = state.catalogs.some(item => item.id === listing.defaultCatalog)
      ? listing.defaultCatalog : state.catalogs[0].id;
    $('catalog').replaceWith(Object.assign(select(
      state.catalogs.map(item => ({ value: item.id, label: item.displayName })),
      initialId,
      async selected => {
        try { await activateCatalog(selected); show(''); }
        catch (error) { $('catalog').value = state.catalog.catalogId; show(error.message, 'error'); }
      }), { id: 'catalog' }));
    await activateCatalog(initialId);
    ExpressionForgeTour.maybeStart();
  } catch (error) { show(error.message, 'error'); $('connection').textContent = 'Metadata unavailable'; }
}
start();
