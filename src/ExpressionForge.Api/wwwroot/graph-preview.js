(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExpressionForgeGraphPreview = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';

  const svgNamespace = 'http://www.w3.org/2000/svg';
  const dimensions = { width: 228, height: 88 };
  const $layout = () => {
    const api = typeof globalThis !== 'undefined' ? globalThis.ExpressionForgeGraphLayout : null;
    if (!api) throw new Error('Graph layout module is required.');
    return api;
  };
  function el(tag, className = '', label) {
    const node = document.createElement(tag);
    node.className = className;
    if (label !== undefined) node.textContent = label;
    return node;
  }
  function button(label, title, onclick, className = 'button small ghost') {
    const node = el('button', className, label);
    node.type = 'button';
    node.title = title;
    node.addEventListener('click', onclick);
    return node;
  }
  function numericText(value) {
    if (!value) return '?';
    if (value.type === 'numericField') return String(value.field);
    if (value.type === 'numericLiteral') return String(value.value);
    if (value.type === 'numericParameter') return '@' + String(value.parameter);
    if (value.type === 'stringLength') return 'Length(' + String(value.field) + ')';
    if (value.type === 'tryParseDecimal') return 'Decimal?(' + String(value.field) + ')';
    if (value.type === 'dateDiffDays') return 'Days(' + String(value.startField) + ', ' + String(value.endField) + ')';
    if (value.type === 'numericBinary')
      return '(' + numericText(value.left) + ' ' + value.operator + ' ' + numericText(value.right) + ')';
    return '?';
  }
  function description(node) {
    const data = node.data || {};
    if (node.kind === 'sink') return 'Query result';
    if (node.kind === 'group') return String(data.operator || 'group').toUpperCase();
    if (node.kind === 'not') return 'NOT';
    if (node.kind === 'collectionExpression')
      return String(data.collection || 'Collection') + '.' + String(data.quantifier || 'any').toUpperCase();
    if (node.kind === 'fieldComparison') return String(data.leftField) + ' ' + String(data.operator) + ' ' + String(data.rightField);
    if (node.kind === 'arithmeticComparison') return numericText(data.left) + ' ' + data.operator + ' ' + numericText(data.right);
    if (node.kind === 'expression') {
      const value = data.parameter !== undefined ? '@' + data.parameter :
        data.value === undefined ? '' : JSON.stringify(data.value);
      return String(data.field) + ' ' + String(data.operator) + (value ? ' ' + value : '');
    }
    return node.kind;
  }
  function graphDepths(graph) {
    const depths = new Map();
    const children = new Map();
    for (const edge of graph.edges) {
      if (!children.has(edge.to)) children.set(edge.to, []);
      children.get(edge.to).push(edge.from);
    }
    function visit(key, depth, trail) {
      if (trail.has(key)) throw new Error('Cyclic graph cannot be displayed.');
      if ((depths.get(key) ?? -1) >= depth) return;
      depths.set(key, depth);
      const nextTrail = new Set(trail);
      nextTrail.add(key);
      for (const child of children.get(key) || []) visit(child, depth + 1, nextTrail);
    }
    visit(graph.rootNodeKey, 0, new Set());
    return depths;
  }

  const openedValueTrees = new Set();
  function numericValueEditor(host, expression, meta, predicatePath, options) {
    const api = typeof globalThis !== 'undefined' ? globalThis.ExpressionForgeNumericTree : null;
    if (!api || !options.onValueChange) return;
    const details = el('details', 'blueprint-value-tree');
    const summary = el('summary', '', 'Advanced value tree · compose expressions');
    details.append(summary);
    details.open = openedValueTrees.has(predicatePath);
    details.addEventListener('toggle', () => {
      if (details.open) openedValueTrees.add(predicatePath);
      else openedValueTrees.delete(predicatePath);
    });

    const categories = api.choices(options.catalog, meta.id);
    function selectField(label, path, key, value, fields) {
      const row = el('label', 'blueprint-inspector-field');
      row.append(el('span', '', label));
      const select = el('select', 'control');
      select.setAttribute('aria-label', label + ' ' + path);
      for (const p of fields) {
        const option = el('option', '', p.displayName || p.id);
        option.value = p.id;
        select.append(option);
      }
      select.value = value;
      select.addEventListener('change', () =>
        options.onValueChange(predicatePath, path, { kind: 'set', property: key, value: select.value }));
      row.append(select);
      return row;
    }
    function editableNumber(label, path, key, value, type) {
      const row = el('label', 'blueprint-inspector-field');
      row.append(el('span', '', label));
      const input = el('input', 'control');
      input.type = type;
      if (type === 'number') input.step = 'any';
      input.setAttribute('aria-label', label + ' ' + path);
      input.value = String(value);
      input.addEventListener('change', () => options.onValueChange(predicatePath, path,
        { kind: 'set', property: key, value: type === 'number' ? Number(input.value) : input.value }));
      row.append(input);
      return row;
    }
    function visit(value, path, name, depth = 1) {
      const frame = el('div', 'blueprint-value-node');
      frame.dataset.valuePath = path;
      const kind = el('label', 'blueprint-inspector-field');
      kind.append(el('span', '', name));
      const type = el('select', 'control');
      type.setAttribute('aria-label', name + ' kind ' + path);
      for (const choice of categories) {
        const option = el('option', '', choice.label);
        option.value = choice.type;
        type.append(option);
      }
      type.value = value.type;
      type.addEventListener('change', () => options.onValueChange(predicatePath, path,
        { kind: 'replace', type: type.value }));
      kind.append(type);
      frame.append(kind);

      if (value.type === 'numericBinary') {
        const operations = el('label', 'blueprint-inspector-field');
        operations.append(el('span', '', 'Operation'));
        const select = el('select', 'control');
        select.setAttribute('aria-label', 'Operation ' + path);
        for (const op of api.operators) {
          const option = el('option', '', { add: 'Add (+)', subtract: 'Subtract (−)',
            multiply: 'Multiply (×)', divide: 'Divide (÷)' }[op]);
          option.value = op;
          select.append(option);
        }
        select.value = value.operator;
        select.addEventListener('change', () => options.onValueChange(predicatePath, path,
          { kind: 'set', property: 'operator', value: select.value }));
        operations.append(select);
        frame.append(operations);
        frame.append(visit(value.left, path + '.left', 'Left operand', depth + 1));
        frame.append(visit(value.right, path + '.right', 'Right operand', depth + 1));
      } else if (value.type === 'numericLiteral') {
        frame.append(editableNumber('Number', path, 'value', value.value, 'number'));
      } else if (value.type === 'numericParameter') {
        frame.append(editableNumber('Parameter name', path, 'parameter', value.parameter, 'text'));
      } else if (['numericField','stringLength','tryParseDecimal'].includes(value.type)) {
        const eligible = meta.properties.filter(p => value.type === 'numericField' ?
          ['integer','decimal'].includes(p.dataType) : p.dataType === 'string');
        frame.append(selectField('Field', path, 'field', value.field, eligible));
      } else if (value.type === 'dateDiffDays') {
        const startType = meta.properties.find(p => p.id === value.startField)?.dataType;
        const eligible = meta.properties.filter(p => p.dataType === startType &&
          ['date','dateTime'].includes(p.dataType));
        frame.append(selectField('Start date', path, 'startField', value.startField, eligible));
        frame.append(selectField('End date', path, 'endField', value.endField, eligible));
      }

      const actions = el('div', 'blueprint-value-actions');
      if (depth < 13) actions.append(button('+ Wrap in calculation',
        'Use this value as the left side of a new calculation', () =>
          options.onValueChange(predicatePath, path, { kind: 'wrap', operator: 'add' })));
      if (value.type === 'numericBinary') actions.append(button('− Unwrap',
        'Replace the calculation with its left operand', () =>
          options.onValueChange(predicatePath, path, { kind: 'unwrap' })));
      frame.append(actions);
      return frame;
    }
    details.append(visit(expression.left, 'left', 'Left value'), visit(expression.right, 'right', 'Right value'));
    host.append(details);
  }

  function render(host, projection, activeGraphKey, onNavigate, options = {}) {
    const graphs = new Map(projection.graphs.map(graph => [graph.key, graph]));
    const graph = graphs.get(activeGraphKey) || graphs.get('root');
    if (!graph) throw new Error('No root graph was projected.');
    const helper = $layout();
    const state = options.layoutState || helper.empty();
    const reportChange = options.onLayoutChange || (() => {});
    const edit = typeof globalThis !== 'undefined' ? globalThis.ExpressionForgeGraphEdit : null;
    const available = edit?.options(options.catalog, graph.entityId) || [];
    const graphOwner = graph.ownerNodeKey && graphs.get(graph.parentGraphKey)?.nodes.find(n => n.key === graph.ownerNodeKey);
    const addPath = graph.kind === 'root' ? '$.query'
      : graph.kind === 'collection' ? graphOwner?.path + '.expression' : graphOwner?.path;
    host.replaceChildren();

    const navigation = el('nav', 'blueprint-breadcrumbs');
    navigation.setAttribute('aria-label', 'Subgraph navigation');
    const chain = [];
    for (let current = graph; current; current = graphs.get(current.parentGraphKey)) chain.unshift(current);
    chain.forEach((item, index) => {
      if (index) navigation.append(el('span', 'blueprint-separator', '›'));
      const parent = graphs.get(item.parentGraphKey);
      const owner = parent?.nodes.find(node => node.key === item.ownerNodeKey);
      const label = item.kind === 'root' ? projection.header.entity : owner ? description(owner) : item.kind;
      const link = button(label, 'Navigate to ' + label, () => onNavigate(item.key));
      link.disabled = item.key === graph.key;
      navigation.append(link);
    });
    host.append(navigation);

    const bar = el('div', 'blueprint-toolbar');
    const scope = el('span', 'blueprint-scope', 'Predicate<' + graph.entityId + '> · ' +
      graph.nodes.filter(node => node.kind !== 'sink').length + ' nodes');
    const actions = el('div', 'blueprint-toolbar-actions');
    const zoomLabel = el('output', 'blueprint-zoom', '100%');
    const palette = el('div', 'blueprint-palette');
    const chooser = el('select', 'control blueprint-palette-select');
    chooser.setAttribute('aria-label', 'Choose a field, collection, or logical group');
    available.forEach((spec, index) => {
      const option = el('option', '', spec.label);
      option.value = String(index);
      chooser.append(option);
    });
    const add = button('+ Add condition', 'Create and connect a typed predicate', () => {
      const spec = available[Number(chooser.value)];
      if (spec && addPath) options.onAdd?.(addPath, spec);
    }, 'button small primary');
    add.disabled = !available.length || !addPath;
    chooser.disabled = !available.length;
    palette.append(chooser, add);
    if (options.pendingSourcePath) {
      palette.append(button('Cancel connection', 'Cancel pending connection', () => options.onSource?.(null),
        'button small secondary'));
    }
    const insertBar = el('div', 'blueprint-insert-bar');
    insertBar.hidden = true;
    const insertTitle = el('strong', '', 'Insert on connection');
    const insertFields = available.filter(candidate => candidate.kind === 'expression');
    const insertField = el('select', 'control');
    insertField.setAttribute('aria-label', 'Field to insert on connection');
    for (const candidate of insertFields) {
      const option = el('option', '', candidate.label);
      option.value = candidate.field;
      insertField.append(option);
    }
    const insertLogic = el('select', 'control');
    insertLogic.setAttribute('aria-label', 'Logical operation for inserted predicate');
    for (const [id, label] of [['and', 'AND with field'], ['or', 'OR with field']]) {
      const option = el('option', '', label);
      option.value = id;
      insertLogic.append(option);
    }
    let insertPath = null;
    const applyInsert = spec => {
      if (insertPath) options.onInsert?.(insertPath, spec);
    };
    const insertAdd = button('Insert', 'Insert selected condition on connection', () =>
      applyInsert({ operator: insertLogic.value, field: insertField.value }), 'button small primary');
    insertAdd.disabled = insertFields.length === 0;
    insertBar.append(insertTitle, insertLogic, insertField, insertAdd,
      button('Wrap in NOT', 'Negate the existing predicate', () => applyInsert({ kind: 'not' })),
      button('Cancel', 'Close insertion palette', () => { insertBar.hidden = true; insertPath = null; }));
    bar.append(scope, palette, actions);
    host.append(bar, insertBar);

    const viewport = el('div', 'blueprint-viewport');
    viewport.setAttribute('aria-label', 'Interactive Blueprint canvas. Drag nodes or background to move; scroll to zoom.');
    viewport.setAttribute('role', 'region');
    const scene = el('div', 'blueprint-scene');
    const wires = document.createElementNS(svgNamespace, 'svg');
    wires.setAttribute('class', 'blueprint-wires');
    wires.setAttribute('aria-hidden', 'true');
    scene.append(wires);
    const wireControls = el('div', 'blueprint-wire-controls');
    scene.append(wireControls);
    const wireButtons = [];
    const cards = new Map();
    for (const node of graph.nodes) {
      const card = el('div', 'blueprint-card blueprint-' + node.kind);
      card.tabIndex = 0;
      card.dataset.nodeKey = node.key;
      card.setAttribute('aria-label', description(node) + '. Drag to reposition; use arrow keys to move.');
      const head = el('div', 'blueprint-card-title');
      if (node.input) {
        if (node.kind === 'group' || (node.kind === 'sink' && graph.kind === 'logicalGroup')) {
          const targetPath = node.kind === 'sink' ? graphOwner.path : node.path;
          const input = button('●', 'Attach selected predicate to ' + description(node), () => {
            if (options.pendingSourcePath) options.onReconnect?.(options.pendingSourcePath, targetPath);
          }, 'blueprint-socket-input');
          input.setAttribute('aria-label', 'Connect to ' + description(node));
          input.dataset.targetPath = targetPath;
          input.dataset.entityId = node.entityId;
          input.disabled = Boolean(options.pendingSourcePath) &&
            options.pendingSourceEntity !== node.entityId;
          head.append(input);
        } else head.append(el('span', 'blueprint-in-port', '●'));
      }
      head.append(el('strong', 'blueprint-label', description(node)));
      if (node.output) {
        const receiverKey = graph.edges.find(edge => edge.from === node.key)?.to;
        const receiver = graph.nodes.find(item => item.key === receiverKey);
        const movable = receiver?.kind === 'group' ||
          (receiver?.kind === 'sink' && graph.kind === 'logicalGroup');
        const output = button('●', movable ? 'Drag to a compatible group socket, or click to select' :
          'This predicate belongs to a single-input expression', event => {
            if (event.detail === 0) options.onSource?.(node.path, node.entityId);
          }, 'blueprint-socket-output');
        output.dataset.sourcePath = node.path;
        output.dataset.entityId = node.entityId;
        output.dataset.nodeKey = node.key;
        output.disabled = !movable;
        output.setAttribute('aria-label', 'Select output from ' + description(node));
        if (options.pendingSourcePath === node.path) output.classList.add('blueprint-socket-selected');
        head.append(output);
      }
      card.append(head, el('small', '', node.kind === 'sink' ? 'Destination' :
        node.kind + ' · Predicate<' + node.entityId + '>'));

      if (node.kind !== 'sink') {
        const expand = button('⌄', 'Edit ' + description(node),
          () => options.onExpand?.(node.path), 'blueprint-expand');
        expand.setAttribute('aria-label', 'Edit ' + description(node));
        expand.setAttribute('aria-expanded', String(options.expandedPath === node.path));
        card.append(expand);
      }
      if (node.childGraphKey || node.kind === 'group') {
        const go = button('↗', 'Open ' + description(node) + ' subgraph',
          () => onNavigate(node.childGraphKey || 'subgraph:' + node.key, node), 'blueprint-enter');
        go.setAttribute('aria-label', 'Open ' + description(node) + ' subgraph');
        card.append(go);
      }
      scene.append(card);
      cards.set(node.key, card);
    }
    viewport.append(scene);
    host.append(viewport);

    const hint = el('p', 'blueprint-hint',
      'Add a condition from the metadata palette. Use ⌄ to edit, sockets ● to reattach predicates, ↗ for subgraphs.');
    host.append(hint);

    const selected = graph.nodes.find(node => node.path && node.path === options.expandedPath);
    if (selected && edit && options.catalog) {
      const inspector = el('section', 'blueprint-inline-inspector');
      inspector.setAttribute('aria-label', 'Edit selected predicate');
      inspector.append(el('strong', '', 'Edit · ' + description(selected)));
      const canRemove = options.onCanRemove?.(selected.path) ?? false;
      const remove = button('Delete predicate', 'Remove this predicate and all its children', () => {
        if (window.confirm('Delete this predicate and all nested conditions?'))
          options.onRemove?.(selected.path);
      }, 'button small danger');
      remove.disabled = !canRemove;
      if (!canRemove) remove.title = 'The root and sole child predicates cannot be removed.';
      inspector.append(remove);
      const item = selected.data || {};
      const meta = options.catalog.entities.find(e => e.id === selected.entityId);
      function control(label, choices, value, action) {
        const row = el('label', 'blueprint-inspector-field');
        row.append(el('span', '', label));
        const select = el('select', 'control');
        for (const [id, title] of choices) {
          const entry = el('option', '', title);
          entry.value = id;
          select.append(entry);
        }
        select.value = value;
        select.addEventListener('change', () => action(select.value));
        row.append(select);
        inspector.append(row);
      }
      const change = (kind, value) => options.onChange?.(selected.path, { kind, value });
      if (selected.kind === 'group')
        control('Logic', [['and', 'AND'], ['or', 'OR']], item.operator, value => change('operator', value));
      if (selected.kind === 'collectionExpression')
        control('Quantifier', [['any', 'Any'], ['all', 'All'], ['none', 'None']],
          item.quantifier, value => change('quantifier', value));
      if (selected.kind === 'arithmeticComparison' && meta) {
        const left = item.left;
        if (left?.type === 'numericBinary' && left.left?.type === 'numericField' &&
          ['numericLiteral', 'numericParameter'].includes(left.right?.type) &&
          ['numericLiteral', 'numericParameter'].includes(item.right?.type)) {
          const numeric = meta.properties.filter(p => ['integer', 'decimal'].includes(p.dataType));
          control('Field', numeric.map(p => [p.id, p.displayName || p.id]), left.left.field,
            value => change('numericField', value));
          control('Calculate', [['add', 'Add (+)'], ['subtract', 'Subtract (−)'], ['multiply', 'Multiply (×)'], ['divide', 'Divide (÷)']],
            left.operator, value => change('numericOperator', value));
          control('Compare', ['equals','notEquals','greaterThan','greaterThanOrEqual','lessThan','lessThanOrEqual']
            .map(op => [op, op]), item.operator, value => change('numericComparator', value));
          function numericInput(label, value, kind) {
            control(label + ' source', [['literal', 'Fixed value'], ['parameter', 'Runtime parameter']],
              value.type === 'numericLiteral' ? 'literal' : 'parameter',
              source => change(kind + 'Mode', source));
            const row = el('label', 'blueprint-inspector-field');
            row.append(el('span', '', value.type === 'numericLiteral' ? label : label + ' parameter name'));
            const input = el('input', 'control');
            input.type = value.type === 'numericLiteral' ? 'number' : 'text';
            if (input.type === 'number') input.step = 'any';
            input.value = String(value.type === 'numericLiteral' ? value.value : value.parameter);
            input.addEventListener('change', () => change(value.type === 'numericLiteral' ? kind : kind + 'Parameter',
              value.type === 'numericLiteral' ? Number(input.value) : input.value));
            row.append(input);
            inspector.append(row);
          }
          numericInput('Operand', left.right, 'numericOperand');
          numericInput('Threshold', item.right, 'numericThreshold');
        } else if (['stringLength', 'dateDiffDays'].includes(left?.type) && item.right?.type === 'numericLiteral') {
          if (left.type === 'stringLength') {
            control('Text field', meta.properties.filter(p => p.dataType === 'string')
              .map(p => [p.id, p.displayName || p.id]), left.field, value => change('stringField', value));
          } else {
            const startType = meta.properties.find(p => p.id === left.startField)?.dataType;
            const dates = meta.properties.filter(p => p.dataType === startType && ['date','dateTime'].includes(p.dataType));
            control('Start date', dates.map(p => [p.id, p.displayName || p.id]),
              left.startField, value => change('startDateField', value));
            control('End date', dates.map(p => [p.id, p.displayName || p.id]),
              left.endField, value => change('endDateField', value));
          }
          control('Compare', ['equals','notEquals','greaterThan','greaterThanOrEqual','lessThan','lessThanOrEqual']
            .map(op => [op, op]), item.operator, value => change('numericComparator', value));
          const threshold = el('label', 'blueprint-inspector-field');
          threshold.append(el('span', '', 'Threshold'));
          const input = el('input', 'control');
          input.type = 'number';
          input.step = 'any';
          input.value = String(item.right.value);
          input.addEventListener('change', () => change('numericThreshold', Number(input.value)));
          threshold.append(input);
          inspector.append(threshold);
        } else {
          inspector.append(el('p', 'blueprint-hint', 'This nested value expression can be edited in JSON mode.'));
        }
      }
      if (selected.kind === 'arithmeticComparison' && meta)
        numericValueEditor(inspector, item, meta, selected.path, options);
      if (selected.kind === 'fieldComparison' && meta) {
        const left = meta.properties.find(property => property.id === item.leftField);
        const right = meta.properties.find(property => property.id === item.rightField);
        const allowed = (candidate, other) => candidate.dataType === other?.dataType &&
          candidate.operators.some(op => other.operators.includes(op) &&
            (['equals', 'notEquals'].includes(op) ||
              (['integer', 'decimal'].includes(candidate.dataType) &&
                ['greaterThan', 'greaterThanOrEqual', 'lessThan', 'lessThanOrEqual'].includes(op))));
        if (left && right) {
          control('Left field', meta.properties.filter(p => allowed(p, right)).map(p => [p.id, p.displayName || p.id]),
            item.leftField, value => change('leftField', value));
          control('Right field', meta.properties.filter(p => allowed(left, p)).map(p => [p.id, p.displayName || p.id]),
            item.rightField, value => change('rightField', value));
          const permitted = left.operators.filter(op => right.operators.includes(op) &&
            (['equals', 'notEquals'].includes(op) ||
              (['integer', 'decimal'].includes(left.dataType) &&
                ['greaterThan', 'greaterThanOrEqual', 'lessThan', 'lessThanOrEqual'].includes(op))));
          control('Operator', permitted.map(op => [op, options.catalog.operators?.find(x => x.id === op)?.displayName || op]),
            item.operator, value => change('operator', value));
        }
      }
      if (selected.kind === 'expression' && meta) {
        const property = meta.properties.find(p => p.id === item.field);
        control('Field', meta.properties.filter(p => p.operators?.length).map(p => [p.id, p.displayName || p.id]),
          item.field, value => change('field', value));
        if (property) {
          control('Operator', property.operators.map(id =>
            [id, options.catalog.operators?.find(op => op.id === id)?.displayName || id]),
          item.operator, value => change('operator', value));
          if (!['isNull', 'isNotNull'].includes(item.operator)) {
            control('Value source', [['literal', 'Fixed value'], ['parameter', 'Runtime parameter']],
              item.parameter === undefined ? 'literal' : 'parameter',
              value => change(value === 'literal' ? 'literal' : 'parameter',
                value === 'parameter' ? 'parameter_' + Math.random().toString(36).slice(2, 9) : null));
            const row = el('label', 'blueprint-inspector-field');
            row.append(el('span', '', item.parameter === undefined ? 'Value' : 'Parameter name'));
            const value = item.parameter === undefined && property.dataType === 'boolean'
              ? el('select', 'control') : el('input', 'control');
            if (value.tagName === 'SELECT') {
              for (const [id, title] of [['true', 'True'], ['false', 'False']]) {
                const option = el('option', '', title);
                option.value = id;
                value.append(option);
              }
              value.value = String(item.value);
            } else {
              value.type = item.parameter === undefined && ['integer', 'decimal'].includes(property.dataType)
                ? 'number' : 'text';
              if (value.type === 'number') value.step = property.dataType === 'integer' ? '1' : 'any';
              value.value = item.parameter ?? item.value ?? '';
            }
            value.addEventListener('change', () => {
              const next = item.parameter !== undefined ? value.value :
                property.dataType === 'boolean' ? value.value === 'true' :
                ['integer', 'decimal'].includes(property.dataType) ? Number(value.value) : value.value;
              change(item.parameter === undefined ? 'value' : 'parameter', next);
            });
            row.append(value);
            inspector.append(row);
          }
        }
      }
      host.append(inspector);
    }
    const layout = helper.ensure(state, graph, viewport.clientWidth || 700, viewport.clientHeight || 460);
    for (const edge of graph.edges) {
      const source = graph.nodes.find(node => node.key === edge.from);
      if (!source?.path) continue;
      const addWire = button('+', 'Insert an expression on the connection from ' + description(source),
        () => {
          insertPath = source.path;
          insertBar.hidden = false;
          insertField.focus();
        }, 'blueprint-wire-add');
      addWire.setAttribute('aria-label', 'Insert on connection after ' + description(source));
      wireControls.append(addWire);
      wireButtons.push({ edge, button: addWire });
    }

    function draw() {
      const view = layout.viewport;
      scene.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.zoom + ')';
      zoomLabel.textContent = Math.round(view.zoom * 100) + '%';
      for (const [key, card] of cards) {
        const p = layout.positions[key];
        card.style.transform = 'translate(' + p.x + 'px,' + p.y + 'px)';
      }
      wires.replaceChildren();
      const incomingCounts = new Map();
      for (const edge of graph.edges) incomingCounts.set(edge.to, (incomingCounts.get(edge.to) || 0) + 1);
      for (const { edge, button: addWire } of wireButtons) {
        const from = layout.positions[edge.from], to = layout.positions[edge.to];
        addWire.style.transform = 'translate(' +
          ((from.x + dimensions.width + to.x) / 2 - 13) + 'px,' +
          ((from.y + to.y + dimensions.height) / 2 - 13) + 'px)';
      }
      for (const edge of graph.edges) {
        const source = layout.positions[edge.from];
        const target = layout.positions[edge.to];
        const count = incomingCounts.get(edge.to);
        const spread = count > 1 ? (edge.inputIndex - (count - 1) / 2) * Math.min(15, 48 / (count - 1)) : 0;
        const startX = source.x + dimensions.width;
        const startY = source.y + dimensions.height / 2;
        const endX = target.x;
        const endY = target.y + dimensions.height / 2 + spread;
        const bend = Math.max(42, Math.abs(endX - startX) * .45);
        const path = document.createElementNS(svgNamespace, 'path');
        path.setAttribute('d', 'M ' + startX + ' ' + startY + ' C ' + (startX + bend) + ' ' +
          startY + ' ' + (endX - bend) + ' ' + endY + ' ' + endX + ' ' + endY);
        path.setAttribute('class', 'blueprint-wire');
        wires.append(path);
      }
    }
    const commit = () => reportChange(state);
    function fitView(resetPositions) {
      if (resetPositions) layout.positions = helper.defaults(graph);
      layout.viewport = helper.fit(layout.positions, viewport.clientWidth || 700, viewport.clientHeight || 460);
      draw();
      commit();
    }
    function stepZoom(factor, point) {
      const center = point || { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
      layout.viewport = helper.zoomAt(layout.viewport, center.x, center.y, factor);
      draw();
      commit();
    }
    actions.append(button('−', 'Zoom out', () => stepZoom(1 / 1.2)),
      zoomLabel, button('+', 'Zoom in', () => stepZoom(1.2)),
      button('Fit', 'Fit all nodes to viewport', () => fitView(false)),
      button('Reset layout', 'Restore automatic positions', () => fitView(true)));
    viewport.addEventListener('wheel', event => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      stepZoom(event.deltaY < 0 ? 1.12 : 1 / 1.12, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    }, { passive: false });

    let gesture = null;
    let hoveredSocket = null;
    const socketAt = (x, y) => document.elementFromPoint(x, y)?.closest('.blueprint-socket-input');
    viewport.addEventListener('pointerdown', event => {
      const output = event.target.closest('.blueprint-socket-output');
      if (event.button === 0 && output && !output.disabled) {
        gesture = {
          type: 'wire', pointerId: event.pointerId, x: event.clientX, y: event.clientY,
          key: output.dataset.nodeKey, sourcePath: output.dataset.sourcePath,
          entityId: output.dataset.entityId, changed: false
        };
        viewport.setPointerCapture(event.pointerId);
        viewport.classList.add('blueprint-dragging-wire');
        event.preventDefault();
        return;
      }
      if ((event.button !== 0 && event.button !== 1) ||
        event.target.closest('button, select, input, textarea, label')) return;
      const card = event.target.closest('.blueprint-card');
      const key = card?.dataset.nodeKey;
      gesture = {
        pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        type: key ? 'node' : 'pan', key,
        from: key ? { ...layout.positions[key] } : { ...layout.viewport },
        changed: false
      };
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add('blueprint-dragging');
      event.preventDefault();
    });
    viewport.addEventListener('pointermove', event => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (!dx && !dy) return;
      gesture.changed = true;
      if (gesture.type === 'wire') {
        hoveredSocket?.classList.remove('blueprint-drop-valid', 'blueprint-drop-invalid');
        hoveredSocket = socketAt(event.clientX, event.clientY);
        if (hoveredSocket) {
          const status = options.onCheckReconnect?.(gesture.sourcePath, hoveredSocket.dataset.targetPath);
          hoveredSocket.classList.add(status?.valid ? 'blueprint-drop-valid' : 'blueprint-drop-invalid');
        }
        const source = layout.positions[gesture.key];
        const bounds = viewport.getBoundingClientRect();
        const endX = (event.clientX - bounds.left - layout.viewport.x) / layout.viewport.zoom;
        const endY = (event.clientY - bounds.top - layout.viewport.y) / layout.viewport.zoom;
        const startX = source.x + dimensions.width, startY = source.y + dimensions.height / 2;
        if (!gesture.line) {
          gesture.line = document.createElementNS(svgNamespace, 'path');
          gesture.line.setAttribute('class', 'blueprint-wire blueprint-wire-pending');
          wires.append(gesture.line);
        }
        gesture.line.setAttribute('d', 'M ' + startX + ' ' + startY +
          ' C ' + (startX + 80) + ' ' + startY + ' ' + (endX - 80) + ' ' + endY +
          ' ' + endX + ' ' + endY);
        return;
      }
      if (gesture.type === 'node') {
        layout.positions[gesture.key] = {
          x: Math.max(-100000, Math.min(100000, gesture.from.x + dx / layout.viewport.zoom)),
          y: Math.max(-100000, Math.min(100000, gesture.from.y + dy / layout.viewport.zoom))
        };
      } else {
        layout.viewport = { ...gesture.from, x: gesture.from.x + dx, y: gesture.from.y + dy };
      }
      draw();
    });
    function endGesture(event, cancelled = false) {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const finished = gesture;
      gesture = null;
      viewport.classList.remove('blueprint-dragging', 'blueprint-dragging-wire');
      hoveredSocket?.classList.remove('blueprint-drop-valid', 'blueprint-drop-invalid');
      hoveredSocket = null;
      finished.line?.remove();
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      if (cancelled) return;
      if (finished.type === 'wire') {
        if (!finished.changed) {
          options.onSource?.(finished.sourcePath, finished.entityId);
          return;
        }
        const target = socketAt(event.clientX, event.clientY);
        if (!target) return;
        const status = options.onCheckReconnect?.(finished.sourcePath, target.dataset.targetPath);
        if (status?.valid) options.onReconnect?.(finished.sourcePath, target.dataset.targetPath);
        else if (status?.reason) hint.textContent = status.reason;
        return;
      }
      if (finished.changed) commit();
    }
    viewport.addEventListener('pointerup', event => endGesture(event));
    viewport.addEventListener('pointercancel', event => endGesture(event, true));
    viewport.addEventListener('lostpointercapture', event => endGesture(event, true));

    for (const [key, card] of cards) card.addEventListener('keydown', event => {
      if (event.target !== card || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      const distance = event.shiftKey ? 40 : 10;
      const offsets = { ArrowUp: [0, -distance], ArrowDown: [0, distance],
        ArrowLeft: [-distance, 0], ArrowRight: [distance, 0] };
      const [dx, dy] = offsets[event.key];
      helper.move(layout.positions, key, dx, dy, 1);
      event.preventDefault();
      draw();
      commit();
    });
    draw();
    return graph.key;
  }

  return { render, graphDepths, description };
});
