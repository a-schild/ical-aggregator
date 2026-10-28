'use strict';

//
// Smoke test: starts server.js against a fake ChurchTools source
// and checks the merged calendar and the error handling.
//
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ICAL = require('ical.js');

const SERVER_URL = 'http://127.0.0.1:3000/';
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'source.ics'));

let fakeSource;
let serverProcess;
let workDir;

before(async () => {
    // Fake ChurchTools: /ok returns the fixture, /error an html error page
    fakeSource = http.createServer((req, res) => {
        if (req.url.startsWith('/ok')) {
            res.setHeader('Content-Type', 'text/calendar');
            res.end(fixture);
        } else {
            res.statusCode = 500;
            res.end('<html>error</html>');
        }
    });
    await new Promise((resolve) => fakeSource.listen(0, '127.0.0.1', resolve));
    const src = 'http://127.0.0.1:' + fakeSource.address().port;

    // server.js reads config.json from its working directory
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ical-aggregator-test-'));
    fs.writeFileSync(path.join(workDir, 'config.json'), JSON.stringify({
        good: {
            inputs: [
                { src: src + '/ok?security=SECRET1&id=1', description: 'room 1' },
                { src: src + '/ok?security=SECRET2&id=2', description: 'room 2', newLocation: 'New location' }
            ],
            output: { fileName: 'good.ics' }
        },
        bad: {
            inputs: [
                { src: src + '/ok?security=SECRET1&id=1', description: 'room 1' },
                { src: src + '/error?security=SECRET3&id=3', description: 'broken room' }
            ],
            output: { fileName: 'bad.ics' }
        },
        down: {
            // Nothing listens on port 1
            inputs: [ { src: 'http://127.0.0.1:1/?security=SECRET4', description: 'down' } ],
            output: { fileName: 'down.ics' }
        }
    }));

    serverProcess = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { cwd: workDir });
    serverProcess.log = '';
    await new Promise((resolve, reject) => {
        serverProcess.stdout.on('data', (chunk) => {
            serverProcess.log += chunk;
            if (serverProcess.log.includes('Server running')) {
                resolve();
            }
        });
        serverProcess.stderr.on('data', (chunk) => { serverProcess.log += chunk; });
        serverProcess.on('exit', (code) => reject(new Error('server.js exited with ' + code + '\n' + serverProcess.log)));
    });
});

after(async () => {
    if (serverProcess && serverProcess.exitCode === null) {
        // Wait for the exit, windows can't remove the working dir of a running process
        const exited = new Promise((resolve) => serverProcess.once('exit', resolve));
        serverProcess.kill();
        await exited;
    }
    if (fakeSource) {
        fakeSource.close();
    }
    if (workDir) {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
});

async function get(query) {
    const resp = await fetch(SERVER_URL + query);
    return { status: resp.status, headers: resp.headers, body: await resp.text() };
}

function assertServerAlive() {
    assert.strictEqual(serverProcess.exitCode, null, 'server.js crashed:\n' + serverProcess.log);
}

test('merges all events of all sources', async () => {
    const resp = await get('?config=good');
    assert.strictEqual(resp.status, 200);
    assert.match(resp.headers.get('content-type'), /^text\/calendar/);
    assert.strictEqual(resp.headers.get('content-disposition'), 'inline;filename=good.ics');

    const events = new ICAL.Component(ICAL.parse(resp.body)).getAllSubcomponents('vevent');
    // 3 events per source, two sources
    assert.strictEqual(events.length, 6);
    const locations = events.map((e) => e.getFirstPropertyValue('location'));
    assert.strictEqual(locations.filter((l) => l === 'New location').length, 3);
});

test('keeps all day events as dates', async () => {
    const resp = await get('?config=good');
    assert.match(resp.body, /DTSTART;VALUE=DATE:20261219/);
    assert.match(resp.body, /DTEND;VALUE=DATE:20261221/);
    assert.doesNotMatch(resp.body, /T::/);
});

test('unknown or missing config gives 404', async () => {
    assert.strictEqual((await get('?config=nope')).status, 404);
    assert.strictEqual((await get('?config=__proto__')).status, 404);
    assert.strictEqual((await get('')).status, 404);
    assertServerAlive();
});

test('header injection in config does not crash the server', async () => {
    assert.strictEqual((await get('?config=a%0d%0aX-Evil:1')).status, 404);
    assertServerAlive();
});

test('failing source gives 502 instead of a partial calendar', async () => {
    assert.strictEqual((await get('?config=bad')).status, 502);
    assert.strictEqual((await get('?config=down')).status, 502);
    assertServerAlive();
    // Still serves good calendars afterwards
    assert.strictEqual((await get('?config=good')).status, 200);
});

test('security tokens are not logged', () => {
    assert.doesNotMatch(serverProcess.log, /SECRET\d/);
});
