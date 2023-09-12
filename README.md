# Ical Aggregator

This software does aggregate multiple ics source calendars into a single one.
It runs on node js

## Installation
Make sure you have a recent nodejs version, if not, upgrade/install it this way
https://github.com/nodesource/distributions

Checkout https://github.com/a-schild/ical-aggregator.git
Install dependencies
```bash
npm install
```
Copy config-sample.json to config.json and adapt to your needs

You can then navigate htpp://127.0.0.1:3000/?config=your_configname

It then merges the defined calendars and downlads the resulting ics file

If you wish to change the port, then you have to modify it in server.js
If you wish to allow remote access, then you have to change the hostname to 0.0.0.0 or the ip you  wish to bind to