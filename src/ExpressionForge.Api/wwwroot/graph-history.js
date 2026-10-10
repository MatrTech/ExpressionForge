(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExpressionForgeHistory = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';

  const clone = value => JSON.parse(JSON.stringify(value));
  const MAX_TRANSACTIONS = 60;
  function create(snapshot, maximum = MAX_TRANSACTIONS) {
    const limit = Number.isInteger(maximum) && maximum > 0 ? Math.min(maximum, 200) : MAX_TRANSACTIONS;
    return { current: clone(snapshot), past: [], future: [], limit };
  }
  function commit(history, next) {
    const serialized = JSON.stringify(next);
    if (JSON.stringify(history.current) === serialized) return false;
    history.past.push(clone(history.current));
    if (history.past.length > history.limit) history.past.shift();
    history.current = clone(next);
    history.future.length = 0;
    return true;
  }
  function undo(history) {
    if (!history.past.length) return null;
    history.future.push(clone(history.current));
    history.current = history.past.pop();
    return clone(history.current);
  }
  function redo(history) {
    if (!history.future.length) return null;
    history.past.push(clone(history.current));
    history.current = history.future.pop();
    return clone(history.current);
  }
  function available(history) {
    return { undo: Boolean(history?.past?.length), redo: Boolean(history?.future?.length) };
  }
  return { create, commit, undo, redo, available };
});
