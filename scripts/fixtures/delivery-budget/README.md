# delivery-budget fixture

Input for `scripts/delivery-budget.test.mjs`, the controls that prove
`scripts/verify-delivery-budget.mjs` refuses.

| file | what it is |
| --- | --- |
| `stats.json` | a miniature of the graph `scripts/lib/delivery-stats-plugin.cjs` emits |
| `budget.json` | ceilings set to the EXACT measurement, no rounding margin, so one byte or one asset flips the verdict |
| `main-budget.json` | stand-in for `webpack.performance-budget.json` |
| `emitted/` | stand-in build output the verifier reads and compresses |

Two things about `emitted/` are deliberate:

* it is **not** called `dist/`, because the repository's `.gitignore` excludes `dist` at any depth
  and a committed fixture that git refuses to track is not a fixture;
* it is excluded from Biome in `biome.json`. These files exist to have exact byte sizes, not to be
  read as source. Formatting them would silently change every measurement `budget.json` pins, and
  the controls would start failing for a reason that has nothing to do with the verifier.

If you change anything under `emitted/`, re-measure and update `budget.json`:

```
node scripts/verify-delivery-budget.mjs --report-only \
  --budget scripts/fixtures/delivery-budget/budget.json \
  --main-budget scripts/fixtures/delivery-budget/main-budget.json \
  --stats scripts/fixtures/delivery-budget/stats.json \
  --dist scripts/fixtures/delivery-budget/emitted
```
