'use strict';

//
// Merge room bookings of the same event into one event
//
// ChurchTools exports one event per booked resource (room). Bookings with the
// same SUMMARY, DTSTART and DTEND are merged into one event that lists all
// rooms in LOCATION. Used when a config set has "mergeRooms": true.
//
const ICAL = require('ical.js');

//
// Reduce every LOCATION to the room name, the part before the first comma:
// "Foyer, Zentrum, Street 1, City" -> "Foyer". Used with "roomNamesOnly": true.
// Returns a new array, the input components are not modified.
//
function roomNamesOnly(events) {
    return events.map((event) => {
        const location = event.getFirstPropertyValue('location');
        if (!location) {
            return event;
        }
        const copy = clone(event);
        copy.updatePropertyWithValue('location', location.split(',')[0].trim());
        return copy;
    });
}

//
// events = array of ICAL.Component vevents (newLocation already applied)
// Returns a new array, the input components are not modified.
//
function mergeRoomBookings(events) {
    const groups = new Map();
    const result = [];
    for (const event of events) {
        // Recurring events and their exceptions belong together by UID, leave them alone
        if (event.hasProperty('rrule') || event.hasProperty('recurrence-id')) {
            result.push([event]);
            continue;
        }
        const key = JSON.stringify([
            event.getFirstPropertyValue('summary') || '',
            propertyText(event, 'dtstart'),
            propertyText(event, 'dtend')
        ]);
        let group = groups.get(key);
        if (!group) {
            group = [];
            groups.set(key, group);
            // Keep the order of the first booking
            result.push(group);
        }
        group.push(event);
    }
    return result.map((group) => group.length === 1 ? group[0] : mergeGroup(group));
}

function clone(event) {
    return new ICAL.Component(JSON.parse(JSON.stringify(event.toJSON())));
}

//
// The whole property line (params + value), so a TZID or VALUE=DATE is part of the key
//
function propertyText(event, name) {
    const prop = event.getFirstProperty(name);
    return prop ? prop.toICALString() : '';
}

function mergeGroup(group) {
    // The smallest UID stays the same as long as that booking exists,
    // so the importing calendar updates the event instead of recreating it
    const base = group.reduce((a, b) => uid(b) < uid(a) ? b : a);
    const merged = clone(base);

    setJoined(merged, 'location', group, joinLocations);
    setJoined(merged, 'description', group, (values) => values.join('\n'));

    // Newest change of any booking, so the client picks up changes to every room
    let lastModified = null;
    let sequence = null;
    for (const event of group) {
        const lm = event.getFirstPropertyValue('last-modified');
        if (lm && (!lastModified || lm.compare(lastModified) > 0)) {
            lastModified = lm;
        }
        const seq = event.getFirstPropertyValue('sequence');
        if (seq !== null && (sequence === null || seq > sequence)) {
            sequence = seq;
        }
    }
    if (lastModified) {
        merged.updatePropertyWithValue('last-modified', lastModified.clone());
    }
    if (sequence !== null) {
        merged.updatePropertyWithValue('sequence', sequence);
    }
    return merged;
}

function uid(event) {
    return event.getFirstPropertyValue('uid') || '';
}

//
// Set a text property to the joined distinct, non empty values of the group
//
function setJoined(merged, name, group, join) {
    const values = [];
    for (const event of group) {
        const value = event.getFirstPropertyValue(name);
        if (value && !values.includes(value)) {
            values.push(value);
        }
    }
    if (values.length > 0) {
        merged.updatePropertyWithValue(name, join(values));
    }
}

//
// "Foyer, Zentrum, Street 1, City" + "Küche, Zentrum, Street 1, City"
// -> "Foyer, Küche – Zentrum, Street 1, City"
// The address (the trailing parts all locations share) is written once. A location that
// is only the address (the building itself) is listed by its first part. Without a
// shared address the full locations are joined with "; ", room names only ("Foyer",
// "Küche") with ", ".
//
function joinLocations(locations) {
    const parts = [];
    for (const location of locations) {
        const p = location.split(',').map((s) => s.trim());
        if (!parts.some((q) => q.join(', ') === p.join(', '))) {
            parts.push(p);
        }
    }
    if (parts.length === 1) {
        return locations[0];
    }
    let shared = 0;
    while (shared < Math.min(...parts.map((p) => p.length))
        && parts.every((p) => p[p.length - 1 - shared] === parts[0][parts[0].length - 1 - shared])) {
        shared++;
    }
    if (shared === 0) {
        return parts.map((p) => p.join(', ')).join(parts.every((p) => p.length === 1) ? ', ' : '; ');
    }
    const address = parts[0].slice(-shared);
    const rooms = [];
    for (const p of parts) {
        const room = p.length > shared ? p.slice(0, -shared).join(', ') : address[0];
        if (!rooms.includes(room)) {
            rooms.push(room);
        }
    }
    return rooms.join(', ') + ' – ' + address.join(', ');
}

module.exports = { mergeRoomBookings, roomNamesOnly };
