/**
 * Hash routing.
 *
 * The hash (rather than the History API) is deliberate: the app must work when
 * opened from a static host, a subfolder, or even a file:// URL, none of which
 * can rewrite paths server-side. It also gives share links a place to put a
 * payload the server never sees.
 */

const routes = [];
let onRender = () => {};
let current = null;
let depth = 0;

/** register('/g/:id/balances', viewFn) */
export function register(pattern, view) {
  const names = [];
  const regex = new RegExp(
    '^' + pattern.replace(/:[A-Za-z]+/g, (match) => {
      names.push(match.slice(1));
      return '([^/]+)';
    }) + '$',
  );
  routes.push({ regex, names, view, pattern });
}

export function parseHash(hash = window.location.hash) {
  const raw = (hash || '').replace(/^#/, '') || '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

export function match(path) {
  for (const route of routes) {
    const result = route.regex.exec(path);
    if (!result) continue;
    const params = {};
    route.names.forEach((name, i) => {
      params[name] = decodeURIComponent(result[i + 1]);
    });
    return { route, params };
  }
  return null;
}

export function navigate(path, { replace = false, back = false } = {}) {
  const target = `#${path}`;
  // Direction drives the slide animation; tracked rather than guessed so
  // "back" from a nested view animates the way the user expects.
  depth = back ? Math.max(0, depth - 1) : depth + 1;
  document.documentElement.dataset.nav = back ? 'back' : 'forward';

  if (replace) window.location.replace(target);
  else window.location.hash = target;
}

export function currentPath() {
  return current;
}

let activeTransition = null;

async function render() {
  const path = parseHash();
  current = path;
  const found = match(path) || match('/');
  if (!found) return;

  const run = () => onRender(found.route.view, found.params, path);

  const canAnimate = document.startViewTransition
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // A transition started while the tab is hidden is aborted immediately.
    && document.visibilityState === 'visible'
    && !activeTransition;

  if (!canAnimate) {
    run();
    return;
  }

  activeTransition = document.startViewTransition(run);
  // Both promises reject when a transition is superseded or aborted - normal
  // during fast navigation, but unhandled they surface as console errors.
  activeTransition.ready?.catch(() => {});
  activeTransition.finished
    ?.catch(() => {})
    .finally(() => { activeTransition = null; });
}

export function start(renderer) {
  onRender = renderer;
  window.addEventListener('hashchange', render);
  render();
}

export function refresh() {
  const found = match(parseHash()) || match('/');
  if (found) onRender(found.route.view, found.params, parseHash());
}
