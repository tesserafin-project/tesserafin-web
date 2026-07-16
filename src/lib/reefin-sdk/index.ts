/**
 * Barrel for the generated Reefin API client (src/lib/reefin-sdk/generated/, produced by
 * `npm run generate:reefin-sdk` - see README.md in this directory).
 *
 * Not wired into any consumer yet: this module exists so the generated output has a stable,
 * reviewable entry point for the next step (swapping `@jellyfin/sdk` construction over to it),
 * without migrating any call site in this PR.
 */
export * from './generated';
