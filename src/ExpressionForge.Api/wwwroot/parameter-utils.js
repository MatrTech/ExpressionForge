'use strict';

// Pure metadata-driven helpers, shared by the editor and its Node.js tests.
globalThis.ExpressionForgeParameters = (() => {
  const validName = /^[A-Za-z0-9_-]{1,64}$/;
  const parseScaledDecimal = raw => {
    const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec(raw);
    if (!match) return null;
    const magnitude = BigInt(match[2]) * 1000000n + BigInt((match[3] || '').padEnd(6, '0'));
    return match[1] ? -magnitude : magnitude;
  };


  function discover(definition, catalog) {
    if (!definition?.query || !catalog?.entities) return [];
    const result = new Map();
    const entities = new Map(catalog.entities.map(item => [item.id, item]));

    function visitNumeric(value, entityId) {
      if (!value || typeof value !== 'object') return;
      if (value.type === 'numericBinary') {
        visitNumeric(value.left, entityId);
        visitNumeric(value.right, entityId);
        return;
      }
      if (value.type !== 'numericParameter' || typeof value.parameter !== 'string') return;
      const previous = result.get(value.parameter);
      if (previous) {
        if (previous.dataType !== 'decimal') previous.conflict = true;
        previous.numeric = true;
        previous.references.push(entityId + '.numeric');
      } else {
        result.set(value.parameter, {
          name: value.parameter, dataType: 'decimal', numeric: true,
          references: [entityId + '.numeric'], conflict: false,
          validName: validName.test(value.parameter)
        });
      }
    }

    function visit(expression, entityId) {
      if (!expression || typeof expression !== 'object') return;
      const metadata = entities.get(entityId);
      if (!metadata) return;
      if (expression.type === 'group') {
        if (Array.isArray(expression.expressions)) expression.expressions.forEach(child => visit(child, entityId));
      } else if (expression.type === 'not') {
        visit(expression.expression, entityId);
      } else if (expression.type === 'collectionExpression') {
        const relation = metadata.relationships?.find(item => item.id === expression.collection);
        if (relation) visit(expression.expression, relation.targetEntity);
      } else if (expression.type === 'arithmeticComparison') {
        visitNumeric(expression.left, entityId);
        visitNumeric(expression.right, entityId);
      } else if (expression.type === 'expression' && typeof expression.parameter === 'string') {
        const field = metadata.properties?.find(item => item.id === expression.field);
        if (!field || ['isNull', 'isNotNull'].includes(expression.operator)) return;
        const previous = result.get(expression.parameter);
        if (previous) {
          if (previous.dataType !== field.dataType) previous.conflict = true;
          previous.references.push(`${entityId}.${field.id}`);
        } else {
          result.set(expression.parameter, {
            name: expression.parameter, dataType: field.dataType,
            references: [`${entityId}.${field.id}`], conflict: false,
            validName: validName.test(expression.parameter)
          });
        }
      }
    }

    visit(definition.query, definition.entity);
    return [...result.values()];
  }

  function buildBindings(definitions, rawValues) {
    const parameters = {};
    for (const item of definitions) {
      if (item.conflict) throw new Error(`Parameter "${item.name}" is used with incompatible field types.`);
      if (!item.validName) throw new Error(`Invalid parameter name "${item.name}". Use 1–64 letters, digits, _ or -.`);
      if (!Object.hasOwn(rawValues, item.name)) continue;
      const raw = rawValues[item.name];
      if (raw === null || raw === undefined) continue;
      if (item.dataType === 'string') {
        if (raw.length > 1024) throw new Error(`Parameter "${item.name}" exceeds 1024 characters.`);
        parameters[item.name] = raw;
      } else if (item.dataType === 'boolean') {
        if (raw !== 'true' && raw !== 'false') throw new Error(`Parameter "${item.name}" must be true or false.`);
        parameters[item.name] = raw === 'true';
      } else if (item.dataType === 'integer') {
        if (!/^-?(0|[1-9][0-9]*)$/.test(raw)) throw new Error(`Parameter "${item.name}" must be an integer.`);
        const value = Number(raw);
        if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)
          throw new Error(`Parameter "${item.name}" must fit a 32-bit integer.`);
        parameters[item.name] = value;
      } else if (item.dataType === 'decimal') {
        if (!/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(raw)) throw new Error(`Parameter "${item.name}" must be a decimal number.`);
        const value = Number(raw);
        if (!Number.isFinite(value)) throw new Error(`Parameter "${item.name}" is out of range.`);
        if (item.numeric) {
          const original = parseScaledDecimal(raw);
          if (Math.abs(value) > 1e12 || original === null)
            throw new Error(`Numeric parameter "${item.name}" must be within ±1e12 and have at most six decimal places.`);
          // A JS Number cannot represent every six-place decimal up to 1e12.
          // Never silently send a rounded value that differs from what the user entered.
          if (parseScaledDecimal(value.toString()) !== original)
            throw new Error(`Numeric parameter "${item.name}" loses decimal precision in this browser.`);
        }
        parameters[item.name] = value;
      } else {
        throw new Error(`Unsupported parameter type "${item.dataType}".`);
      }
    }
    return parameters;
  }

  return Object.freeze({ discover, buildBindings });
})();
