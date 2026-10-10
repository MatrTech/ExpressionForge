'use strict';

// Only public catalog metadata is simulated here. All actual query editing uses the
// same JavaScript modules as the .NET application's editor.
(function () {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.pathname === '/api/query/catalogs') {
      return Promise.resolve(new Response(JSON.stringify({
        defaultCatalog: 'projects',
        catalogs: [{ id: 'projects', displayName: 'Projects & Tasks (demo)', catalogVersion: 'static-showcase' }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    if (url.pathname === '/api/query/metadata' && url.searchParams.get('catalog') === 'projects')
      return nativeFetch('blueprint-assets/project-metadata.json');
    if (url.pathname.startsWith('/api/query/')) {
      return Promise.resolve(new Response(JSON.stringify({
        message: 'This is a browser-only demonstration. Run the .NET API for validation, SQL compilation and row preview.'
      }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
    }
    return nativeFetch(input, init);
  };

  function until(predicate) {
    return new Promise((resolve, reject) => {
      if (predicate()) { resolve(); return; }
      const observer = new MutationObserver(() => {
        if (!predicate()) return;
        observer.disconnect();
        resolve();
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      window.setTimeout(() => {
        observer.disconnect();
        reject(new Error('The Blueprint demo did not initialize correctly.'));
      }, 12000);
    });
  }

  async function loadExample() {
    const response = await nativeFetch('blueprint-assets/project-query.json');
    if (!response.ok) throw new Error('Could not load Project example.');
    const example = await response.json();
    example.definition.catalogId = 'projects';
    example.definition.catalogRevision = 'static-showcase';
    const json = document.getElementById('json');
    json.value = JSON.stringify(example.definition, null, 2);
    document.getElementById('load-json').click();
    await until(() => {
      try {
        return JSON.parse(json.value).query.id === 'project-root' &&
          document.getElementById('node-count').textContent === '7 nodes' &&
          document.getElementById('connection').textContent.includes('Catalog projects');
      } catch { return false; }
    });
    document.getElementById('blueprint-mode').click();
    ExpressionForgeTour.releaseDeferredStart();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const button = document.getElementById('load-example');
    button.addEventListener('click', () => loadExample().catch(error => {
      document.getElementById('message').textContent = error.message;
    }));
    try {
      await until(() => document.getElementById('connection').textContent.startsWith('Catalog projects'));
      await loadExample();
    } catch (error) {
      document.getElementById('message').textContent = error.message;
    }
  });
})();
