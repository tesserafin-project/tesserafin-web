# OneAmp WebAssembly module: provenance

`oneamp_wasm.wasm` is vendored from OneAmp. It is built outside Tesserafin's CI, and web CI
contains no Rust build (decision in `docs/tesserafin/oneamp-web-host-contract.md` §12).
`tests/oneamp/provenance.test.ts` checks that the file's sha256 matches the value recorded
below.

That check proves the vendored file is **intact**. It does not prove that the file was built
from the source named here. That rests on the build inputs recorded below, and on a reviewer
rebuilding the module whenever the pin changes (contract §10).

## Source

| Item | Value |
|---|---|
| Repository | <https://github.com/all3f0r1/oneamp> |
| Commit | `d7d8c82e16fdd54d1e580a6e83ed09bee6e295bf` (`main`, 2026-11-05, `v1.4.1-1-gd7d8c82`; all3f0r1/oneamp#4) |
| Crate | `oneamp-wasm` 1.4.1, with `oneamp-core` 1.4.1 (`default-features = false`) |
| `Cargo.lock` at that commit | sha256 `70de3a1a1a92ecf53a24f3bc66c57b5bd47a0d689c8eaa98d43e7ab96e96b6f4` |

Since the contract's audit pin `c2eb12157d` (v1.4.1), all3f0r1/oneamp#4 changed only the
reference JavaScript glue, the docs and the tests. No Rust source changed, and the module is
byte-identical to the audit build (same sha256 as contract §1).

## Build

```sh
git -C oneamp checkout d7d8c82e16fdd54d1e580a6e83ed09bee6e295bf
cargo clean --release --target wasm32-unknown-unknown
cargo build -p oneamp-wasm --target wasm32-unknown-unknown --release --locked
sha256sum target/wasm32-unknown-unknown/release/oneamp_wasm.wasm
```

Toolchain (`rustc -vV`), Linux x86_64 host:

```
rustc 1.99.1 (58cf8f9c3 2026-10-13)
binary: rustc
commit-hash: 58cf8f9c35b355199727627d07ae34a4e2846d67
commit-date: 2026-10-13
host: x86_64-unknown-linux-gnu
release: 1.99.1
LLVM version: 23.1.1
```

`cargo 1.99.1 (5f94df478 2026-08-27)`. The `wasm32` output is not assumed to be
byte-reproducible across rustc versions: to reproduce this hash, use this toolchain.

## Artifact

| Item | Value |
|---|---|
| File | `oneamp_wasm.wasm` |
| Size | 158,378 bytes (66,637 bytes `gzip -9`) |
| sha256 | `e741630f4a333430bc630bae04b9efec05f76f0ba22694684457242e5e030b84` |
| Imports | none (`WebAssembly.Module.imports(m).length === 0`) |

## Licences

OneAmp is `MIT OR Apache-2.0`. Tesserafin Web is `GPL-2.0-or-later` and takes the **MIT**
option for OneAmp and for every crate linked into the module. The notices are in
`LICENSES/`.

| Crate | Version | Licence (option taken) | Authors | Notice |
|---|---|---|---|---|
| oneamp-wasm, oneamp-core | 1.4.1 | MIT OR Apache-2.0 (MIT) | all3f0r1 | `LICENSES/OneAmp-MIT.txt` |
| anyhow | 1.0.104 | MIT OR Apache-2.0 (MIT) | David Tolnay | `LICENSES/anyhow-MIT.txt` |
| itoa | 1.0.18 | MIT OR Apache-2.0 (MIT) | David Tolnay | `LICENSES/itoa-MIT.txt` |
| memchr | 2.8.3 | Unlicense OR MIT (MIT) | Andrew Gallant, bluss | `LICENSES/memchr-MIT.txt` |
| serde, serde_core | 1.0.229 | MIT OR Apache-2.0 (MIT) | Erick Tryzelaar, David Tolnay | `LICENSES/serde-MIT.txt`, `LICENSES/serde_core-MIT.txt` |
| serde_json | 1.0.151 | MIT OR Apache-2.0 (MIT) | Erick Tryzelaar, David Tolnay | `LICENSES/serde_json-MIT.txt` |
| zmij | 1.0.23 | MIT | David Tolnay | `LICENSES/zmij-MIT.txt` |

Build-time only, not linked into the module, so no notice is shipped: `serde_derive`
1.0.229, `proc-macro2` 1.0.107, `quote` 1.0.47, `syn` 3.0.6, all `MIT OR Apache-2.0`, and
`unicode-ident` 1.0.26, `(MIT OR Apache-2.0) AND Unicode-3.0`.

The list comes from `cargo tree -p oneamp-wasm --target wasm32-unknown-unknown -e normal,build`
and `cargo metadata --locked` at the commit above.

## Glue

`oneampWorklet.js` is Tesserafin-owned. It is derived from OneAmp's
`oneamp-wasm/www/oneamp-worklet.js` at the same commit (MIT) and implements the contract's
§4.4 protocol. OneAmp's main-thread helper `www/oneamp.js` is not used.

## Changing the pin

1. Rebuild with the commands above at the new commit, with the toolchain recorded here or a
   new one recorded in its place.
2. Replace the file, update every value in this record, and re-check the crate list and the
   notices.
3. Run `npx vitest --watch=false tests/oneamp`: the provenance test and the worklet tests
   against the real module.
