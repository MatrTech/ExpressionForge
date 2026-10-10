(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExpressionForgeGraphPreview = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';

  function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className || '';
    if (text !== undefined) node.textContent = text;
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
      const value = data.parameter !== undefined ? '@' + data.parameter
        : data.value === undefined ? '' : JSON.stringify(data.value);
      return String(data.field) + ' ' + String(data.operator) + (value ? ' ' + value : '');
    }
    return node.kind;
  }

  function graphDepths(graph) {
    const incoming = new Map();
    for (const edge of graph.edges) {
      if (!incoming.has(edge.to)) incoming.set(edge.to, []);
      incoming.get(edge.to).push(edge.from);
    }
    const depths = new Map();
    function visit(key, depth, trail) {
      if (trail.has(key)) throw new Error('Cyclic graph cannot be displayed.');
      if ((depths.get(key) ?? -1) >= depth) return;
      depths.set(key, depth);
      const nextTrail = new Set(trail);
      nextTrail.add(key);
      for (const parent of incoming.get(key) || []) visit(parent, depth + 1, nextTrail);
    }
    visit(graph.rootNodeKey, 0, new Set());
    return depths;
  }

  function render(host, projection, activeGraphKey, onNavigate) {
    const graphs = new Map(projection.graphs.map(graph => [graph.key, graph]));
    const graph = graphs.get(activeGraphKey) || graphs.get('root');
    if (!graph) throw new Error('No root graph was projected.');
    host.replaceChildren();

    const breadcrumbs = el('nav', 'blueprint-breadcrumbs');
    breadcrumbs.setAttribute('aria-label', 'Subgraph navigation');
    const ancestors = [];
    for (let current = graph; current; current = graphs.get(current.parentGraphKey))
      ancestors.unshift(current);
    ancestors.forEach((item, index) => {
      if (index) breadcrumbs.append(el('span', 'blueprint-separator', '›'));
      const caption = item.kind === 'root' ? projection.header.entity
        : item.kind === 'collection' ? 'Collection predicate' : 'Logical group';
      const link = el('button', 'button small ghost', caption);
      link.type = 'button';
      link.disabled = item.key === graph.key;
      link.addEventListener('click', () => onNavigate(item.key));
      breadcrumbs.append(link);
    });
    host.append(breadcrumbs);

    const scope = el('div', 'blueprint-scope', 'Predicate<' + graph.entityId + '> · ' +
      graph.nodes.filter(node => node.kind !== 'sink').length + ' nodes');
    host.append(scope);

    const depths = graphDepths(graph);
    const maxDepth = Math.max(...depths.values());
    const scroller = el('div', 'blueprint-scroller');
    const columns = el('div', 'blueprint-columns');
    for (let depth = maxDepth; depth >= 0; depth--) {
      if (depth !== maxDepth) columns.append(el('span', 'blueprint-arrow', '→'));
      const column = el('div', 'blueprint-column');
      for (const node of graph.nodes.filter(item => depths.get(item.key) === depth)) {
        const expandable = node.kind === 'group' || Boolean(node.childGraphKey);
        const card = el(expandable ? 'button' : 'div', 'blueprint-card blueprint-' + node.kind);
        if (expandable) {
          card.type = 'button';
          card.addEventListener('click', () => onNavigate(node.childGraphKey || ('subgraph:' + node.key), node));
          card.title = 'Open subgraph';
        }
        const head = el('div', 'blueprint-card-title');
        head.append(el('span', 'blueprint-port', node.kind === 'sink' ? '◉' : '●'));
        head.append(el('strong', '', description(node)));
        if (expandable) head.append(el('span', 'blueprint-open', '↗'));
        card.append(head);
        card.append(el('small', '', node.kind === 'sink' ? 'Destination'
          : node.kind + ' · Predicate<' + node.entityId + '>'));
        column.append(card);
      }
      columns.append(column);
    }
    scroller.append(columns);
    host.append(scroller);
    host.append(el('p', 'blueprint-hint',
      'Read-only projection · Select a group or collection to explore its subgraph. Edit conditions in Guided mode.'));
    return graph.key;
  }

  return { render, graphDepths };
});
