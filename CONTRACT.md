# View contract (read this before writing any view)

Vanilla JS, ES modules, **no build step, no dependencies, no frameworks**.
Project root is the directory containing `index.html`.

## The contract

Every view file lives in `js/ui/views/` and has a **default export**:

```js
export default function view(ctx) {
  return {
    title: 'Goa trip',        // required, string, shown in the header
    subtitle: '4 people',     // optional string
    back: '/g/abc',           // optional route; renders a back arrow
    actions: [node, node],    // optional array of header buttons (right side)
    content: node,            // required, a DOM Node (the page body)
    fab: node,                // optional floating action button
    tab: 'groups',            // 'groups' | 'settings' — which bottom tab is lit
  };
}
```

`ctx` is:

```js
{
  state,      // the whole store state (read-only; never mutate directly)
  params,     // route params, e.g. { id: 'abc' }
  group,      // the group for params.id, or null. MAY BE NULL — handle it.
  store,      // the store module (all mutations go through it)
  navigate,   // navigate('/g/abc') or navigate('/', { back: true })
  refresh,    // re-render the current view (call after a local-only change)
  toast,      // toast('Saved', { type: 'success' })
}
```

The store notifies subscribers on every mutation and `main.js` re-renders, so
**after a store call you usually do NOT need to call `refresh()`**. Use
`refresh()` only for view-local UI state (a filter, an expanded row).

## Hard rules

1. **Never** use `innerHTML`, `outerHTML`, `insertAdjacentHTML`, or build HTML
   strings. Group names, member names and notes can come from an imported
   share link and are untrusted. Use `h()` from `js/util/dom.js`, which only
   ever sets `textContent`.
2. **Never** do float arithmetic on money. Amounts are integer minor units.
   Use `js/money.js` (`parseAmount`, `formatMoney`, `allocate`) and
   `js/split.js` (`resolveSplit`).
3. Use the existing CSS classes (see `styles/components.css`). Do not invent
   new class names unless the component genuinely does not exist; if you must,
   add the CSS to `styles/components.css` in the same style.
4. Tap targets ≥ 42px. Inputs use `font-size: 16px` on mobile (already handled
   by the `.input` class — just use it).
5. Every interactive element is a real `<button>` or `<a>` with an accessible
   name. Icon-only buttons get `aria-label`.
6. Handle empty states and `group === null` (deleted / bad URL) gracefully.
7. Match the surrounding code's comment density: comment the *why* of
   non-obvious decisions, not the obvious *what*.

## Modules you should use (read them before writing)

- `js/util/dom.js` — `h(spec, props, children)`, `append`, `clear`, `frag`,
  `icon(ICONS.x)`, `ICONS`, `avatar(member, size)`, `initials`, `debounce`
- `js/ui/components.js` — `openSheet`, `confirmAction`, `promptText`, `toast`,
  `field`, `segmented`, `emptyState`, `listItem`
- `js/money.js` — `parseAmount`, `formatMoney`, `toDecimalString`, `allocate`,
  `CURRENCIES`, `currencyByCode`, `decimalsFor`
- `js/split.js` — `resolveSplit`, `seedParticipants`, `resolvePayers`,
  `SPLIT_MODES`, `PERCENT_SCALE`
- `js/balance.js` — `netBalances`, `pairwiseDebts`, `simplifiedDebts`,
  `groupTotals`, `categoryTotals`
- `js/schema.js` — `CATEGORIES`, `GROUP_TYPES`, `MEMBER_COLORS`
- `js/util/date.js` — `todayISO`, `formatDate`, `monthLabel`, `relativeDay`,
  `compareISO`, `isValidISO`
- `js/recurring.js` — `FREQUENCIES`, `describeFrequency`, `nextOccurrence`, `upcoming`
- `js/store.js` — see below
- `js/export/csv.js`, `js/export/text.js`, `js/export/json.js`,
  `js/export/download.js` (`downloadCsv`, `downloadJson`, `downloadText`,
  `copyText`, `shareText`, `pickFile`)
- `js/share.js` — `encodeGroupLink`, `decodeGroup`, `readShareCodeFromHash`

## Store API (all mutations)

```
init() subscribe(fn) getState() getGroup(id) flush()
getStorageWarning() clearStorageWarning()
updateSettings(patch) setActiveGroup(id)
createGroup({name, type, currency, memberNames}) -> id
updateGroup(id, patch) deleteGroup(id)
importGroup(rawGroup, {replaceId}) -> id
replaceState(rawState) -> groupCount
addMember(groupId, name) -> id
renameMember(groupId, memberId, name)
canRemoveMember(groupId, memberId) -> {ok, reason}
removeMember(groupId, memberId)            // throws if not removable
addExpense(groupId, expense) -> id
updateExpense(groupId, expenseId, patch)
deleteExpense(groupId, expenseId)
addSettlement(groupId, {fromMemberId, toMemberId, amountMinor, date, notes}) -> id
deleteSettlement(groupId, settlementId)
addTemplate(groupId, template) -> id
updateTemplate(groupId, templateId, patch)
deleteTemplate(groupId, templateId)
runRecurring(today?) -> [{groupId, groupName, count}]
```

## Data shapes

```js
Group {
  id, name, type,                       // type is a GROUP_TYPES id
  currency: { code: 'INR', symbol: '₹' },
  members: [{ id, name, color }],
  expenses: [Expense],
  settlements: [Settlement],
  recurring: [Template],
  createdAt, updatedAt,
}

Expense {
  id, title, category, notes,
  date: 'YYYY-MM-DD',
  amountMinor: int,                                  // > 0
  payers: [{ memberId, amountMinor }],               // sums to amountMinor
  split: { mode, participants: [{ memberId, value }] },
  owedMinor: { [memberId]: int },                    // sums to amountMinor
  recurringId?, createdAt, updatedAt,
}

Settlement { id, fromMemberId, toMemberId, amountMinor, date, notes, createdAt }

Template {
  id, active, frequency, interval,
  startDate, nextDueDate, endDate, lastGeneratedDate,
  expense: { ...Expense without id/date },
}
```

**Invariant:** for every expense, `sum(payers.amountMinor) === amountMinor`
and `sum(owedMinor values) === amountMinor`. An expense violating this is
silently dropped on next load by `js/schema.js`. Always build expenses via
`resolveSplit`.

## Routes already registered in `js/main.js`

```
/                  groups.js       (also /groups)
/g/:id             group.js        expense list
/g/:id/balances    balances.js     balances + settle up
/g/:id/members     members.js
/g/:id/recurring   recurring.js
/g/:id/report      report.js       exports, share, printable report
/settings          settings.js
/import/:code      import.js
```

## Verifying your work

There is no build. Check your syntax with:

```
node --check js/ui/views/yourfile.js
```

(`node --check` works on ESM here because `package.json` has `"type":"module"`.)

Do **not** run `node --test` expecting your view to be covered; the test suite
covers the pure logic modules only. Do not modify any file outside the ones you
were assigned, and do not edit the test suite.
