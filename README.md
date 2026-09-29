# Splitly

A Splitwise-style shared-expense splitter that keeps everything in your browser.
No account, no server, no tracking. Splid-style exports: CSV, a printable
PDF report, a WhatsApp-ready text summary, JSON backups, and share links.

## Running it

There is no build step and no dependencies. Serve the folder with anything:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

Opening `index.html` directly from the filesystem mostly works, but browsers
block ES modules over `file://`, so use a local server.

## Deploying

Every file is static, so any static host works: GitHub Pages, Netlify, Cloudflare
Pages, S3. Copy the whole folder. Routing uses the URL hash, so no server-side
rewrite rules are needed and it works fine from a subfolder.

## How your data is stored

Everything lives in this browser's `localStorage`, under one key. That has real
consequences worth understanding:

- **Nothing is uploaded.** There is no backend to upload to.
- **Data is per-browser and per-device.** Your phone and your laptop hold
  separate copies. Clearing site data erases it.
- **Sharing is a snapshot, not sync.** A share link encodes the group into the
  URL fragment — the part browsers never send to a server. Whoever opens it gets
  their own independent copy. Later changes on either side do not propagate.
- **Export a backup if the data matters.** Settings → Export everything.

## The money model

Every amount is an integer number of minor units (paise, cents). No floats are
used for money anywhere, because rounding drift compounds across splits until
balances stop summing to zero.

Splitting ₹10.00 three ways gives 334 / 333 / 333, not 333.33 × 3. Remainders are
distributed by the largest-remainder method with a deterministic tie-break, so
the parts always sum to exactly the total.

Five split modes: equally, exact amounts, percentages, shares, and adjustment
(even split plus a per-person extra). Multiple payers are supported.

## Balances

Two views of the same truth:

- **Detailed** — who owes whom, derived from the actual flow of each expense.
- **Simplified** — the fewest transfers that clear everyone, via greedy
  largest-debtor/largest-creditor matching (at most n−1 payments).

## Exports

| Export | What it is |
|---|---|
| Expenses CSV | One row per expense, a column per person for paid and share. Opens in Excel or Sheets. |
| Balances CSV | Net position per person plus the suggested payments. |
| Print / PDF | A print stylesheet renders a proper report — choose "Save as PDF" in the print dialog. |
| Text summary | Plain text shaped for pasting into a group chat. |
| JSON backup | Full round-trip of every group. The only export that can restore your data. |
| Share link | One group, compressed into a URL fragment. |

CSV cells beginning with `=`, `+`, `@` or a non-numeric `-` are prefixed with an
apostrophe, so a member named `=cmd|...` cannot execute as a formula when someone
opens the export in Excel. Negative numbers are deliberately left alone so
spreadsheet sums still work.

## Tests

The money, split, balance, date, recurring, share and schema modules are pure
ES modules with no DOM dependency, so they run directly in Node:

```bash
node --test tests/
```

`package.json` exists only to set `"type": "module"` for the test runner. The
browser loads the same files unchanged.

The suite checks the properties that matter rather than just examples: split
parts always sum to the total, net balances always sum to zero, simplified
settlements always clear everyone, and share codes round-trip losslessly.

## Layout

```
index.html
styles/    base.css (tokens, dark mode) · components.css · print.css
js/
  main.js      bootstrap, view contract, app shell
  store.js     state, persistence, migrations
  schema.js    validation for anything entering state
  money.js     integer minor units, parsing, allocation
  split.js     the five split modes
  balance.js   nets, pairwise debts, simplification
  recurring.js template scheduling and catch-up generation
  share.js     group <-> share link
  export/      csv · text · json · download helpers
  ui/          router · components · expense-form · views/
  util/        dom · date · id
tests/
CONTRACT.md    the view contract, for anyone adding a screen
```

## Browser support

Targets current Chrome, Safari, Firefox and Edge. Features that are not yet
everywhere degrade rather than break: View Transitions, `<dialog closedby>` and
`CompressionStream` all have fallbacks. Calendar maths is hand-rolled rather
than using `Temporal`, which Safari does not ship.
