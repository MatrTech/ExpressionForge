(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExpressionForgeNumericTree = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';

  const operators = ['add', 'subtract', 'multiply', 'divide'];
  const kinds = ['numericField', 'numericLiteral', 'numericParameter', 'numericBinary',
    'stringLength', 'dateDiffDays', 'tryParseDecimal'];
  const number = x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1e12 &&
    Number.isInteger(x * 1000000);
  const scaledDecimal = source => {
    const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec(source);
    if (!match) return null;
    const scaled = BigInt(match[2]) * 1000000n + BigInt((match[3] || '').padEnd(6, '0'));
    return match[1] ? -scaled : scaled;
  };
  function parseInput(raw) {
    const exact = scaledDecimal(raw);
    const value = Number(raw);
    if (exact === null || !number(value))
      throw Error('Enter a decimal within ±1e12, with at most six fractional places.');
    if (scaledDecimal(value.toString()) !== exact)
      throw Error('This number loses decimal precision in the browser; use a smaller value.');
    return value;
  }

  function choices(catalog, entityId) {
    const props = catalog?.entities?.find(e => e.id === entityId)?.properties || [];
    const dates = props.filter(p => ['date', 'dateTime'].includes(p.dataType));
    const hasDatePair = dates.some(p => dates.some(q => p !== q && p.dataType === q.dataType));
    return [
      { type: 'numericLiteral', label: 'Fixed number' },
      { type: 'numericParameter', label: 'Runtime number' },
      ...(props.some(p => ['integer', 'decimal'].includes(p.dataType)) ?
        [{ type: 'numericField', label: 'Numeric field' }] : []),
      ...(props.some(p => p.dataType === 'string') ? [
        { type: 'stringLength', label: 'Text length' },
        { type: 'tryParseDecimal', label: 'Parse decimal from text' }
      ] : []),
      ...(hasDatePair ? [{ type: 'dateDiffDays', label: 'Days between dates' }] : []),
      { type: 'numericBinary', label: 'Calculation' }
    ];
  }

  function create(type, catalog, entityId) {
    if (!choices(catalog, entityId).some(x => x.type === type))
      throw Error('Value type is unavailable in this metadata scope.');
    const props = catalog.entities.find(e => e.id === entityId).properties;
    switch (type) {
      case 'numericLiteral': return { type, value: 0 };
      case 'numericParameter': return { type, parameter: 'number1' };
      case 'numericField':
        return { type, field: props.find(p => ['integer', 'decimal'].includes(p.dataType)).id };
      case 'stringLength':
      case 'tryParseDecimal':
        return { type, field: props.find(p => p.dataType === 'string').id };
      case 'dateDiffDays': {
        const start = props.find(p => ['date', 'dateTime'].includes(p.dataType));
        const end = props.find(p => p !== start && p.dataType === start.dataType);
        return { type, startField: start.id, endField: end.id };
      }
      case 'numericBinary': return { type, operator: 'add',
        left: { type: 'numericLiteral', value: 0 }, right: { type: 'numericLiteral', value: 0 } };
      default: throw Error('Unknown numeric value type.');
    }
  }

  function validate(value, catalog, entityId, depth = 1) {
    if (!value || !kinds.includes(value.type) || depth > 16)
      throw Error('Invalid numeric value or expression depth.');
    const entity = catalog?.entities?.find(e => e.id === entityId);
    const field = id => entity?.properties?.find(p => p.id === id);
    switch (value.type) {
      case 'numericField':
        if (!['integer', 'decimal'].includes(field(value.field)?.dataType))
          throw Error('Numeric field must be visible and numeric.');
        break;
      case 'stringLength':
      case 'tryParseDecimal':
        if (field(value.field)?.dataType !== 'string')
          throw Error('String field must be visible and typed as string.');
        break;
      case 'dateDiffDays': {
        const start = field(value.startField), end = field(value.endField);
        if (!start || !end || !['date', 'dateTime'].includes(start.dataType) ||
          start.dataType !== end.dataType) throw Error('Date fields must use the same date/dateTime type.');
        break;
      }
      case 'numericLiteral':
        if (!number(value.value)) throw Error('Decimal must have at most six fractional places and be within ±1e12.');
        break;
      case 'numericParameter':
        if (typeof value.parameter !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.parameter))
          throw Error('Invalid runtime number parameter name.');
        break;
      case 'numericBinary':
        if (!operators.includes(value.operator)) throw Error('Invalid arithmetic operator.');
        validate(value.left, catalog, entityId, depth + 1);
        validate(value.right, catalog, entityId, depth + 1);
        break;
    }
  }

  function change(predicate, catalog, entityId, valuePath, action) {
    if (predicate?.type !== 'arithmeticComparison') throw Error('Predicate has no numeric values.');
    if (typeof valuePath !== 'string' || !/^(left|right)(\.(left|right))*$/.test(valuePath))
      throw Error('Invalid numeric value path.');
    const parts = valuePath.split('.');
    let parent = predicate;
    for (const segment of parts.slice(0, -1)) {
      parent = parent[segment];
      if (!parent || parent.type !== 'numericBinary') throw Error('Value tree path does not exist.');
    }
    const slot = parts.at(-1);
    let value = parent[slot];
    if (!value || typeof value !== 'object') throw Error('Value tree path does not exist.');
    switch (action?.kind) {
      case 'replace':
        value = create(action.type, catalog, entityId);
        break;
      case 'wrap':
        if (!operators.includes(action.operator)) throw Error('Unsupported arithmetic operation.');
        value = { type: 'numericBinary', operator: action.operator, left: value,
          right: { type: 'numericLiteral', value: 1 } };
        break;
      case 'unwrap':
        if (value.type !== 'numericBinary') throw Error('Only arithmetic values can be unwrapped.');
        value = value.left;
        break;
      case 'set':
        if (!Object.hasOwn(value, action.property) || ['type', 'left', 'right'].includes(action.property))
          throw Error('Value field cannot be changed directly.');
        value[action.property] = action.value;
        break;
      default:
        throw Error('Unsupported numeric tree action.');
    }
    validate(value, catalog, entityId);
    parent[slot] = value;
    validate(predicate.left, catalog, entityId);
    validate(predicate.right, catalog, entityId);
    return predicate;
  }

  return Object.freeze({ operators, choices, create, validate, change, parseInput });
});
