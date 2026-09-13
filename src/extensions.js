// Only bundled modules may render management UI. Third-party executable UI is not loaded.
export function createRegistry() {
  const pages = new Map();
  return {
    register(page) {
      if (!/^[a-z][a-z0-9-]*$/.test(page.id) || typeof page.render !== 'function') throw Error('Invalid page extension');
      if (pages.has(page.id)) throw Error('Duplicate page extension');
      pages.set(page.id, Object.freeze({ ...page }));
    },
    list: () => [...pages.values()],
    get: id => pages.get(id)
  };
}
