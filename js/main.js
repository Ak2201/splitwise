/**
 * Bootstrap: wires the store to the router and paints the shell.
 *
 * View contract - every view module default-exports a function:
 *   view(ctx) -> { title, subtitle?, back?, actions?, content, fab?, tab? }
 * where ctx = { state, params, group?, navigate, refresh, toast }.
 * Views return DOM nodes; they never build HTML strings.
 */
import * as store from './store.js';
import { register, start, navigate, refresh, parseHash } from './ui/router.js';
import { toast } from './ui/components.js';
import { h, append, clear, icon, ICONS } from './util/dom.js';

import groupsView from './ui/views/groups.js';
import groupView from './ui/views/group.js';
import balancesView from './ui/views/balances.js';
import membersView from './ui/views/members.js';
import recurringView from './ui/views/recurring.js';
import reportView from './ui/views/report.js';
import settingsView from './ui/views/settings.js';
import importView from './ui/views/import.js';

const headerEl = document.getElementById('app-header');
const mainEl = document.getElementById('main');
const tabbarEl = document.getElementById('tabbar');

register('/', groupsView);
register('/groups', groupsView);
register('/g/:id', groupView);
register('/g/:id/balances', balancesView);
register('/g/:id/members', membersView);
register('/g/:id/recurring', recurringView);
register('/g/:id/report', reportView);
register('/settings', settingsView);
register('/import/:code', importView);

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.dataset.theme = theme;
}

/** Anything the views are allowed to reach for. */
function makeContext(params) {
  const state = store.getState();
  return {
    state,
    params,
    group: params.id ? store.getGroup(params.id) : null,
    store,
    navigate,
    refresh: renderCurrent,
    toast,
  };
}

let lastFab = null;

function paint(view, params) {
  const ctx = makeContext(params);

  let screen;
  try {
    screen = view(ctx);
  } catch (error) {
    console.error(error);
    screen = {
      title: 'Something went wrong',
      content: h('div.empty', null, [
        h('h2', { text: 'This screen could not be shown' }),
        h('p.small', { text: error?.message || 'Unknown error.' }),
        h('button.btn', { type: 'button', text: 'Back to groups', onclick: () => navigate('/', { back: true }) }),
      ]),
    };
  }

  // --- header
  clear(headerEl);
  if (screen.back) {
    append(headerEl, h('button.btn.btn--icon', {
      type: 'button',
      'aria-label': 'Back',
      onclick: () => navigate(screen.back, { back: true }),
    }, icon(ICONS.back)));
  }
  append(headerEl, h('div.app-header__title', null, [
    h('h1', { text: screen.title }),
    screen.subtitle ? h('div.app-header__sub', { text: screen.subtitle }) : null,
  ]));
  if (screen.actions) append(headerEl, screen.actions);

  // --- body
  clear(mainEl);
  mainEl.style.viewTransitionName = 'page';
  append(mainEl, screen.content);

  // --- floating action button
  lastFab?.remove();
  lastFab = screen.fab || null;
  if (lastFab) document.body.appendChild(lastFab);

  // --- bottom tabs
  renderTabs(screen.tab || 'groups');

  document.title = screen.title === 'Splitly' ? 'Splitly' : `${screen.title} · Splitly`;
}

function renderTabs(active) {
  clear(tabbarEl);
  const tabs = [
    { id: 'groups', label: 'Groups', href: '#/', iconPath: ICONS.users },
    { id: 'settings', label: 'Settings', href: '#/settings', iconPath: ICONS.settings },
  ];
  for (const tab of tabs) {
    append(tabbarEl, h('a.tabbar__item', {
      href: tab.href,
      'aria-current': tab.id === active ? 'page' : null,
    }, [icon(tab.iconPath, { size: 21 }), h('span', { text: tab.label })]));
  }
}

/**
 * Repaint whatever the URL currently points at.
 *
 * Deliberately re-resolves the route instead of repainting a remembered view:
 * a store change can land while a navigation is still in flight (deleting the
 * group you were just looking at does exactly that), and repainting the
 * remembered view would render the old screen against data it no longer has.
 */
function renderCurrent() {
  refresh();
}

function boot() {
  store.init();
  applyTheme(store.getState().settings.theme);

  // A share link opened in a fresh browser must not be swallowed by the
  // "no groups yet" screen, so routing happens before anything else.
  start(paint);

  store.subscribe(() => {
    applyTheme(store.getState().settings.theme);
    renderCurrent();
  });

  const warning = store.getStorageWarning();
  if (warning) toast(warning, { type: 'error', duration: 9000 });

  // Recurring expenses that came due while the app was closed.
  const generated = store.runRecurring();
  const total = generated.reduce((sum, g) => sum + g.count, 0);
  if (total > 0) {
    const where = generated.length === 1 ? ` in ${generated[0].groupName}` : ' across your groups';
    toast(`Added ${total} recurring ${total === 1 ? 'expense' : 'expenses'}${where}.`, { type: 'success', duration: 6000 });
  }
}

boot();
