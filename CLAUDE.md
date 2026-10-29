# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A small Node.js tool that merges several remote `.ics` calendars into one, optionally overriding
the `LOCATION` of every event from a given source. Built on [ical.js](https://github.com/kewisch/ical.js)
with [pino](https://github.com/pinojs/pino) for logging (ical.js 2.x is ESM, but `require('ical.js')`
resolves to its CJS build). Node.js >= 20 (production runs Debian 13's Node 20). No build step, no linter.

## Commands

```bash
npm ci               # install dependencies (ical.js, pino)
node main.js         # batch mode (= npm start): process every config set, write each to output.fileName
node server.js       # HTTP mode: http://127.0.0.1:3000/?config=<configKey> returns the merged ics
npm run check        # node --check on all js files
npm test             # node:test: test/server.test.js (smoke) + test/mergerooms.test.js (unit)
node --test --test-name-pattern="502" # a single test by name
```

`test/server.test.js` spawns `server.js` in a temp dir with its own `config.json` and a fake
source serving `test/fixtures/source.ics` (synthetic data). It needs port 3000 to be free. Don't put
`sample/ChurchTools.ics` into tests or commits: it is real data and the repo is public.

Host and port are hardcoded at the top of `server.js` (`127.0.0.1:3000`). Validate output at
https://icalendar.org/validator.html.

## Configuration

`config.json` (git-ignored; copy from `config-sample.json`) is read **relative to the current
working directory**, so both entry points must be started from the repo root (the systemd unit sets
`WorkingDirectory=/opt/ical-aggregator`). Each top-level key is a "config set":

- `inputs[]`: `src` (http/https URL), `description`, optional `newLocation`. Keys prefixed with
  `_` (e.g. `_newLocation`) are effectively commented out, because the code only checks `newLocation`.
- `mergeRooms` (optional, `true` to enable): merge the room bookings of the same event, see below.
- `roomNamesOnly` (optional, `true` to enable): cut every LOCATION of the set to the part before
  the first comma. It runs before `mergeRooms`, so merged events list only room names.
- `output.fileName`: target file, used in batch mode only.

`config.kgn.json` is an untracked real-world config containing feed tokens. Never commit it.

## Architecture

There are **two independent copies of the merge logic**, and they are not shared:

- `main.js`: the original standalone batch script with module-level state (`newCalendarContent`).
  It does not use `modules/`.
- `modules/icalaggregator.js`: the `IcalAggregator` class, used only by `server.js`.
  `new IcalAggregator(configKey, writeToStdOut)` → `await processAllCalendars()` → `getRetVal()`.
  With `writeToStdOut=true` the sources are fetched sequentially and the result is kept in
  `retVal`; with `false` it starts the fetches in parallel and writes the file in an un-awaited
  `Promise.all`. The server always passes `true`, and the class reads `config.json` again on each request.

If you fix something in the merge pipeline, check whether it needs to go into both files.
The exception is `modules/mergerooms.js` (`mergeRoomBookings()`, config set option
`mergeRooms`), which both entry points require. It groups bookings by SUMMARY + DTSTART + DTEND
(exact property text) and keeps the smallest UID. `joinLocations()` writes the trailing comma
separated parts that all locations share (the address) once: `Foyer, Küche – <address>`.
`roomNamesOnly()` lives there too. It never mutates its
input. In stdout mode only the first branch of `processCalendarSet()` adds events; the
`Promise.all` block is for file mode only. Running both added fresh merged components twice.

`server.js` answers 404 for a missing or unknown `config` key and 502 if any source fails
(non-200 status, unreachable, 30 s timeout, or unparsable content). It never sends an empty or
partial calendar with 200, because ChurchTools would then delete the events it imported earlier.
Only a key confirmed by `hasConfig()` may go into the `Content-Disposition` header; raw query
input with CR/LF makes `setHeader` throw.

Pipeline (same in both): HTTP GET each `src` → `ICAL.parse` → collect every `vevent`
subcomponent (applying `newLocation` through `ICAL.Event`) → add them to a new `vcalendar`
(prodid `-//iCal.js churchtool calendar merger`, version 2.0, GREGORIAN) → `toString()` →
`fixFullDayEvents()`. Only VEVENTs are copied; VTIMEZONE and other components from the sources
are dropped.

`fixFullDayEvents()` is a regex post-processing workaround. ical.js serialises all-day dates in this
setup as `DTSTART:2023-09-12T::`, and the regex rewrites them to `DTSTART:20230912`. Keep it, or
replace it with a real fix, whenever you change how events are copied.

Logging levels are hardcoded to `info` (in `main.js`, `server.js` and the `IcalAggregator`
constructor). Source URLs carry the ChurchTools `security=` token, so never log `source.src` at
`info` or above. The `debug` level logs those URLs and the full calendar contents.

Production runs on `helpers.ref-nidau.ch` in `/opt/ical-aggregator` as a systemd service,
behind Apache at `/ical-aggregator/`. Its real `config.json` points to `ref-nidau.church.tools`;
the local `config.kgn.json` still has the old, dead `tools.ref-nidau.ch` URLs. ChurchTools imports
the merged feeds itself, once a night at about 03:20 (for example into the "Belegung Ipsach" calendar).
To inspect what ChurchTools gets, fetch the public URL
`https://helpers.ref-nidau.ch/ical-aggregator/?config=<configKey>` (e.g. `config_ipsach`). The
output holds no feed tokens. The `tools/collect` helper in the Aarboard infrastructure repo can't
fetch it, and it must never fetch `/opt/ical-aggregator` (its `config.json` holds the tokens).

`sample/ChurchTools.ics` is a sample source feed (the main upstream is ChurchTools), useful for
manual testing.

## Changelog and releases

Keep `CHANGELOG.md` (Keep a Changelog format) current: add every user-facing change under
`[Unreleased]`. To release:

1. Move the entries into a new `## [X.Y.Z] - YYYY-MM-DD` section. `release.yml` extracts that
   section as the GitHub release notes and fails if it is missing or empty.
2. Bump `"version"` in `package.json` (the pipeline also injects it from the tag).
3. Commit (`chore(release): X.Y.Z`), tag **without** a `v` prefix and push the tag:
   `git tag X.Y.Z && git push && git push origin X.Y.Z`.

`.github/workflows/release.yml` re-runs check/test/audit, zips the runtime files (no
`node_modules`, no tests) as `ical-aggregator/` in `ical-aggregator-X.Y.Z.zip` and publishes the
release. `ci.yml` runs on pushes to main and on PRs. Both fail on `npm audit` findings of severity
high or above in runtime dependencies. If you add a runtime file, add it to the `cp` list in
release.yml.

The server installs releases with `scripts/update.sh [X.Y.Z] [--force]` (run as root). It uses the
public GitHub API without a token, `node` instead of `jq` to parse JSON, keeps `config.json`,
backs up to `/var/backups/ical-aggregator/<mktemp dir>` (root 700, never `/var/tmp`: the backup holds
the tokens and is restored as root), runs `npm ci --omit=dev`, restarts the service and rolls back if
`http://127.0.0.1:3000/` doesn't answer 404. It only warns about pending `nodejs` apt updates,
because the Node runtime is shared with other services on that host (kgn-reservations).
It also creates the `ical-aggregator` system user (nologin), sets `config.json` to
`root:ical-aggregator 640`, installs `systemd/ical-aggregator.service` when it differs, and on
rollback restores the old unit and the old `config.json` owner/mode.

The unit uses `ProtectSystem=strict`, so the service can't write anywhere. If the web service
ever needs to write files, add a `ReadWritePaths=` entry. Batch mode (`main.js`) writes output
files and is not run through this unit.
SSH to the server is on port 2560.
