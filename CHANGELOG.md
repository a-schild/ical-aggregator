# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-10-29

### Added
- New config set option `mergeRooms`: bookings of several rooms for the same event (same title,
  start and end) are merged into one event that lists all rooms as location, with the shared
  address only once (`Foyer, Küche – Matthäus-Zentrum, Lohngasse 4, 2562 Port`). This also removes
  events that ChurchTools exports twice with the same UID, which made the ChurchTools import
  create a new copy every night.
- New config set option `roomNamesOnly`: the location of every event is cut to the room name
  (`Foyer` instead of `Foyer, Matthäus-Zentrum, Lohngasse 4, 2562 Port`). With `mergeRooms`,
  merged events list only their rooms (`Foyer, Küche`).

### Fixed
- Web service: the events of a calendar were added to the output a second time after all
  sources were loaded. It had no visible effect so far, but would have doubled merged events.

## [1.1.1] - 2026-10-28

### Changed
- Build pipeline uses `actions/checkout` 7 and `actions/setup-node` 7.

### Security
- `scripts/update.sh` keeps its backups in the root-only directory `/var/backups/ical-aggregator`
  instead of a predictable path in the world-writable `/var/tmp`. There, another local user could
  have read the backed up `config.json` (feed tokens) or planted files that are restored as root
  on a rollback.

## [1.1.0] - 2026-10-28

### Added
- GitHub release pipeline: pushing a version tag (e.g. `1.1.0`) builds
  `ical-aggregator-X.Y.Z.zip` and publishes a GitHub release with the notes from this changelog.
- CI on every push and pull request: syntax check, smoke tests (`npm test`) and `npm audit`.
- Dependabot keeps npm dependencies and GitHub Actions up to date.
- `scripts/update.sh` installs the latest (or a given) release on the server: backup, install,
  `npm ci --omit=dev`, service restart and health check, with automatic rollback if the service
  does not come up. It also warns when a Node.js security update is pending.

### Changed
- Updated dependencies: `ical.js` 1.5 → 2.2, `pino` 8 → 10. Requires Node.js 20 or newer.
- The service runs as its own system user `ical-aggregator` (no login shell) instead of the
  shared `daemon` user, with systemd sandboxing. `config.json` is only readable by that user.
  `scripts/update.sh` creates the user and installs the new unit.

### Fixed
- An unknown or missing `config` returns 404 instead of an empty calendar with status 200.
  An empty calendar could make the importing client delete all events it imported before.
- If a source calendar fails (error status, unreachable, no answer within 30 seconds, invalid
  content), the server answers 502 instead of crashing. No partial calendar is delivered.
- A `config` parameter with line breaks crashed the server (header injection), so anyone with
  access to the URL could take the service down.
- Calling `IcalAggregator` with `null` as config key now processes all config sets as documented.
- `config-sample.json` was not valid JSON.

### Security
- The log level is `info` instead of `debug`, and source URLs are no longer logged. Before, the
  ChurchTools `security=` token of every source and the full calendar contents ended up in the log.
  If you ran an older version, consider renewing the tokens of your ChurchTools calendar feeds.

## [1.0.0] - 2023-09-13

### Added
- First version: merges several iCal sources into one calendar, optionally overriding the
  location of all events of a source. Batch mode (`main.js`) and web service (`server.js`).
