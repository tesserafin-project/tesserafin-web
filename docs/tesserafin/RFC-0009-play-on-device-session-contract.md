# RFC-0009 — "Play on": device, capability and remote-session contract (P0)

- **Status**: Proposed (draft, 2026-10-24) — not accepted; selects nothing until the maintainer rules
- **Date**: 2026-10-24
- **Author**: Tesserafin Project
- **Repository**: `tesserafin-web`
- **Issue**: [`tesserafin#141`](https://github.com/tesserafin-project/tesserafin/issues/141), P0
  (contract and first-receiver selection) — the bounded preparation slot allowed by
  [`tesserafin#129`](https://github.com/tesserafin-project/tesserafin/issues/129) while M3 proceeds
- **Depends on**: RFC-0006 (three contract layers, §3.2 semantic rows, §5.4 platform-owned
  responsibilities, §1.3 no WebView) and RFC-0008 §10.3 (no Tesserafin infrastructure in the media
  path). Neither is reopened.
- **Number**: the published corpus is RFC-0001 – RFC-0008; this takes `0009`.

---

## 1. What this document is

The minimum shared meaning of **Play on…**, written before M3-D (playback) and M4 (Android TV)
adapters couple to one transport. It is a contract and a recommendation, nothing else:

- **no runtime code** in any repository, no dependency, no permission, no new endpoint;
- **no change to M3** ([`tesserafin#238`](https://github.com/tesserafin-project/tesserafin/issues/238)):
  M3 stays connection → authentication → browse/details → local playback, and gains no acceptance gate
  from this document;
- **no receiver is claimed** — a selected topology is not a delivered one.

## 2. Roles — three things that are not the same

| Role | Meaning | Example |
| --- | --- | --- |
| **Controller** | A signed-in Tesserafin client that issues commands about a session it does not render | the phone app while the TV plays |
| **Receiver** | A client that obtains media from the household server itself and renders it | the first-party Android TV app |
| **Output route** | Where a *local* player's audio/video leaves the device. Owned by the OS | Bluetooth headphones, HDMI, a speaker paired to the phone |

Consequences:

- **Bluetooth is an output route, never a receiver.** A phone playing to Bluetooth headphones is a
  local playback session; the server sees nothing different. Routing uses the platform's media-routing
  and media-session APIs when scoped; there is no server-side Bluetooth service.
- A device may hold more than one role over time (a TV is a receiver; the same TV app may later be a
  controller of another room). Roles are per session, not per device.

## 3. Identity

- A device is identified by the **server-scoped device identity issued with its authenticated
  session** (the `DeviceId` the server already keys sessions and devices on). It is meaningful only
  within one household server; two servers never compare device identities.
- **Names and network addresses are not identity.** They are display and reachability hints, and
  may change (the M3-A2 rule — "deduplication is by server `Id`" — applied one level down).
- A **remote session** is identified by the receiver's play session (`PlaySessionId`), not by the
  controller. The controller holds a reference; it never owns the identity.

## 4. Capabilities

A receiver declares what it can do. The vocabulary follows the shape M2B already landed for
`PlaybackDelivery`: a closed set **plus `Unknown(raw)`**, and **absent is distinct from unknown**.

| Capability family | Values | Rule |
| --- | --- | --- |
| Media | the receiver's decode and output profile, expressed in the server's playback-decision domain (`ClientCapabilities`, decode vs output) | never the inherited Jellyfin `DeviceProfile` / DLNA model |
| Commands | `Play`, `Pause`, `Resume`, `Seek`, `Stop`, `SetVolume`, `SetAudioTrack`, `SetSubtitleTrack` | a controller shows only declared commands; an undeclared one is `Unsupported`, not hidden silently |
| Queue / handoff | `Unsupported` for P1 | declared explicitly so a controller cannot assume it |

A controller renders "this device cannot do that" from the declaration, never from a guess about the
platform.

## 5. Session ownership and control

1. **One authoritative session.** The receiver's server play session is the source of truth for
   position, state and selected streams. Controllers display it; they do not keep a competing copy.
2. **The receiver owns the job.** Playback started on a receiver runs under the receiver's own
   (user, device). This is the "capability user *and* device" reading of
   [`tesserafin#301`](https://github.com/tesserafin-project/tesserafin/issues/301); the contract
   needs #301 settled in that direction (or an equivalent that names one owner) before P1.
3. **Authorization is checked when a command is dispatched**, on every command, against the
   receiver session's user and the controller's user — not only when sessions are listed. Same user:
   allowed. Different user: allowed only if the controller's user may control others **and** the
   receiver's user permits it. A refused command fails with a typed error; it is never dropped
   silently. P1 acceptance must prove a refused cross-user command with a real server.
4. **Stale commands are rejected.** Each session carries a monotonically increasing revision; a
   command names the revision it was issued against, and a mismatch is refused with a typed error so
   the controller re-reads state instead of seeking to a position that no longer exists.
5. **Concurrent controllers** are allowed; the revision rule serialises them. **Takeover** (moving
   the session to another receiver) is handoff and is out of P1.
6. **Stop and loss.**
   - Stop from any authorised controller ends the receiver's play session *and* its server job.
   - Controller loss (app killed, network gone) does not stop playback; a controller that returns
     re-attaches by session reference and reads current state.
   - Receiver loss ends the session; controllers observe it as ended, not as an error loop.
   - An unrelated user's session survives all of the above.

## 6. Credentials and the media path

- **A controller never hands its credential to a receiver.** The receiver authenticates to the
  household server as itself and requests its own playback plan. No bearer token, playback
  capability or household password travels in a command, a receiver URL or a log line.
- Media flows **receiver ↔ household server only**. The controller carries no media, and no
  Tesserafin-operated service is on the path (RFC-0008 §10.3).
- For contrast: the inherited Web Cast sender (`src/plugins/chromecastPlayer/plugin.js`) passes the
  user's access token to the Cast receiver. That model is **not** adopted; an external receiver needs a
  receiver-scoped, short-lived, device-bound playback capability, which depends on #301 and is part of
  why Cast is not the first path (§8).

## 7. Discovery and reachability

- **P1 is server-mediated.** A receiver is a signed-in client session that declares itself
  controllable; a controller lists receivers through the household server, filtered by §5.3's rule.
- No new local-network discovery, multicast, mDNS or Android permission is introduced for P1. The
  only network precondition is the one M3-A3 already handles: the controller and receiver each reach
  the household server.
- Client-side discovery (mDNS for Cast, Bonjour for AirPlay) belongs to the adapter that needs it and
  brings its own permission review.

## 8. Recommended first topology

**Android phone (controller) → first-party Android TV app (receiver) → household server**, local
network, receiver-fetched media, same server account on both devices.

Why this one:

- it reuses the committed platform wave (#221: M4 is Android TV) instead of adding a protocol SDK;
- it needs no credential handoff and no pairing protocol beyond signing in on both devices;
- every rule in §§3–7 can be proven end to end with two real devices and a disposable server.

Compared and not selected first:

| Candidate | Why not first |
| --- | --- |
| **Google Cast** (first external protocol) | needs a registered receiver application served from an HTTPS origin, a credential model for the receiver (§6), and the Cast SDK as a dependency on both senders. Evaluate after P1 as the first adapter onto this same contract. |
| **Fire TV** | two platforms, assessed separately: **Fire OS** is Android-derived, so the M4 app *may* run there, but store, device matrix and media behaviour need their own evidence; **Vega OS** is not Android and is covered by neither M4 nor any casting adapter. |
| AirPlay, DLNA/UPnP, vendor audio | separate adapters after one accepted path (#141 P2). |
| Bluetooth | not a receiver (§2). |

The selection is a **recommendation for the maintainer to rule on** in #141; nothing here records it
as decided.

## 9. Layer placement

- The meanings in §§2–6 are layer-2 semantics (RFC-0006 §3.2, the existing "progress, queues and
  session handoff" and "authentication and session lifecycle" rows). On Android they will live in
  `:semantic-client`, consumed by the app — **in a later, separately authorised slice**, not M3.
  Generated transport types stay behind the semantic boundary.
- Web maps the same semantics onto its own code; Google Cast, AirPlay and any vendor SDK are
  adapters underneath, never the contract.
- No plugin framework is a prerequisite.

## 10. Server prerequisites P1 will need

Recorded so P1 is not scoped against assumptions:

1. **#301 ownership** settled so a receiver-started job has one owner whose stop ends it.
2. **Dispatch-time command authorization** (§5.3) with a real-server test of a refused cross-user
   command. The inherited `Sessions/{id}/Playing|Command|System` endpoints are not adopted as the
   contract until that test exists.
3. **Session revision** (§5.4) exposed to controllers, or an equivalent stale-command guard.

## 11. Proposed P1 issues (not opened by this document)

1. `tesserafin`: authorised remote-session command dispatch + revision guard (§10.2–10.3).
2. `tesserafin-mobile`: controller semantics in `:semantic-client` and a phone controller surface —
   after M3 is accepted.
3. `tesserafin-mobile`: Android TV receiver — inside M4's scope.

P1 acceptance follows #141's plan: real sender, real receiver, disposable server and media;
discover → start → pause/seek → stop with one visible state; controller restart and network loss
observed; refused user and stale command fail safely; no credential in logs or receiver URLs; no
emulator-only receiver claim.

## 12. Explicitly later

Cast, AirPlay, handoff/takeover, queues on receivers, DLNA/UPnP, vendor connectors, multiroom,
Fire OS / Vega OS clients, Web as receiver.

## 13. Decisions requested from the maintainer

1. Accept the role split and the "receiver owns the job" rule (§§2, 5.2) — this also answers #301's
   question 1 in one direction.
2. Select the §8 topology for P1, or name another.
3. Confirm the cross-user control rule (§5.3).
