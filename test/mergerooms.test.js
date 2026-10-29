'use strict';

//
// Unit tests for merging room bookings of the same event
//
const { test } = require('node:test');
const assert = require('node:assert');

const ICAL = require('ical.js');
const { mergeRoomBookings, roomNamesOnly } = require('../modules/mergerooms.js');

function vevent(props) {
    const lines = Object.entries(props).map(([k, v]) => k + (k.endsWith(':') ? '' : ':') + v);
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', ...lines, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    return new ICAL.Component(ICAL.parse(ics)).getFirstSubcomponent('vevent');
}

function booking(uid, location, extra) {
    return vevent(Object.assign({
        UID: uid,
        DTSTAMP: '20261029T100000Z',
        SUMMARY: '2 Flügel',
        DTSTART: '20261218T110000Z',
        DTEND: '20261218T220000Z',
        LOCATION: location
    }, extra));
}

const value = (event, name) => event.getFirstPropertyValue(name);

test('merges bookings with same title, start and end', () => {
    const result = mergeRoomBookings([
        booking('c@x', 'Foyer, Zentrum'),
        booking('a@x', 'Küche, Zentrum'),
        booking('b@x', 'Seitenraum, Zentrum')
    ]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(value(result[0], 'uid'), 'a@x');
    assert.strictEqual(value(result[0], 'location'), 'Foyer, Küche, Seitenraum – Zentrum');
    assert.strictEqual(value(result[0], 'summary'), '2 Flügel');
});

test('writes the shared address once', () => {
    const addr = 'Matthäus-Zentrum\\, Lohngasse 4\\, 2562 Port';
    const result = mergeRoomBookings([
        booking('a@x', addr),
        booking('b@x', 'Foyer\\, ' + addr),
        booking('c@x', 'Seitenraum mit Küche\\, ' + addr)
    ]);
    assert.strictEqual(value(result[0], 'location'),
        'Matthäus-Zentrum, Foyer, Seitenraum mit Küche – Matthäus-Zentrum, Lohngasse 4, 2562 Port');
});

test('roomNamesOnly keeps the room name of every booking', () => {
    const addr = 'Matthäus-Zentrum\\, Lohngasse 4\\, 2562 Port';
    const input = [
        booking('a@x', addr),
        booking('b@x', 'Foyer\\, ' + addr),
        booking('c@x', 'Küche\\, ' + addr),
        booking('d@x', 'Atelier\\, ' + addr, { SUMMARY: 'Alone' }),
        booking('e@x', 'Kapelle', { SUMMARY: 'No address' }),
        vevent({ UID: 'f@x', SUMMARY: 'No location', DTSTART: '20261218T110000Z' })
    ];
    const rooms = roomNamesOnly(input);
    assert.deepStrictEqual(rooms.map((e) => value(e, 'location')),
        ['Matthäus-Zentrum', 'Foyer', 'Küche', 'Atelier', 'Kapelle', null]);
    assert.strictEqual(value(input[1], 'location'), 'Foyer, Matthäus-Zentrum, Lohngasse 4, 2562 Port');

    const merged = mergeRoomBookings(rooms);
    assert.deepStrictEqual(merged.map((e) => value(e, 'location')),
        ['Matthäus-Zentrum, Foyer, Küche', 'Atelier', 'Kapelle', null]);
});

test('joins locations without a shared address in full', () => {
    const result = mergeRoomBookings([booking('a@x', 'Kirche\\, Nidau'), booking('b@x', 'Zentrum\\, Ipsach')]);
    assert.strictEqual(value(result[0], 'location'), 'Kirche, Nidau; Zentrum, Ipsach');
});

test('locations differing only in spacing count as one', () => {
    const result = mergeRoomBookings([booking('a@x', 'Foyer\\, Zentrum'), booking('b@x', 'Foyer\\,Zentrum')]);
    assert.strictEqual(value(result[0], 'location'), 'Foyer, Zentrum');
});

test('identical bookings with the same uid collapse into one', () => {
    const result = mergeRoomBookings([booking('f@x', 'Foyer'), booking('f@x', 'Foyer'), booking('k@x', 'Küche')]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(value(result[0], 'uid'), 'f@x');
    assert.strictEqual(value(result[0], 'location'), 'Foyer, Küche');
    assert.strictEqual(result.length, 1);
});

test('takes the newest last-modified and highest sequence', () => {
    const result = mergeRoomBookings([
        booking('a@x', 'A', { 'LAST-MODIFIED': '20260223T074642Z', SEQUENCE: '1' }),
        booking('b@x', 'B', { 'LAST-MODIFIED': '20260323T091938Z', SEQUENCE: '2' })
    ]);
    assert.strictEqual(value(result[0], 'last-modified').toString(), '2026-03-23T09:19:38Z');
    assert.strictEqual(value(result[0], 'sequence'), 2);
});

test('joins different descriptions', () => {
    const result = mergeRoomBookings([
        booking('a@x', 'A', { DESCRIPTION: 'Anna' }),
        booking('b@x', 'B', { DESCRIPTION: 'Anna' }),
        booking('c@x', 'C', { DESCRIPTION: 'Beat' }),
        booking('d@x', 'D')
    ]);
    assert.strictEqual(value(result[0], 'description'), 'Anna\nBeat');
});

test('keeps bookings with other title, start or end separate', () => {
    const result = mergeRoomBookings([
        booking('a@x', 'A'),
        booking('b@x', 'B', { SUMMARY: 'Other' }),
        booking('c@x', 'C', { DTSTART: '20261218T120000Z' }),
        booking('d@x', 'D', { DTEND: '20261218T230000Z' }),
        vevent({ UID: 'e@x', SUMMARY: '2 Flügel', 'DTSTART;VALUE=DATE:': '20261218', LOCATION: 'E' })
    ]);
    assert.strictEqual(result.length, 5);
    assert.deepStrictEqual(result.map((e) => value(e, 'uid')), ['a@x', 'b@x', 'c@x', 'd@x', 'e@x']);
});

test('leaves recurring events alone', () => {
    const result = mergeRoomBookings([
        booking('a@x', 'A', { RRULE: 'FREQ=WEEKLY;COUNT=3' }),
        booking('b@x', 'B')
    ]);
    assert.strictEqual(result.length, 2);
});

test('does not modify the input events', () => {
    const input = [booking('b@x', 'B'), booking('a@x', 'A')];
    mergeRoomBookings(input);
    mergeRoomBookings(input);
    assert.strictEqual(value(input[1], 'location'), 'A');
    assert.strictEqual(value(mergeRoomBookings(input)[0], 'location'), 'B, A');
    assert.strictEqual(value(input[0], 'location'), 'B');
});
