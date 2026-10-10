(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExpressionForgeGraphEdit = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const entity = (catalog, id) => catalog?.entities?.find(item => item.id === id);
  const field = (catalog, id, name) => entity(catalog, id)?.properties?.find(item => item.id === name);
  const relation = (catalog, id, name) => entity(catalog, id)?.relationships?.find(item => item.id === name);
  const nullCheck = value => value === 'isNull' || value === 'isNotNull';
  const defaultValue = type => ({ integer: 0, decimal: 0, boolean: false, date: '2026-01-01',
    dateTime: '2026-01-01T00:00:00Z', guid: '00000000-0000-0000-0000-000000000000' })[type] ?? '';

  function steps(path) {
    if (path === '$.query') return [];
    if (typeof path !== 'string' || !path.startsWith('$.query.')) throw Error('Invalid AST path.');
    const rest = path.slice('$.query'.length);
    const parts = rest.match(/(?:\.expressions\[\d+\]|\.expression)/g) || [];
    if (parts.join('') !== rest) throw Error('Invalid AST path.');
    return parts.map(part => part === '.expression' ? { prop: 'expression' }
      : { prop: 'expressions', index: Number(part.slice(13, -1)) });
  }
  function locate(definition, catalog, path) {
    let node = definition.query, parent = null, slot = null, entityId = definition.entity;
    for (const part of steps(path)) {
      if (!node || typeof node !== 'object') throw Error('AST path does not exist.');
      parent = node;
      slot = part;
      if (part.prop === 'expressions' && parent.type !== 'group')
        throw Error('Only groups have ordered predicates.');
      if (part.prop === 'expression' && !['not', 'collectionExpression'].includes(parent.type))
        throw Error('Node does not have a child expression.');
      if (parent.type === 'collectionExpression') {
        const target = relation(catalog, entityId, parent.collection)?.targetEntity;
        if (!entity(catalog, target)) throw Error('Collection scope is unavailable.');
        entityId = target;
      }
      node = part.index === undefined ? parent[part.prop] : parent[part.prop]?.[part.index];
    }
    if (!node || typeof node !== 'object') throw Error('AST path does not exist.');
    return { node, parent, slot, entityId };
  }
  function put(definition, ref, node) {
    if (!ref.parent) definition.query = node;
    else if (ref.slot.index === undefined) ref.parent[ref.slot.prop] = node;
    else ref.parent[ref.slot.prop][ref.slot.index] = node;
  }
  const numericOps = new Set(['equals', 'notEquals', 'greaterThan', 'greaterThanOrEqual', 'lessThan', 'lessThanOrEqual']);
  function fieldOperators(left, right) {
    if (!left || !right || left.dataType !== right.dataType) return [];
    const allowed = ['integer', 'decimal'].includes(left.dataType) ? numericOps : new Set(['equals', 'notEquals']);
    return left.operators.filter(op => allowed.has(op) && right.operators.includes(op));
  }
  function fieldPair(catalog, entityId) {
    const properties = entity(catalog, entityId)?.properties || [];
    for (const left of properties) {
      const right = properties.find(candidate => candidate.id !== left.id && fieldOperators(left, candidate).length);
      if (right) return [left, right];
    }
    return null;
  }
  function makePredicate(catalog, entityId, spec) {
    if (!entity(catalog, entityId)) throw Error('Entity scope is unavailable.');
    if (spec.kind === 'expression') {
      const meta = field(catalog, entityId, spec.field);
      if (!meta?.operators?.length) throw Error('Field is unavailable in this entity scope.');
      const operator = meta.operators[0];
      return { type: 'expression', field: meta.id, operator,
        ...(nullCheck(operator) ? {} : { value: defaultValue(meta.dataType) }) };
    }
    if (spec.kind === 'arithmeticComparison') {
      const numeric = entity(catalog, entityId).properties?.find(p =>
        ['integer', 'decimal'].includes(p.dataType));
      if (!numeric) throw Error('No numeric fields in this entity scope.');
      return { type: 'arithmeticComparison',
        left: { type: 'numericBinary', operator: 'subtract',
          left: { type: 'numericField', field: numeric.id },
          right: { type: 'numericLiteral', value: 0 } },
        operator: 'greaterThan', right: { type: 'numericLiteral', value: 10 } };
    }
    if (spec.kind === 'fieldComparison') {
      const [left, right] = fieldPair(catalog, entityId) || [];
      if (!left || !right) throw Error('No compatible field pair in this entity scope.');
      return { type: 'fieldComparison', leftField: left.id, rightField: right.id,
        operator: fieldOperators(left, right)[0] };
    }
    if (spec.kind === 'collection') {
      const rel = relation(catalog, entityId, spec.collection);
      const child = entity(catalog, rel?.targetEntity)?.properties?.find(p => p.operators?.length);
      if (!child) throw Error('Collection scope or child fields are unavailable.');
      return { type: 'collectionExpression', collection: rel.id, quantifier: 'any',
        expression: makePredicate(catalog, rel.targetEntity, { kind: 'expression', field: child.id }) };
    }
    const first = entity(catalog, entityId).properties?.find(p => p.operators?.length)?.id;
    const child = makePredicate(catalog, entityId, { kind: 'expression', field: first });
    if (spec.kind === 'not') return { type: 'not', expression: child };
    if (spec.kind === 'group') return { type: 'group', operator: spec.operator === 'or' ? 'or' : 'and', expressions: [child] };
    throw Error('Unsupported predicate kind.');
  }
  function options(catalog, entityId) {
    const meta = entity(catalog, entityId);
    if (!meta) return [];
    const fields = (meta.properties || []).filter(p => p.operators?.length);
    return [
      ...fields.map(p => ({ kind: 'expression', field: p.id, label: p.displayName || p.id })),
      ...(fieldPair(catalog, entityId) ? [{ kind: 'fieldComparison', label: 'Compare two fields' }] : []),
      ...((meta.properties || []).some(p => ['integer', 'decimal'].includes(p.dataType)) ?
        [{ kind: 'arithmeticComparison', label: 'Calculate with fields' }] : []),
      ...(meta.relationships || []).filter(r => entity(catalog, r.targetEntity)?.properties?.some(p => p.operators?.length))
        .map(r => ({ kind: 'collection', collection: r.id, label: (r.displayName || r.id) + ' · Any' })),
      ...(fields.length ? [{ kind: 'group', operator: 'and', label: 'AND group' },
        { kind: 'group', operator: 'or', label: 'OR group' }, { kind: 'not', label: 'NOT condition' }] : [])
    ];
  }
  function verify(next, catalog) {
    if (typeof globalThis !== 'undefined' && globalThis.ExpressionForgeGraph)
      globalThis.ExpressionForgeGraph.project(next, catalog);
    return next;
  }
  function append(definition, catalog, path, descriptor) {
    const next = clone(definition);
    const ref = locate(next, catalog, path);
    const child = makePredicate(catalog, ref.entityId, descriptor);
    if (ref.node.type === 'group') ref.node.expressions.push(child);
    else put(next, ref, { type: 'group', operator: 'and', expressions: [ref.node, child] });
    return verify(next, catalog);
  }
  function change(definition, catalog, path, patch) {
    const next = clone(definition);
    const { node, entityId } = locate(next, catalog, path);
    if (node.type === 'group' && patch.kind === 'operator') {
      if (!['and', 'or'].includes(patch.value)) throw Error('Unsupported group operator.');
      node.operator = patch.value;
    } else if (node.type === 'collectionExpression' && patch.kind === 'quantifier') {
      if (!['any', 'none', 'all'].includes(patch.value)) throw Error('Unsupported collection quantifier.');
      node.quantifier = patch.value;
    } else if (node.type === 'arithmeticComparison') {
      const left = node.left;
      if (left?.type !== 'numericBinary' || left.left?.type !== 'numericField' ||
        !['numericLiteral', 'numericParameter'].includes(left.right?.type) ||
        !['numericLiteral', 'numericParameter'].includes(node.right?.type))
        throw Error('Complex arithmetic trees are editable through the JSON AST.');
      const numeric = ['integer', 'decimal'];
      const validNumber = value => typeof value === 'number' && Number.isFinite(value) &&
        Math.abs(value) <= 1e12 && Math.round(value * 1e6) / 1e6 === value;
      if (patch.kind === 'numericField') {
        if (!numeric.includes(field(catalog, entityId, patch.value)?.dataType))
          throw Error('Arithmetic field must be numeric and visible in the current scope.');
        left.left.field = patch.value;
      } else if (patch.kind === 'numericOperator') {
        if (!['add', 'subtract', 'multiply', 'divide'].includes(patch.value)) throw Error('Unknown arithmetic operation.');
        left.operator = patch.value;
      } else if (patch.kind === 'numericComparator') {
        if (!['equals', 'notEquals', 'greaterThan', 'greaterThanOrEqual', 'lessThan', 'lessThanOrEqual']
          .includes(patch.value)) throw Error('Unsupported numeric comparison.');
        node.operator = patch.value;
      } else if (patch.kind === 'numericOperandMode' || patch.kind === 'numericThresholdMode') {
        if (!['literal', 'parameter'].includes(patch.value)) throw Error('Unknown numeric value source.');
        const target = patch.kind === 'numericOperandMode' ? left : node;
        const key = patch.kind === 'numericOperandMode' ? 'right' : 'right';
        if (patch.value === 'literal') target[key] = { type: 'numericLiteral', value: 0 };
        else {
          let number = 1;
          const occupied = JSON.stringify(next);
          while (occupied.includes('"parameter":"numeric' + number + '"')) number++;
          target[key] = { type: 'numericParameter', parameter: 'numeric' + number };
        }
      } else if (patch.kind === 'numericOperand' || patch.kind === 'numericThreshold') {
        if (!validNumber(patch.value)) throw Error('Expected a numeric literal within ±1e12 and at most 6 decimals.');
        const target = patch.kind === 'numericOperand' ? left.right : node.right;
        if (target.type !== 'numericLiteral') throw Error('Switch back to fixed value before editing a number.');
        target.value = patch.value;
      } else if (patch.kind === 'numericOperandParameter' || patch.kind === 'numericThresholdParameter') {
        if (typeof patch.value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(patch.value))
          throw Error('Use 1–64 letters, digits, _ or - for a numeric parameter.');
        const target = patch.kind === 'numericOperandParameter' ? left.right : node.right;
        if (target.type !== 'numericParameter') throw Error('Switch to runtime parameter first.');
        target.parameter = patch.value;
      } else throw Error('Unsupported arithmetic change.');
    } else if (node.type === 'fieldComparison') {
      if (!['leftField', 'rightField', 'operator'].includes(patch.kind))
        throw Error('Unsupported field comparison change.');
      if (patch.kind === 'leftField' || patch.kind === 'rightField') {
        const updated = field(catalog, entityId, patch.value);
        if (!updated) throw Error('Field is not available in this entity scope.');
        const opposite = field(catalog, entityId, patch.kind === 'leftField' ? node.rightField : node.leftField);
        const operations = fieldOperators(patch.kind === 'leftField' ? updated : opposite,
          patch.kind === 'rightField' ? updated : opposite);
        if (!operations.length) throw Error('Field types or operators are incompatible.');
        node[patch.kind] = updated.id;
        if (!operations.includes(node.operator)) node.operator = operations[0];
      } else {
        const left = field(catalog, entityId, node.leftField);
        const right = field(catalog, entityId, node.rightField);
        if (!fieldOperators(left, right).includes(patch.value)) throw Error('Operator is unavailable.');
        node.operator = patch.value;
      }
    } else if (node.type === 'expression') {
      const meta = field(catalog, entityId, node.field);
      if (patch.kind === 'field') {
        const selected = field(catalog, entityId, patch.value);
        if (!selected?.operators?.length) throw Error('Field is not permitted in this scope.');
        node.field = selected.id;
        node.operator = selected.operators[0];
        delete node.parameter;
        delete node.value;
        if (!nullCheck(node.operator)) node.value = defaultValue(selected.dataType);
      } else if (patch.kind === 'operator') {
        if (!meta?.operators?.includes(patch.value)) throw Error('Operator is unavailable.');
        node.operator = patch.value;
        if (nullCheck(patch.value)) { delete node.value; delete node.parameter; }
        else if (node.value === undefined && node.parameter === undefined) node.value = defaultValue(meta.dataType);
      } else if (patch.kind === 'value') {
        if (nullCheck(node.operator) || patch.value === undefined || patch.value === null || typeof patch.value === 'object')
          throw Error('Invalid scalar value.');
        const type = meta?.dataType;
        if (type === 'boolean' && typeof patch.value !== 'boolean') throw Error('Expected boolean.');
        if (['integer', 'decimal'].includes(type) && (typeof patch.value !== 'number' || !Number.isFinite(patch.value)))
          throw Error('Expected finite number.');
        if (type === 'integer' && (!Number.isInteger(patch.value) || patch.value < -2147483648 || patch.value > 2147483647))
          throw Error('Expected 32-bit integer.');
        if (!['integer', 'decimal', 'boolean'].includes(type) && typeof patch.value !== 'string')
          throw Error('Expected string.');
        delete node.parameter;
        node.value = patch.value;
      } else if (patch.kind === 'parameter') {
        if (nullCheck(node.operator) || typeof patch.value !== 'string' ||
          !/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(patch.value)) throw Error('Invalid parameter name.');
        delete node.value;
        node.parameter = patch.value;
      } else if (patch.kind === 'literal') {
        delete node.parameter;
        node.value = defaultValue(meta?.dataType);
      } else throw Error('Unsupported comparison change.');
    } else throw Error('Unsupported node change.');
    return verify(next, catalog);
  }
  function reconnect(definition, catalog, sourcePath, targetPath) {
    if (sourcePath === targetPath || targetPath.startsWith(sourcePath + '.'))
      throw Error('Cannot connect a node to itself or descendant.');
    const next = clone(definition);
    const source = locate(next, catalog, sourcePath);
    const target = locate(next, catalog, targetPath);
    if (target.node.type !== 'group' || source.entityId !== target.entityId)
      throw Error('Predicate socket scopes are incompatible.');
    if (source.parent?.type !== 'group' || source.slot?.prop !== 'expressions')
      throw Error('Source must be a logical-group child.');
    if (source.parent.expressions.length < 2 && source.parent !== target.node)
      throw Error('Cannot detach the last child of a group.');
    if (source.parent.expressions[source.slot.index] !== source.node) throw Error('Source changed.');
    source.parent.expressions.splice(source.slot.index, 1);
    target.node.expressions.push(source.node);
    return verify(next, catalog);
  }
  function canRemove(definition, catalog, path) {
    try {
      const ref = locate(definition, catalog, path);
      return ref.parent?.type === 'group' && ref.slot?.prop === 'expressions' &&
        ref.parent.expressions.length > 1;
    } catch { return false; }
  }
  function remove(definition, catalog, path) {
    const next = clone(definition);
    const ref = locate(next, catalog, path);
    if (ref.parent?.type !== 'group' || ref.slot?.prop !== 'expressions')
      throw Error('Only predicates within a logical group can be deleted.');
    if (ref.parent.expressions.length <= 1)
      throw Error('Cannot delete the only predicate in a logical group.');
    ref.parent.expressions.splice(ref.slot.index, 1);
    return verify(next, catalog);
  }
  function insert(definition, catalog, path, specification) {
    const next = clone(definition);
    const ref = locate(next, catalog, path);
    if (specification?.kind === 'not') {
      put(next, ref, { type: 'not', expression: ref.node });
      return verify(next, catalog);
    }
    if (!['and', 'or'].includes(specification?.operator) || !specification.field)
      throw Error('Choose AND/OR and an available field to insert on this connection.');
    const additional = makePredicate(catalog, ref.entityId,
      { kind: 'expression', field: specification.field });
    put(next, ref, { type: 'group', operator: specification.operator,
      expressions: [ref.node, additional] });
    return verify(next, catalog);
  }
  function canReconnect(definition, catalog, sourcePath, targetPath) {
    try {
      reconnect(definition, catalog, sourcePath, targetPath);
      return { valid: true, reason: null };
    } catch (error) { return { valid: false, reason: error.message }; }
  }
  return { locate, makePredicate, options, append, change, reconnect, remove, insert, canReconnect, canRemove };
});
