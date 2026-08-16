# EquiCheck

Scan a web page or an HTML snippet for WCAG accessibility violations with Playwright and
axe-core, then ask an AI assistant to explain any finding and propose a fix.

Built for the Oobee accessibility automation exercise (`doc.md`).

---

## Quick start

Requires Node >= 20.19.

```bash
corepack enable                # only if `pnpm --version` fails
pnpm install
pnpm setup:browser             # one-time: downloads Chromium for Playwright
cp .env.example .env           # optional: only "Get help" needs a key
pnpm dev
```

Open http://localhost:5173. The API runs on http://localhost:3001 and the Vite dev server
proxies `/api` to it, so both halves are same-origin and there is no CORS code anywhere.

Production-shaped single process:

```bash
pnpm build
NODE_ENV=production pnpm start   # serves the built client and /api on port 3001
```

Scanning works without an API key. Only the "Get help" button needs one, and without it that
button returns a clear configuration error rather than failing silently.

### Environment variables

|Variable|Default|Purpose|
|---|---|---|
|`GEMINI_API_KEY`|none|Required for explanations. Get one from https://aistudio.google.com/apikey|
|`GEMINI_MODEL`|`gemini-2.5-flash`|Model used for explanations|
|`GEMINI_FALLBACK_MODEL`|`gemini-2.0-flash`|Tried once if the primary id is rejected as unknown|
|`PORT`|`3001`|API port|
|`ALLOW_PRIVATE_TARGETS`|`false`|When `true`, allows scanning loopback and private addresses. See [Security](#security)|
|`MAX_CONCURRENT_SCANS`|`3`|Simultaneous scans before the API returns 429|

### Commands

Everything except `start` and `setup:browser` runs through Turborepo, so each task is
cached and the two packages run in parallel.

|Command|What it does|
|---|---|
|`pnpm dev`|Both dev servers, `turbo run dev`|
|`pnpm test`|Vitest suite, 85 tests. Launches Chromium; no internet required|
|`pnpm typecheck`|`tsc --noEmit` in both packages, in parallel|
|`pnpm lint`|ESLint in both packages|
|`pnpm build`|Production client bundle|
|`pnpm lint:fix`|ESLint autofix across the repo. Not a turbo task, because it mutates source|
|`pnpm setup:browser`|`playwright install chromium`|

---

## Architecture

```
POST /api/scan  { url } | { html }
   guard URL  ->  resolve redirect chain  ->  Chromium context  ->  goto
   ->  re-check final URL  ->  axe.analyze()  ->  map + sort  ->  cache under scanId
POST /api/explain  { scanId, violationId, nodeIndex }
   look up the cached node  ->  build a grounded prompt  ->  Gemini  ->  markdown
```

```
package.json          pnpm workspace root, scripts route through turbo
pnpm-workspace.yaml   the two packages
turbo.json            the task graph
eslint.config.js      one flat config for both packages, scoped by glob
shared/wire.ts        the HTTP contract, imported type-only by both sides
server/src/
  index.ts            Express app, both routes, concurrency cap, error handler
  config.ts           env parsing plus the hard limits table
  errors.ts           ServiceError: a machine code, an HTTP status, a user-safe message
  security/
    urlGuard.ts       scheme check, DNS resolution, private-address blocklist
    followRedirects.ts  per-hop redirect validation before the browser is involved
  scan/
    browser.ts        one Chromium process, self-healing on crash
    runScan.ts        navigation policy, axe invocation, error taxonomy
    mapResults.ts     axe Result[] -> wire types, caps and ordering
    scanStore.ts      short-lived scan cache so /api/explain never trusts the client
  llm/gemini.ts       system instruction, prompt construction, error mapping
  http/rateLimit.ts   fixed-window limiter
client/src/
  App.tsx             landmarks, page state, document title
  hooks/              useScan, useHelp
  lib/                api (the only fetch), normalizeUrl, impact presentation
  components/         form, progress, summary, accordion, node card, help panel
  styles/tokens.css   the palette, with every contrast ratio recorded
```

### Repo shape

Two packages, `client/` and `server/`, rather than one flat one. A Node server and a browser
bundle want genuinely different TypeScript settings (`NodeNext` with `node` types versus
`bundler` with the DOM lib), and one `tsconfig.json` cannot express both without splitting into
two anyway. Separate packages also mean the client cannot accidentally import a server-only
module.

`shared/wire.ts` is not a third workspace package. Both sides import it with `import type`, so it
is erased at compile time and needs no build, no `paths` mapping and no `dist`. One contract, one
place, zero build machinery. It does need one line of `turbo.json`, for the reason below.

The server runs from source through `tsx` in both dev and production, with `tsc --noEmit` as a
separate typecheck. For a prototype this removes an entire build-output surface, and there is no
scenario in this exercise where the emitted JavaScript matters. It also means the server has no
`build` script at all, and deliberately not a no-op one: Turborepo silently skips packages with
no matching script, so a placeholder would only misstate the architecture.

---

## Monorepo tooling

No speed argument here. The full pipeline is **4.8 seconds cold** across two packages with no
dependency between them, so caching it saves nothing anyone will notice. If speed were the case
for adopting Turborepo, there would not be one.

The case is that the repo will not stay this size, and the config that makes a task graph
correct is cheaper to write now, at 20 lines against two packages, than to retrofit after a third
package and a CI pipeline exist. It also removed the last place this repo ran things serially by
hand: `typecheck` was a `&&` chain across two packages and now runs both at once. That is a
modest argument and it is the whole of it.

What is worth reading is the one non-obvious **cost** of adopting it, because it is a trap rather
than a feature, and it is the sort of thing that is easy to ship without noticing.

A cache can be wrong. `shared/wire.ts` is the HTTP contract, it lives at the repo root, and both
packages compile it through a relative `import type`. Turborepo hashes each package from the
files inside that package, so the contract is in neither package's input set. Rename a field on
`ScanResponse` and both packages report a **cache hit and replay a green typecheck**, while the
real `tsc` run against the new file would have failed. A stale green build is the worst thing a
cache can do, because it is silent, and plain npm scripts could never produce it: they have no
cache, so they always re-run. Adopting turbo creates this, and one line pays for it:

```json
"globalDependencies": ["shared/**"]
```

The glob rather than the single filename, because both tsconfigs already declare
`../shared/**/*.ts` as compiler input, so a second file landing in `shared/` would otherwise walk
straight back into the same hole.

Verified rather than assumed. `turbo run typecheck build test lint` twice reports
`6 cached, 6 total  >>> FULL TURBO`; appending a line to `shared/wire.ts` and rerunning reports
`0 cached, 6 total`, so every task correctly misses.

`eslint.config.js` has the same shape of problem and deliberately not the same fix. It is listed
in the `lint` task's `inputs` with `$TURBO_ROOT$` instead of in `globalDependencies`, because a
lint-rule tweak has no business invalidating the three-second Chromium test run. Also verified:
touching it misses both `lint` tasks and leaves `test` cached.

`ui` is pinned to `stream` instead of the default. `tui` gives each persistent task its own pane,
so a boot-time warning on one task sits behind a pane the reader has to switch to. `stream`
interleaves both into one scroll, which puts the Vite URL and the server's `GEMINI_API_KEY`
warning in the same view without anyone needing to know a keybinding. `clearScreen: false` in
`client/vite.config.ts` is the other half: Vite otherwise wipes the shared terminal on start and
takes the server's warning with it.

`start`, `setup:browser` and `lint:fix` stay outside turbo. The first two are a single
long-running process and a one-off OS-level download, neither of which caches meaningfully, and
`lint:fix` mutates source, which is the one thing a cache must never replay.

**Deliberately not used**, having been considered: remote caching and any Vercel account
dependency; `turbo prune`, which exists for container builds this repo does not have;
`turbo watch`, since `tsx watch` and Vite already watch their own package; `env`/`globalEnv`
allowlisting, because every environment variable here is read at runtime by `dev` and `start`,
never by a cached task; and `tags`/boundaries, which are governance for many-package repos with
separate owners.

### pnpm

`packageManager` is pinned so a reviewer gets the same resolution, and `corepack enable` picks it
up. Worth knowing: pnpm 10 blocks dependency lifecycle scripts by default, which is the right
default, and reports three as ignored here. All three were read and none is needed. esbuild's
postinstall only links a binary its per-platform package already supplies, `@google/genai`'s
preinstall is an echo, and protobufjs's postinstall writes a version warning to stderr and
touches no files. `pnpm.ignoredBuiltDependencies` records that as a decision instead of leaving a
notice on every install, and it was confirmed by a clean install followed by the full build and
all 85 tests.

pnpm not hoisting binaries is the trap worth knowing about here, and it bit this repo twice.
`eslint` had to become a devDependency of both packages, not just the root, or a package's `lint`
script cannot find it. And `setup:browser` had to become
`pnpm --filter server exec playwright install chromium`, because `playwright` belongs to the
server package and the bare command exits 127 from the root. That one mattered: it is the first
command in Quick start and the recovery step two in-app error messages tell you to run.

### ESLint

One flat config at the root, scoped by glob, rather than one per package: a rule decision gets
made once, where the tradeoffs sit next to each other. Per-package `lint` scripts keep turbo
caching the two packages independently. `eslint` is a devDependency of both packages as well as
the root, because pnpm does not hoist binaries into a package's `node_modules/.bin`.

ESLint is pinned to the 9.x line even though 10 is out, because `eslint-plugin-jsx-a11y` peers
cap at `^9`. For a tool whose entire purpose is accessibility, the a11y plugin outranks the major
version number.

Linting is **not** type-aware. `recommendedTypeChecked` was evaluated and rejected: its unique
value is the `no-floating-promises` and `no-unsafe-*` families, this code already annotates
`unknown` at every untyped boundary and narrows every `catch` before use, it would need
`projectService` plumbing for two files that belong to no tsconfig, and it would roughly triple
lint time to duplicate what two `tsc --noEmit` tasks already cover.

Two rule decisions are worth reading in `eslint.config.js` rather than skimming past:

- `no-unused-vars` gets `argsIgnorePattern: '^_'`. The load-bearing case is `handleErrors` in
  `server/src/index.ts`. Express identifies error middleware by its four-parameter arity, so
  deleting the unused `_next` would silently turn every error response into Express's default
  HTML 500 page, with no compile error and no failing test.
- `jsx-a11y/no-noninteractive-tabindex` is **widened, not disabled**, to accept `role="group"`.
  `CodeSnippet` and `MarkdownAnswer` put `tabIndex={0}` on a scrolling `<pre role="group">`
  because WCAG 2.1.1 requires a scrollable region to be keyboard reachable, which is axe's own
  `scrollable-region-focusable` rule, which this app reports to its users. The linter objects to
  code that is correct precisely because it obeys axe. When the two disagree, axe wins. The
  override is load-bearing: narrowing it back to the default `['tabpanel']` produces two errors.

The first bare `eslint .` run found exactly one real defect, in code a human review had passed:
`NodeCard` still accepted a `violationId` prop that went dead when its screen-reader label was
rewritten. Deleted, along with the argument at the call site, which `tsc` then caught separately.

---

## Decisions and trade-offs

### The scan pipeline

**One Chromium process, one `BrowserContext` per request.** Launching per request costs one to
two seconds every time and, under concurrent load, spawns one browser per in-flight scan until
the host runs out of file descriptors. A context already gives the isolation that a separate
process would: its own cookie jar, cache and storage. The tradeoff is that a crash affects
everyone, so `browser.on('disconnected')` clears the cached promise and the next request
transparently relaunches, and every context is closed in a `finally`.

**`waitUntil: 'load'`, plus a bounded three second `networkidle` that never fails the scan.**
`domcontentloaded` fires before stylesheets apply, so axe's `color-contrast` rule would read
unstyled DOM, and a client-rendered page would barely have mounted. `networkidle` alone is the
textbook answer for pages you own and the wrong answer for arbitrary ones: real sites with
analytics beacons, ad frames or websockets never go idle, so every scan would hang until the
timeout. Optimising for "never hang" over "most complete single scan" is the right call when the
input is untrusted.

**`bypassCSP: true` on the context.** `AxeBuilder` injects the axe runtime as a script. A target
serving `script-src 'self'` would block it and the scan would fail with no obvious cause. This is
safe because the injected script is our own analysis code running in a throwaway headless tab.

**All five WCAG tags, not just `wcag22aa`.** axe tags each rule with the WCAG version that
introduced it, and the tags are not cumulative, so filtering on `wcag22aa` alone silently drops
every 2.0 and 2.1 rule, which is most of them. The scan uses
`['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']`. The WCAG 2.2 rules really do fire: a scan
of the W3C "before" demo reports `target-size`, which is SC 2.5.8, new in 2.2.

**Snippet mode uses `page.setContent`, not a `data:` URL.** No size ceiling, no base64 overhead,
and the opaque-origin limitation is identical either way.

### The explain contract

`/api/explain` takes a `scanId`, a `violationId` and a `nodeIndex`, and looks the content up in a
short-lived server-side cache. It deliberately does not accept a violation payload from the
client. If it did, it would be an open proxy that forwards arbitrary text to a paid model with no
tie to anything a real scan produced, and an attacker could skip the scan pipeline entirely along
with its size caps and its rate limit. One `Map` with a fifteen minute TTL buys a real trust
boundary.

### The LLM call

Non-streaming `generateContent`. Streaming would need SSE or chunked responses on the server and
incremental markdown state on the client, and mid-stream failure handling is genuinely harder:
what does the UI show when a stream dies at token 80 of 300? For a 200-word answer capped at 900
output tokens, a spinner and then a render is the correct trade.

Guardrails are the ones the brief calls "basic", chosen by value per line of code:

- The scanned HTML is wrapped in explicit `BEGIN/END UNTRUSTED` delimiters and the system
  instruction states twice that it is evidence to inspect, never instructions to obey. Scanned
  markup is fully attacker-controlled, so "ignore previous instructions" inside an `alt`
  attribute is an expected input rather than a hypothesis.
- `maxOutputTokens: 2048` and `temperature: 0.3` cap cost per call and keep answers factual.
  The budget is generous because Gemini 2.5 and later are thinking models whose thought
  tokens draw from the same allowance, and too tight a cap finishes on `MAX_TOKENS` with
  the answer still unwritten. An empty answer falls through to the fallback model rather
  than terminating, since a non-thinking model will not spend the budget the same way.
- Model output is rendered through `react-markdown` with an element allowlist and no
  `rehype-raw`, so a `<script>` in the answer renders as visible characters.
- Errors are mapped by status: 401 and 403 become a configuration message that never mentions the
  key, 429 becomes a rate-limit message, anything else gets one fallback-model attempt.

The model id lives in the environment because Google rotates these strings. A reviewer running
this months from now can fix a retired id without touching code, and the fallback attempt means a
stale default degrades rather than kills the feature.

### The frontend

**An accordion, not tabs.** Tabs imply switching between peer views of one thing; these are N
independent findings, and comparing two of them side by side is a real workflow.

**`@radix-ui/react-accordion` rather than a hand-rolled disclosure.** The contract to get right is
`aria-expanded`, `aria-controls` and `aria-labelledby` staying in sync, plus arrow keys between
triggers, Home, End, Enter and Space, plus keeping panel content out of the accessibility tree
while collapsed. This is a tool judged by accessibility specialists, so shipping a subtly broken
custom widget is the worst available outcome and 12KB is a cheap way to avoid it. Verified
manually: ArrowDown moves between triggers, End reaches the last, Home returns to the first,
Space toggles.

**Plain CSS with custom properties, in two files.** The question an accessibility reviewer asks
is "what is the focus indicator and does it pass 3:1". With one stylesheet that is one grep. With
utility classes it means reconstructing the answer from class strings on twenty elements and then
looking up what the palette name resolves to. `tokens.css` records every contrast ratio next to
its hex value, which makes the palette itself a reviewable artifact.

**Impact is communicated four ways** and colour is the last of them: the word ("Critical"), a
glyph, sort position, and only then hue. Badge border styles also differ, solid through dotted.
In Windows High Contrast mode every badge collapses to one system colour, which is exactly why
the first three exist.

**A busy submit button uses `aria-disabled`, never the `disabled` attribute.** A truly disabled
button leaves the tab order, so the browser drops focus to `<body>` at the moment the user most
needs feedback. The label changing from "Run accessibility scan" to "Scanning..." is the state
change, and because the accessible name changes while the button holds focus, it is announced
without a live region.

**The announcement budget is three short strings, not a running commentary.** `role="status"`
regions are mounted before their content arrives and carry only short sentences. The long AI
answer and the results list are deliberately outside any live region: marking a 400-word block
live makes a screen reader read the whole thing aloud, and read it again on every re-render. The
elapsed-seconds counter is `aria-hidden`, because a one hertz counter in a live region is thirty
interruptions.

**The progress bar has no `aria-valuenow`.** The server cannot report progress, and a bar that
invents 90% is worse than an honest indeterminate one.

**Focus moves in exactly one place:** to the invalid field after a failed submit, because the user
pressed a button and nothing happened. It never moves when async content arrives; the "Get help"
button is a disclosure, so the answer is already the next thing in reading and tab order.

---

## Security

Scanning a user-supplied URL from a server is server-side request forgery by
design, so this is the part of the app that got the most attention, and a review pass
found three ways past the first version of the guard. All three are closed and pinned
by tests.

**Address classification.** `security/urlGuard.ts` rejects any scheme other than http
and https, then resolves the hostname and refuses the request if any returned record is
loopback, link-local (which covers the `169.254.169.254` cloud metadata endpoint),
RFC1918 private, carrier-grade NAT, multicast or reserved. A literal IP skips the DNS
step. If a hostname returns one public and one private record, that is a rebinding
attempt rather than a misconfiguration, and it is refused.

IPv4 is a blocklist, because the ranges to refuse are enumerable. **IPv6 is the
opposite: an allowlist of global unicast only.** That asymmetry is deliberate, and it
comes from a real bug. The first version matched IPv4-mapped addresses with a regex
against the dotted spelling, `::ffff:127.0.0.1`. WHATWG URL parsing never emits that
form: `http://[::ffff:127.0.0.1]/` normalises to hostname `[::ffff:7f00:1]`, which the
regex missed, and whose first hextet is the empty string, so the `fc00::/7` and
`fe80::/10` prefix tests missed it too. A single `AAAA` record pointing at
`::ffff:a9fe:a9fe` was a complete bypass to cloud metadata, and every downstream check
called the same classifier, so all of them were blind to it. The address is now parsed
into eight numeric hextets, IPv4-mapped, NAT64 (`64:ff9b::/96`) and 6to4 (`2002::/16`)
forms are decoded and judged as the IPv4 address they carry, and anything outside
`2000::/3` is refused without needing to be enumerated. Allow-by-omission is what
produced the hole; default-deny is what prevents the next one.

**Redirects.** A pre-flight check on the typed URL is not enough, because a target
answering `302 Location: http://169.254.169.254/` is followed transparently inside a
single `page.goto`. The obvious fix, a `context.route()` handler that re-validates each
hop, **does not work**: Playwright does not invoke route handlers for redirect hops.
That was verified experimentally rather than assumed, and the handler saw only the
initial request. So the chain is resolved in Node first, validating every hop, and the
browser then navigates directly to the final address. Resolving it this way also keeps
page fidelity, because the document origin stays correct and relative stylesheet paths
still work through the very common apex-to-www and http-to-https redirects.

**Subframes, which is where the sharpest defect was.** `@axe-core/playwright` injects
into cross-origin subframes through the CDP and merges their violations into the
result. Snippet mode registered no request guard at all, so
`{"html": "<iframe src=\"http://192.168.1.1/admin/\">"}` needed no redirect, no
rebinding and no race: the private page loaded and its markup came back inside
`violations[].nodes[].html`. Confirmed by experiment, not inferred. With the guard
disabled the same request returns `image-alt` and `link-name` carrying the internal
markup; with it enabled the frame contributes nothing. The guard is now registered
inside `withContext`, so every context has it and no call site can forget, and
`assertFinalFrames` checks every frame's post-load URL rather than just `page.url()`.
Both are pinned by tests in `runScan.test.ts`.

**Accepted residual risk.** A target can serve one redirect to the pre-flight and
another to Chromium a moment later, which is the same time-of-check/time-of-use class
as DNS rebinding. Closing it completely requires pinning the connection to the IP that
was validated, and Playwright's page-level API exposes no hook for that. What is done
instead: every frame URL is re-checked after load and before any result is returned, so
no scan data from a private address reaches the client. A blind request may still have
been made. This is stated rather than hidden because a scanner deployed for real needs
network-level egress control, not application-level string checks.

**`ALLOW_PRIVATE_TARGETS`** exists because the tool should be able to scan itself, and
its own dev server lives on `localhost`. It defaults to `false`, and the server logs a
warning on every boot when it is on.

**Other limits.** 200KB cap on a submitted snippet and a 256KB body cap to match;
the scanned target and each CSS selector are clamped before they are stored, because
both are user-influenced and both reach the LLM prompt; the scan cache is bounded by
count as well as by TTL; 20 second navigation timeout and a 40 second whole-scan
deadline that lives inside the context lifetime, so a timeout actually tears the
browser context down instead of abandoning it; three concurrent scans then 429; 30
requests per minute, keyed by IPv6 /64 rather than exact address, since a client with a
normal /64 allocation would otherwise get a fresh window per request. `trust proxy` is
off so a client cannot forge its own bucket. `/api/health` reports only whether the LLM
is configured, and deliberately not whether the address guard is switched off.

Errors carry a stable machine code and a message written for a human. Malformed JSON and
oversized bodies map to 400 and 413 rather than a generic 500. Anything unexpected is
logged server-side and reported as a generic internal error, so no stack trace or
provider message reaches the browser.

Snippet HTML is deliberately **not** sanitised. Stripping it would remove the very accessibility
bugs the tool exists to find. Safety comes from containment instead: it only ever renders inside a
disposable headless context, and it reaches the browser as escaped text in a `<pre>`, never
through `dangerouslySetInnerHTML`.

---

## Quality approach

**Tests, 85 of them, server only.** The budget went where a defect would be invisible
and serious:

- `urlGuard.test.ts`, 66 cases. The address classifier gets an exhaustive table:
  `http://2130706433/` (decimal-encoded loopback, normalised by URL parsing, which is
  why a string blocklist would miss it), every IPv6 spelling of an IPv4-mapped address
  including the hex form that actually reaches the function, NAT64 and 6to4 wrapping
  private addresses, and the boundaries that must stay allowed such as `172.32.0.1` and
  `::ffff:1.1.1.1`. The DNS-backed cases run against a stubbed resolver so they are
  deterministic and offline.
- `followRedirects.test.ts`, 6 cases against a real local HTTP server. Regression cover
  for the Playwright route-handler gap.
- `runScan.test.ts` and `runScanUrl.test.ts`, 6 cases that launch a real Chromium and
  run a real axe pass against fixtures this process serves itself, so nothing depends on
  a third party's markup staying still. Includes the private-iframe regression and the
  404-is-still-a-page behaviour. They are split into two files because one needs the
  address guard on and the other needs it off, and each should run against the
  configuration it is actually testing.
- `mapResults.test.ts`, 7 cases on the axe-to-wire mapping: field fidelity, impact
  ordering, the 2000-character clamp, the 25-node cap still reporting the true total, and
  frame-boundary selector flattening.

Not tested, on purpose: axe's own rule correctness, the model's answer content
(non-deterministic, so only the call shape and the error mapping would be worth
asserting), and the frontend, which was verified by driving a real browser instead.

**Four gates, all green, all cached.** `pnpm typecheck`, `pnpm lint`, `pnpm test` and
`pnpm build`, timed under Monorepo tooling above. Lint runs `--max-warnings 0` in both
packages. Every rule in the effective config is already `error`, so the flag changes nothing
today; it is upgrade insurance. A caret bump that adds a rule at `warn`, or moves one from
error to warn, would otherwise stop failing the build silently, and turbo would cache the exit
zero and stop printing the warnings at all on the second run.

**Verified by driving the real thing.** A live scan of the W3C "before" demo reports six
rules across 46 elements, including `target-size`, which is WCAG 2.2 SC 2.5.8, so the
cumulative tag list demonstrably picks up 2.2 rules. Keyboard-only operation of the
accordion: ArrowDown and ArrowUp move between triggers, Home and End jump to first and
last, Space toggles. The address guard exercised end to end against loopback,
link-local, decimal-encoded, RFC1918 and all four IPv6 forms. Reflow measured at 320px,
360px and 375px with no horizontal overflow. The "Get help" error path with no key
configured.

**The tool scanned with itself,** with every accordion panel expanded and a help panel
open, at both 320px and 1400px: **zero violations and zero incomplete** against all five
WCAG tag sets.

Getting to zero `incomplete` needed a real change rather than a note. axe reported
`color-contrast` as incomplete with `messageKey: nonBmp` on the decorative glyph spans
inside impact badges, because it samples DOM text and declines to judge an element whose
entire content is a symbol. The three obvious fixes are all wrong: deleting the glyph
loses the visual channel, and folding it into the badge's text run puts it in the
accessible name, where a screen reader says "multiplication x Critical". The glyph is now
CSS generated content, which `color-contrast` never looks at and which `aria-hidden` on
the host keeps out of the name either way.

**The palette is verified numerically, not by eye.** Every foreground and background pair
in `tokens.css` was computed with the WCAG relative-luminance formula. That found a
defect the self-scan could not: `--c-border-strong`, the border of text inputs and
secondary buttons, was at 2.20:1 where WCAG 1.4.11 requires 3:1 for a UI component
boundary. axe does not test that. It is now `#7c766d`, which measures at least 3.94:1
against all six surfaces it appears on. The lowest text pair in the file is 6.83:1.

**Non-colour channels checked under emulation.** Each impact level has a distinct border
style (double, solid, dashed, dotted) as well as its word and glyph, so the levels stay
distinguishable when High Contrast collapses all four to one system colour. The
forced-colors block restates only colours: using the `border` shorthand there had been
resetting `border-style` to solid and silently deleting that channel. Warning and neutral
banners carry a text prefix, because without one they were the same rounded box with the
same 5px left bar and only hue told them apart.

---

## Known limitations

- **Automated coverage.** axe finds roughly a third of accessibility problems. The UI says so in
  the footer and in the empty state, and reports axe's `incomplete` bucket as "need a human
  review" rather than folding it into the pass count.
- **Snippet mode has no base URL,** so relative stylesheet and asset paths do not load and
  contrast results can be wrong in both directions. Every snippet scan returns this as a warning.
- **Per-rule caps.** At most 25 failing elements are returned per rule and each element's markup
  is clamped to 2000 characters. The true total is always reported next to the shown count.
- **Frame-boundary selectors are flattened.** A violation inside an iframe reports its selector
  without the frame prefix.
- **Iframes are not scanned.** The request guard aborts any document request the page
  makes to a blocked address, and because the top-level pre-flight cannot vouch for a
  frame's own redirect chain, a frame that redirects into private space is stopped by the
  post-load frame check. The practical effect is that iframe content is only scanned when
  it stays on a public address throughout. Losing coverage there is the right trade against
  returning a private document's markup.
- **DNS rebinding remains open as a blind request.** See [Security](#security). No scan
  data from a private address is returned; the request may still have been issued. A real
  deployment needs network-level egress control.
- **The rate limiter is per-process and behind no proxy.** Put nginx in front and
  `trust proxy` needs revisiting, or every client collapses into one bucket.
- **In-memory state.** The scan cache and the rate limiter live in process memory, so they do not
  survive a restart and would not hold across replicas. Single-instance assumption, stated rather
  than pretended away.
- **One-shot explanations, not a conversation.** "Explain this violation" is one question. The
  wire shape extends to a `messages[]` array without a redesign if it ever needs to.
- **No persistence, no auth, no scan history.** Not asked for.
