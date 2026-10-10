(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExpressionForgeGraphLayout = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';

  const NODE_WIDTH = 228;
  const NODE_HEIGHT = 88;
  const COLUMN_STEP = 320;
  const ROW_STEP = 138;
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 2.2;
  const MAX_COORDINATE = 100000;
  const STORAGE_PREFIX = 'expressionforge:blueprint:v1:';

  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const bounded = value => finite(value) && Math.abs(value) <= MAX_COORDINATE;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const empty = () => ({ version: 1, graphs: {} });

  function defaults(graph) {
    const nodes = new Map(graph.nodes.map(node => [node.key, node]));
    const incoming = new Map();
    for (const edge of graph.edges) {
      if (!nodes.has(edge.from) || !nodes.has(edge.to)) throw new Error('Invalid edge endpoint.');
      if (!incoming.has(edge.to)) incoming.set(edge.to, []);
      incoming.get(edge.to).push(edge);
    }
    for (const edges of incoming.values()) edges.sort((a, b) => a.inputIndex - b.inputIndex);
    const depths = new Map();
    function depth(key, level, path) {
      if (path.has(key)) throw new Error('Cannot layout a cyclic graph.');
      if ((depths.get(key) ?? -1) >= level) return;
      depths.set(key, level);
      const next = new Set(path);
      next.add(key);
      for (const edge of incoming.get(key) || []) depth(edge.from, level + 1, next);
    }
    depth(graph.rootNodeKey, 0, new Set());
    if (depths.size !== graph.nodes.length) throw new Error('Cannot layout disconnected graph nodes.');

    const maxDepth = Math.max(...depths.values());
    const positions = {};
    let row = 0;
    function arrange(key) {
      const children = (incoming.get(key) || []).map(edge => edge.from);
      const rows = children.map(arrange);
      const center = rows.length ? (Math.min(...rows) + Math.max(...rows)) / 2 : row++;
      positions[key] = {
        x: 56 + (maxDepth - depths.get(key)) * COLUMN_STEP,
        y: 50 + center * ROW_STEP
      };
      return center;
    }
    arrange(graph.rootNodeKey);
    return positions;
  }

  function bounds(positions) {
    const items = Object.values(positions);
    if (!items.length) return { minX: 0, minY: 0, maxX: NODE_WIDTH, maxY: NODE_HEIGHT };
    return {
      minX: Math.min(...items.map(p => p.x)),
      minY: Math.min(...items.map(p => p.y)),
      maxX: Math.max(...items.map(p => p.x + NODE_WIDTH)),
      maxY: Math.max(...items.map(p => p.y + NODE_HEIGHT))
    };
  }

  function fit(positions, width, height) {
    const box = bounds(positions);
    const w = Math.max(1, width || 640);
    const h = Math.max(1, height || 440);
    const scale = clamp(Math.min((w - 70) / Math.max(1, box.maxX - box.minX),
      (h - 70) / Math.max(1, box.maxY - box.minY)), MIN_ZOOM, 1.1);
    const zoom = scale;
    return {
      x: (w - (box.minX + box.maxX) * zoom) / 2,
      y: (h - (box.minY + box.maxY) * zoom) / 2,
      zoom
    };
  }

  function ensure(state, graph, width, height) {
    if (!state || state.version !== 1 || !state.graphs) throw new Error('Invalid editor layout state.');
    const generated = defaults(graph);
    if (!Object.hasOwn(state.graphs, graph.key)) state.graphs[graph.key] = { positions: {}, viewport: null };
    const layout = state.graphs[graph.key];
    const validKeys = new Set(graph.nodes.map(node => node.key));
    for (const key of Object.keys(layout.positions)) if (!validKeys.has(key)) delete layout.positions[key];
    for (const [key, position] of Object.entries(generated)) {
      if (!layout.positions[key] || !bounded(layout.positions[key].x) || !bounded(layout.positions[key].y))
        layout.positions[key] = position;
    }
    if (!layout.viewport) layout.viewport = fit(layout.positions, width, height);
    return layout;
  }

  function zoomAt(viewport, screenX, screenY, factor) {
    const zoom = clamp(viewport.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const ratio = zoom / viewport.zoom;
    return {
      x: screenX - (screenX - viewport.x) * ratio,
      y: screenY - (screenY - viewport.y) * ratio,
      zoom
    };
  }

  function move(positions, nodeKey, deltaX, deltaY, zoom) {
    const old = positions[nodeKey];
    if (!old || !finite(deltaX) || !finite(deltaY) || !finite(zoom) || zoom <= 0)
      throw new Error('Cannot move an unknown node or use an invalid offset.');
    positions[nodeKey] = {
      x: clamp(old.x + deltaX / zoom, -MAX_COORDINATE, MAX_COORDINATE),
      y: clamp(old.y + deltaY / zoom, -MAX_COORDINATE, MAX_COORDINATE)
    };
    return positions[nodeKey];
  }

  function storageKey(catalogId, entityId) {
    return STORAGE_PREFIX + encodeURIComponent(catalogId) + ':' + encodeURIComponent(entityId);
  }

  function read(storage, key) {
    if (!storage) return empty();
    try {
      const raw = storage.getItem(key);
      if (!raw || raw.length > 500000) return empty();
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !parsed.graphs || typeof parsed.graphs !== 'object') return empty();
      const clean = empty();
      for (const [graphKey, layout] of Object.entries(parsed.graphs).slice(0, 128)) {
        if (!graphKey || graphKey.length > 512 || !layout || typeof layout !== 'object') continue;
        const positions = {};
        for (const [nodeKey, point] of Object.entries(layout.positions || {}).slice(0, 512)) {
          if (nodeKey.length <= 512 && point && bounded(point.x) && bounded(point.y))
            Object.defineProperty(positions, nodeKey, { value: { x: point.x, y: point.y }, enumerable: true, writable: true, configurable: true });
        }
        const viewport = layout.viewport;
        const validViewport = viewport && bounded(viewport.x) && bounded(viewport.y) &&
          finite(viewport.zoom) && viewport.zoom >= MIN_ZOOM && viewport.zoom <= MAX_ZOOM;
        Object.defineProperty(clean.graphs, graphKey, {
          value: { positions, viewport: validViewport ? { x: viewport.x, y: viewport.y, zoom: viewport.zoom } : null },
          enumerable: true, writable: true, configurable: true
        });
      }
      return clean;
    } catch {
      return empty();
    }
  }

  function write(storage, key, state) {
    try {
      if (!storage) return false;
      storage.setItem(key, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }

  return {
    NODE_WIDTH, NODE_HEIGHT, MIN_ZOOM, MAX_ZOOM, empty, defaults, bounds, fit, ensure,
    zoomAt, move, storageKey, read, write
  };
});
