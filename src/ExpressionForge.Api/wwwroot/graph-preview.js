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
  function description(node) {
    const data = node.data || {};
    if (node.kind === 'sink') return 'Query result';
    if (node.kind === 'group') return String(data.operator || 'group').toUpperCase();
    if (node.kind === 'not') return 'NOT';
    if (node.kind === 'collectionExpression')
      return String(data.collection || 'Collection') + '.' + String(data.quantifier || 'any').toUpperCase();
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
    bar.append(scope, palette, actions);
    host.append(bar);

    const viewport = el('div', 'blueprint-viewport');
    viewport.setAttribute('aria-label', 'Interactive Blueprint canvas. Drag nodes or background to move; scroll to zoom.');
    viewport.setAttribute('role', 'region');
    const scene = el('div', 'blueprint-scene');
    const wires = document.createElementNS(svgNamespace, 'svg');
    wires.setAttribute('class', 'blueprint-wires');
    wires.setAttribute('aria-hidden', 'true');
    scene.append(wires);
    const cards = new Map();
    for (const node of graph.nodes) {
      const card = el('div', 'blueprint-card blueprint-' + node.kind);
      card.tabIndex = 0;
      card.dataset.nodeKey = node.key;
      card.setAttribute('aria-label', description(node) + '. Drag to reposition; use arrow keys to move.');
      const head = el('div', 'blueprint-card-title');
      if (node.input) {
        if (node.kind === 'group') {
          const input = button('●', 'Attach selected predicate to ' + description(node), () => {
            if (options.pendingSourcePath) options.onReconnect?.(options.pendingSourcePath, node.path);
          }, 'blueprint-socket-input');
          input.setAttribute('aria-label', 'Connect to ' + description(node));
          input.disabled = !options.pendingSourcePath || options.pendingSourceEntity !== node.entityId;
          head.append(input);
        } else head.append(el('span', 'blueprint-in-port', '●'));
      }
      head.append(el('strong', 'blueprint-label', description(node)));
      if (node.output) {
        const receiverKey = graph.edges.find(edge => edge.from === node.key)?.to;
        const receiver = graph.nodes.find(item => item.key === receiverKey);
        const movable = receiver?.kind === 'group' ||
          (receiver?.kind === 'sink' && graph.kind === 'logicalGroup');
        const output = button('●', movable ? 'Select predicate output for reconnection' :
          'This predicate belongs to a single-input expression', () =>
          options.onSource?.(node.path, node.entityId), 'blueprint-socket-output');
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
    viewport.addEventListener('pointerdown', event => {
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
    function endGesture(event) {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const changed = gesture.changed;
      gesture = null;
      viewport.classList.remove('blueprint-dragging');
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      if (changed) commit();
    }
    viewport.addEventListener('pointerup', endGesture);
    viewport.addEventListener('pointercancel', endGesture);
    viewport.addEventListener('lostpointercapture', endGesture);

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
