# On-demand Google Cast sender

The browser's existing Cast integration loads Google's sender SDK only when the
user opens a remote-player menu, or previously selected Google Cast as their
saved automatic target. This is the bounded startup-loading change from #74,
not a new receiver implementation or an acceptance claim for a physical device.

## Intent and behavior

- Plugin construction, sign-in and passive target enumeration do not request
  Google's SDK or initialize a receiver.
- Modern and legacy remote-player menus ask for discovery explicitly through
  `playbackManager.getTargets({ enableDiscovery: true })`. Passive callers keep
  the default. A saved non-Google household target does not enable Google
  discovery; the existing saved Google Cast preference does.
- One SDK attempt is shared across callers/instances. Script `onload` alone is
  not readiness; wait for `chrome.cast.isAvailable`. Failure removes the script
  and permits another explicit action to retry. There is no background retry.
- Script readiness and receiver initialization each have a five-second bound.
  Receiver initialization waits for both success and initial availability;
  no receiver produces no Cast target. Other remote targets remain available
  when the Cast attempt fails.
- Target selection still invokes the existing SDK picker from a separate user
  click, after discovery, and preserves the existing session/command protocol.
- User/server identity changes invalidate pending work and old callbacks. Sign-in
  itself does not initiate discovery. Late user-lookup/SDK callbacks cannot
  activate the disposed Cast player.

SDK requests still go to the existing Google URL and the runtime-origin allowlist
remains in force. After a discovery action the SDK may perform its own network
activity; this change does not certify that third-party SDK's behavior. The
legacy Cordova/Android bridge bypass remains in the loader; native applications
and TV input behavior are not newly qualified here.

## Verification

Unit tests under `tests/chromecast/` drive the real loader and plugin through
controlled DOM/SDK boundaries, including blocked/stalled scripts, late readiness,
overlapping requests, receiver errors, user changes and picker invocation.
`src/scripts/autocast.test.ts` pins saved-preference behavior. These tests live
outside the plugin directory because the production plugin webpack context would
otherwise emit them as plugin modules.

The browser spec `tests/itemDetailsBrowser/cast.onDemand.browser.spec.ts` boots
the actual production bundle with the existing same-origin API fixture. It
covers both official themes and modern/legacy desktop menus, blocked/stalled
SDK recovery, CSP refusal and saved preferences. Positive SDK fixtures allow
only their exact controlled SDK URL through the reused reader server’s self-only
script policy; the CSP-refusal case keeps that policy. Production CSP is untouched. The Google response is a controlled SDK
fixture, not a real Google request or physical receiver:

```sh
npm run build:production
npx playwright test --config playwright.itemDetails.config.ts cast.onDemand.browser.spec.ts
```

The path-filtered, read-only `Cast on demand` workflow runs that browser proof
and the existing bundle/delivery budgets. It uploads no artifacts and changes no
required branch-protection checks. Real-device media playback, receiver
credentials, casting protocol compatibility and third-party API evolution remain
separate acceptance under server tracker #141.
