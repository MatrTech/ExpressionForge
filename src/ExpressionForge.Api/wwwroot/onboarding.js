(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExpressionForgeTour = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';

  const STORAGE_KEY = 'expressionforge:first-run-tour:v1';
  const STEPS = Object.freeze([
    {
      title: 'Welcome to ExpressionForge',
      description: 'Build a powerful query without writing SQL. This quick tour shows you the essentials without changing your query.',
      target: null
    },
    {
      title: 'Start with conditions',
      description: 'Guided mode is the easiest way to begin. Choose a field or relationship and select Add condition—ExpressionForge connects it automatically.',
      mode: 'guided',
      target: () => [...document.querySelectorAll('.guided-condition-picker')].at(-1) ||
        document.getElementById('graph')
    },
    {
      title: 'Meet the Blueprint canvas',
      description: 'The same query becomes a graph. Drag nodes to rearrange, drag empty space to pan, or scroll to zoom. Your canvas layout never changes the query itself.',
      mode: 'blueprint',
      target: () => document.querySelector('.blueprint-viewport')
    },
    {
      title: 'Open a node to edit it',
      description: 'Use the chevron (⌄) to configure a field, operator, value, or logical group. A node’s round sockets are for connecting predicates.',
      mode: 'blueprint',
      target: () => document.querySelector('.blueprint-card:not(.blueprint-sink) .blueprint-expand')
    },
    {
      title: 'Explore related data',
      description: 'Select ↗ on a collection such as Tasks or Orders to open a subgraph. The breadcrumb takes you back, while the editor keeps each entity scope type-safe.',
      mode: 'blueprint',
      target: () => document.querySelector('.blueprint-collectionExpression .blueprint-enter') ||
        document.querySelector('.blueprint-breadcrumbs')
    },
    {
      title: 'You are in control',
      description: 'The JSON is the portable query AST. Undo and Redo restore changes. Validate and Compile SQL use the .NET backend; the Pages demo is browser-only.',
      target: () => document.getElementById('json')
    }
  ]);

  let current = -1;
  let overlay = null;
  let spotlight = null;
  let panel = null;
  let initialFocus = null;
  let displayedInPage = false;

  function storage() {
    try { return window.localStorage; } catch { return null; }
  }

  function element(tag, className, value) {
    const node = document.createElement(tag);
    node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function position() {
    if (!overlay || !panel) return;
    const step = STEPS[current];
    const target = step.target?.();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    spotlight.hidden = !target;
    overlay.classList.toggle('ef-tour-welcome', !target);

    if (!target) {
      panel.style.left = '';
      panel.style.top = '';
      panel.style.right = '';
      return;
    }

    const rect = target.getBoundingClientRect();
    const margin = 8;
    spotlight.style.left = Math.max(0, rect.left - margin) + 'px';
    spotlight.style.top = Math.max(0, rect.top - margin) + 'px';
    spotlight.style.width = rect.width + margin * 2 + 'px';
    spotlight.style.height = rect.height + margin * 2 + 'px';

    if (viewportWidth <= 720) {
      panel.style.left = '';
      panel.style.top = '';
      panel.style.right = '';
      return;
    }

    const width = Math.min(355, viewportWidth - 28);
    const height = panel.offsetHeight || 240;
    const below = rect.bottom + 18;
    const above = rect.top - height - 18;
    const top = below + height < viewportHeight - 12 ? below :
      above >= 12 ? above : Math.max(12, viewportHeight - height - 12);
    const left = Math.min(Math.max(14, rect.left), viewportWidth - width - 14);
    panel.style.top = top + 'px';
    panel.style.left = left + 'px';
    panel.style.right = 'auto';
  }

  function mode(name) {
    if (name === 'guided' && document.getElementById('guided-mode')?.getAttribute('aria-pressed') !== 'true')
      document.getElementById('guided-mode')?.click();
    if (name === 'blueprint' && document.getElementById('blueprint-mode')?.getAttribute('aria-pressed') !== 'true')
      document.getElementById('blueprint-mode')?.click();
  }

  function view(index) {
    if (!overlay || index < 0 || index >= STEPS.length) return;
    current = index;
    const step = STEPS[index];
    mode(step.mode);
    const target = step.target?.();
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });

    panel.replaceChildren();
    panel.dataset.step = String(index);
    const top = element('div', 'ef-tour-header');
    top.append(element('span', 'ef-tour-eyebrow', index === 0 ? 'GETTING STARTED' :
      'STEP ' + index + ' OF ' + (STEPS.length - 1)));
    const close = element('button', 'ef-tour-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close tutorial');
    close.addEventListener('click', finish);
    top.append(close);
    const title = element('h2', 'ef-tour-title', step.title);
    title.id = 'ef-tour-title';
    const description = element('p', 'ef-tour-description', step.description);
    const progress = element('div', 'ef-tour-progress');
    progress.setAttribute('aria-hidden', 'true');
    for (let i = 1; i < STEPS.length; i++)
      progress.append(element('span', i <= index ? 'ef-tour-progress-done' : ''));
    const actions = element('div', 'ef-tour-actions');
    const dismiss = element('button', 'button ghost ef-tour-dismiss', index === 0 ? 'Not now' : 'Skip tour');
    dismiss.type = 'button';
    dismiss.addEventListener('click', finish);
    actions.append(dismiss);
    if (index > 0) {
      const back = element('button', 'button secondary ef-tour-back', 'Back');
      back.type = 'button';
      back.addEventListener('click', () => view(current - 1));
      actions.append(back);
    }
    const next = element('button', 'button primary ef-tour-next',
      index === 0 ? 'Start tour →' : index === STEPS.length - 1 ? 'Finish ✓' : 'Next →');
    next.type = 'button';
    next.addEventListener('click', () => index === STEPS.length - 1 ? finish() : view(current + 1));
    actions.append(next);
    panel.append(top, title, description, progress, actions);
    requestAnimationFrame(position);
    next.focus({ preventScroll: true });
  }

  function onKeydown(event) {
    if (!overlay) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      finish();
    }
    if (event.key === 'ArrowRight' && (event.target === panel || event.target?.classList?.contains('ef-tour-next'))) {
      event.preventDefault();
      if (current < STEPS.length - 1) view(current + 1);
      else finish();
    }
  }

  function finish() {
    if (!overlay) return;
    try { storage()?.setItem(STORAGE_KEY, 'done'); } catch { /* private browsing */ }
    overlay.remove();
    overlay = null;
    panel = null;
    spotlight = null;
    current = -1;
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
    document.removeEventListener('keydown', onKeydown);
    const focus = initialFocus?.isConnected ? initialFocus : document.getElementById('start-tour');
    focus?.focus({ preventScroll: true });
    initialFocus = null;
  }

  function start() {
    if (overlay || !document.getElementById('graph-preview') || !document.getElementById('guided-mode')) return;
    displayedInPage = true;
    initialFocus = document.activeElement;
    overlay = element('div', 'ef-tour-overlay');
    overlay.setAttribute('data-tour', 'active');
    spotlight = element('div', 'ef-tour-spotlight');
    spotlight.setAttribute('aria-hidden', 'true');
    panel = element('section', 'ef-tour-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'ef-tour-title');
    panel.setAttribute('aria-describedby', 'ef-tour-description');
    spotlight.hidden = true;
    overlay.append(spotlight, panel);
    document.body.append(overlay);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    document.addEventListener('keydown', onKeydown);
    view(0);
  }

  function maybeStart() {
    if (displayedInPage || document.body.hasAttribute('data-tour-defer')) return;
    try { if (storage()?.getItem(STORAGE_KEY) === 'done') return; } catch { /* private browsing */ }
    start();
  }

  // The Pages demonstration imports its checked-in sample asynchronously. It may
  // release the first-run tour only after the Project/Task graph is fully ready.
  function releaseDeferredStart() {
    if (document.body.hasAttribute('data-tour-defer'))
      document.body.removeAttribute('data-tour-defer');
    maybeStart();
  }

  return Object.freeze({ STORAGE_KEY, STEPS, start, maybeStart, releaseDeferredStart, finish,
    get activeStep() { return current; } });
});
