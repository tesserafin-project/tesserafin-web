# Dependency audit: file input identity

This is the file-read slice of
[server #185](https://github.com/tesserafin-project/tesserafin/issues/185),
Group C (`scripts/dependency-audit.mjs`). It changes no vulnerability policy,
waiver expiry or scanner configuration.

The evaluator reads its report, lockfile and optional waiver document through
one helper. That helper opens the input, checks the opened file with `fstat`,
then reads through the same descriptor and closes it in `finally`. A missing,
non-regular, empty or unreadable input remains **INDETERMINATE (exit 2)**.
On platforms providing `O_NONBLOCK`, the open is nonblocking so a FIFO without
a writer can be rejected as non-regular instead of waiting indefinitely.

The previous `stat(path)` → `readFile(path)` sequence reopened the name after
checking metadata. Replacing the directory entry between those calls could
change which report, dependency graph or waiver set determined the verdict.
Keeping the opened descriptor removes that second pathname lookup.

## Deterministic regression evidence

`npm run test:dependency-audit -- --no-live` runs both the file controls and the
existing evaluator controls. The existing Dependency Audit workflow invokes
this command before its live scan.

The file controls invoke the actual evaluator CLI. A test-only Node preload
replaces a fixture with `rename` immediately after its metadata is checked;
it also records descriptor cleanup and injects metadata/content read failures.
The preload is enabled only in these child processes, not by production code.
Each replacement witness asserts that the replacement actually occurred.

| Replacement after metadata check | Original at `edadb9fe2c` | Fixed evaluator |
| --- | --- | --- |
| High-severity report → clean report | Clean, exit 0 | Original high finding blocks, exit 1 |
| Invalid lockfile version → valid graph | Clean, exit 0 | Original version refused, exit 2 |
| Empty waivers → matching valid waiver | Compliant with temporary waiver, exit 0 | Original unwaived finding blocks, exit 1 |

Additional controls cover clean input, I/O failures, empty/missing inputs,
directories, a live file symlink and a FIFO without a writer. Opened descriptors
must be closed on successful reads and failure paths. The Linux run exercises
all eleven cases. On Windows, the symlink/FIFO cases are skipped; no Windows
execution evidence is claimed by this change.

## Limits

An opened descriptor preserves the selected file across pathname replacement;
it does not make that file an immutable snapshot against concurrent writes to
the same underlying file. Live symlinks to regular files retain their previous
semantics: the opened target is checked. Parent-directory trust, output-file
writes and scanner/report provenance are separate concerns. These tests neither
establish a live dependency inventory nor prove default-branch CodeQL closure.
