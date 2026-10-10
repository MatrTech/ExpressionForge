(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExpressionForgeGraph = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';

  const clone = value => JSON.parse(JSON.stringify(value));
  const predicate = (entityId, cardinality = 'single') => ({ kind: 'predicate', entityId, cardinality });
  const supported = new Set(['expression', 'group', 'collectionExpression', 'not']);

  function project(definition, catalog, options = {}) {
    if (!definition || !definition.query || !catalog || !Array.isArray(catalog.entities))
      throw new Error('A query definition and catalog metadata are required.');
    if (!catalog.entities.some(entity => entity.id === definition.entity))
      throw new Error('The query root entity is not available in the selected catalog.');

    const counts = new Map();
    let totalNodes = 0;
    function count(expression, depth = 1) {
      if (depth > 16) throw new Error('Expressions cannot exceed 16 levels of nesting.');
      if (++totalNodes > 256) throw new Error('Expressions cannot exceed 256 nodes.');
      if (!expression || !supported.has(expression.type)) throw new Error('Unsupported or missing AST expression.');
      if (typeof expression.id === 'string' && expression.id) counts.set(expression.id, (counts.get(expression.id) || 0) + 1);
      if (expression.type === 'group') {
        if (!Array.isArray(expression.expressions)) throw new Error('A group requires an expressions array.');
        expression.expressions.forEach(child => count(child, depth + 1));
      } else if (expression.type === 'not' || expression.type === 'collectionExpression') count(expression.expression, depth + 1);
    }
    count(definition.query);

    const collapsed = new Set(options.subgraphNodeIds || []);
    const graphs = [];
    const header = clone(Object.fromEntries(Object.entries(definition).filter(([key]) => key !== 'query')));

    function createGraph(key, parentGraphKey, ownerNodeKey, kind, entityId, cardinality) {
      const rootNodeKey = 'sink:' + key;
      const graph = {
        key, parentGraphKey, ownerNodeKey, kind, entityId, rootNodeKey,
        nodes: [{ key: rootNodeKey, kind: 'sink', entityId, label: 'Output',
          input: predicate(entityId, cardinality), output: null }],
        edges: []
      };
      graphs.push(graph);
      return graph;
    }

    function connect(graph, from, to, inputIndex) {
      graph.edges.push({ from, to, inputIndex });
    }

    function addChildren(expressions, entityId, path, graph, receiverKey) {
      expressions.forEach((expression, index) => {
        const key = visit(expression, entityId, path + '.expressions[' + index + ']', graph);
        connect(graph, key, receiverKey, index);
      });
    }

    function visit(expression, entityId, path, graph) {
      const uniqueId = typeof expression.id === 'string' && expression.id && counts.get(expression.id) === 1;
      const key = uniqueId ? 'id:' + expression.id : 'path:' + path;
      const data = clone(Object.fromEntries(Object.entries(expression).filter(([property]) =>
        property !== 'expressions' && property !== 'expression')));
      const node = {
        key, astId: expression.id || null, path, kind: expression.type, entityId,
        input: expression.type === 'group' ? predicate(entityId, 'many')
          : expression.type === 'not' ? predicate(entityId) : null,
        output: predicate(entityId), data, childGraphKey: null
      };
      graph.nodes.push(node);

      if (expression.type === 'group') {
        if (collapsed.has(expression.id) || collapsed.has(path)) {
          node.input = null;
          node.childGraphKey = 'subgraph:' + key;
          const childGraph = createGraph(node.childGraphKey, graph.key, key, 'logicalGroup', entityId, 'many');
          addChildren(expression.expressions, entityId, path, childGraph, childGraph.rootNodeKey);
        } else {
          addChildren(expression.expressions, entityId, path, graph, key);
        }
      } else if (expression.type === 'not') {
        connect(graph, visit(expression.expression, entityId, path + '.expression', graph), key, 0);
      } else if (expression.type === 'collectionExpression') {
        const metadata = catalog.entities.find(entity => entity.id === entityId);
        const relation = metadata?.relationships?.find(item => item.id === expression.collection);
        const target = relation ? relation.targetEntity : 'unresolved:' + expression.collection;
        node.childGraphKey = 'subgraph:' + key;
        const childGraph = createGraph(node.childGraphKey, graph.key, key, 'collection', target, 'single');
        connect(childGraph, visit(expression.expression, target, path + '.expression', childGraph), childGraph.rootNodeKey, 0);
      }
      return key;
    }

    const root = createGraph('root', null, null, 'root', definition.entity, 'single');
    connect(root, visit(definition.query, definition.entity, '$.query', root), root.rootNodeKey, 0);
    return { header, graphs };
  }

  function canConnect(projection, graphKey, fromKey, toKey, inputIndex) {
    const graph = projection.graphs.find(candidate => candidate.key === graphKey);
    if (!graph) return { valid: false, reason: 'Unknown graph.' };
    const from = graph.nodes.find(node => node.key === fromKey);
    const to = graph.nodes.find(node => node.key === toKey);
    if (!from?.output || !to?.input) return { valid: false, reason: 'A predicate output and input are required.' };
    if (!Number.isSafeInteger(inputIndex) || inputIndex < 0 || (to.input.cardinality === 'single' && inputIndex !== 0))
      return { valid: false, reason: 'Invalid input socket.' };
    if (from.output.kind !== to.input.kind || from.output.entityId !== to.input.entityId)
      return { valid: false, reason: 'Predicate scopes do not match.' };
    if (fromKey === toKey) return { valid: false, reason: 'A node cannot connect to itself.' };
    if (graph.edges.some(edge => edge.from === fromKey))
      return { valid: false, reason: 'An AST node cannot have multiple parents.' };
    if (graph.edges.some(edge => edge.to === toKey && edge.inputIndex === inputIndex))
      return { valid: false, reason: 'The input socket is already occupied.' };

    const pending = [toKey];
    const seen = new Set();
    while (pending.length) {
      const current = pending.pop();
      if (current === fromKey) return { valid: false, reason: 'The connection would create a cycle.' };
      if (seen.has(current)) continue;
      seen.add(current);
      graph.edges.filter(edge => edge.from === current).forEach(edge => pending.push(edge.to));
    }
    return { valid: true, reason: null };
  }

  function toDefinition(projection) {
    for (const graph of projection.graphs) {
      const outputs = new Set();
      const inputs = new Set();
      for (const edge of graph.edges) {
        const from = graph.nodes.find(node => node.key === edge.from);
        const to = graph.nodes.find(node => node.key === edge.to);
        if (!from?.output || !to?.input ||
            from.output.kind !== to.input.kind || from.output.entityId !== to.input.entityId)
          throw new Error('Graph contains an incompatible predicate connection.');
        if (!Number.isSafeInteger(edge.inputIndex) || edge.inputIndex < 0 ||
            (to.input.cardinality === 'single' && edge.inputIndex !== 0))
          throw new Error('Graph contains an invalid input socket.');
        const socketKey = edge.to + ':' + edge.inputIndex;
        if (outputs.has(edge.from) || inputs.has(socketKey))
          throw new Error('Graph cannot share AST nodes or reuse occupied inputs.');
        outputs.add(edge.from);
        inputs.add(socketKey);
      }
    }
    const graphs = new Map(projection.graphs.map(graph => [graph.key, graph]));
    const visited = new Set();

    function inputs(graph, receiverKey, cardinality) {
      const edges = graph.edges.filter(edge => edge.to === receiverKey).sort((a, b) => a.inputIndex - b.inputIndex);
      if (cardinality === 'single' && (edges.length !== 1 || edges[0].inputIndex !== 0))
        throw new Error('A required predicate input is missing or ambiguous.');
      edges.forEach((edge, index) => {
        if (edge.inputIndex !== index) throw new Error('Group input indices must be contiguous and unique.');
      });
      return edges.map(edge => restore(graph, edge.from));
    }

    function childGraph(node, cardinality) {
      const graph = graphs.get(node.childGraphKey);
      if (!graph || graph.ownerNodeKey !== node.key || graph.nodes[0].input.cardinality !== cardinality)
        throw new Error('Invalid or missing subgraph contract.');
      return inputs(graph, graph.rootNodeKey, cardinality);
    }

    function restore(graph, nodeKey) {
      const node = graph.nodes.find(candidate => candidate.key === nodeKey);
      if (!node || node.kind === 'sink' || visited.has(nodeKey))
        throw new Error('Missing, shared, or cyclic AST node.');
      visited.add(nodeKey);
      const expression = clone(node.data);
      if (node.kind === 'group')
        expression.expressions = node.childGraphKey ? childGraph(node, 'many') : inputs(graph, node.key, 'many');
      else if (node.kind === 'not')
        expression.expression = inputs(graph, node.key, 'single')[0];
      else if (node.kind === 'collectionExpression')
        expression.expression = childGraph(node, 'single')[0];
      else if (node.kind !== 'expression')
        throw new Error('Unsupported visual node type.');
      return expression;
    }

    const root = graphs.get('root');
    if (!root || root.kind !== 'root') throw new Error('Missing root graph.');
    const query = inputs(root, root.rootNodeKey, 'single')[0];
    const total = projection.graphs.reduce((sum, graph) => sum + graph.nodes.filter(node => node.kind !== 'sink').length, 0);
    if (visited.size !== total) throw new Error('Unconnected nodes would be lost when exporting the query.');
    return { ...clone(projection.header), query };
  }

  return { project, canConnect, toDefinition };
});
