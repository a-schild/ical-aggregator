# Ical Aggregator

This software does aggregate multiple ics source calendars into a single one.
It runs on node js (version 20 or newer).

## Installation
Make sure you have a recent nodejs version, if not, upgrade/install it this way
https://github.com/nodesource/distributions

### From a release (recommended for servers)
Download the script once and run it as root, it installs the latest release to `/opt/ical-aggregator`:
```bash
curl -fsSL -o /tmp/update.sh https://raw.githubusercontent.com/a-schild/ical-aggregator/main/scripts/update.sh
bash /tmp/update.sh
```
Alternatively download `ical-aggregator-X.Y.Z.zip` from the
[releases page](https://github.com/a-schild/ical-aggregator/releases), unpack it to `/opt`
and run `npm ci --omit=dev` in `/opt/ical-aggregator`.

### From source
Checkout https://github.com/a-schild/ical-aggregator.git
Install dependencies
```bash
npm ci
```

### Configuration
Copy config-sample.json to config.json and adapt to your needs.
config.json is read from the current working directory.

Each top level key is a calendar set with a list of `inputs` and an `output`:
- `src`: url (http or https) of the source ics calendar
- `description`: name of the source, used in the log
- `newLocation` (optional): replaces the location of all events of this source.
  The sample uses `_newLocation`, the leading `_` disables the setting.
- `output.fileName`: target file, only used in batch mode


## Running as webservice
```bash
node server.js
```
You can then navigate http://127.0.0.1:3000/?config=your_configname

It then merges the defined calendars and downlads the resulting ics file.

- If the config name is missing or unknown, the answer is 404.
- If one of the source calendars can't be loaded (error, not reachable, no answer within 30
  seconds), the answer is 502. A partial calendar is never delivered, so a client importing the
  calendar keeps its last good copy instead of deleting events.

If you wish to change the port, then you have to modify it in server.js
If you wish to allow remote access, then you have to change the hostname to 0.0.0.0 or the ip you  wish to bind to

### Install as a system service under debian
`scripts/update.sh` does all of this. To do it by hand:

The service runs as its own system user `ical-aggregator` without login shell. The code stays
owned by root, so the service can't modify it, and only the service user can read config.json
(it contains the tokens of the source calendars).
```bash
useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin ical-aggregator
chown root:ical-aggregator /opt/ical-aggregator/config.json
chmod 640 /opt/ical-aggregator/config.json
```
copy the file systemd/ical-aggregator.service to /etc/systemd/system
```bash
systemctl daemon-reload
systemctl enable ical-aggregator.service
systemctl start ical-aggregator.service
systemctl status ical-aggregator.service
```
The unit also restricts the service with systemd sandboxing (read-only file system, no home
directories, no privilege escalation).

### Updating the server
Run as root:
```bash
/opt/ical-aggregator/scripts/update.sh          # latest release
/opt/ical-aggregator/scripts/update.sh 1.1.0    # a given release
/opt/ical-aggregator/scripts/update.sh --force  # reinstall the installed version
```
The script backs up the current install to `/var/tmp/ical-aggregator-backup-*`, installs the
release (`config.json` is kept), runs `npm ci --omit=dev`, creates the `ical-aggregator` user if
needed, installs the systemd unit if it changed and restarts the service. If the service does not
answer afterwards, it restores the backup, including the previous unit. It also warns when a newer `nodejs` package
(security update) is available, but does not install it, because other services may use the same
Node.js.


## Running in batch mode
```bash
node main.js
```

The calendars are processed and writen to the outfiles as defined in the config.json

## Validating results
Upload the generated files here
https://icalendar.org/validator.html


## Development
```bash
npm ci
npm run check   # syntax check
npm test        # smoke tests: starts server.js against a fake calendar source
```
GitHub Actions runs these checks and `npm audit` on every push and pull request.
Dependabot opens pull requests for dependency updates.

## Releasing
1. Add the changes to `CHANGELOG.md` under a new `## [X.Y.Z] - YYYY-MM-DD` section.
   The release fails if this section is missing, its content becomes the release notes.
2. Set `"version"` in `package.json` to `X.Y.Z` (the release pipeline also sets it from the tag).
3. Commit, then tag without `v` prefix and push:
   ```bash
   git tag X.Y.Z && git push && git push origin X.Y.Z
   ```
4. GitHub Actions tests the build, creates `ical-aggregator-X.Y.Z.zip` and publishes the release.


## ical library used
https://github.com/kewisch/ical.js
