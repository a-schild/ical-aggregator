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


## Running as webservice
```bash
node server.js
```
You can then navigate htpp://127.0.0.1:3000/?config=your_configname

It then merges the defined calendars and downlads the resulting ics file

If you wish to change the port, then you have to modify it in server.js
If you wish to allow remote access, then you have to change the hostname to 0.0.0.0 or the ip you  wish to bind to

### Install as a system service under debian
copy the file systemd/ical-aggregator.service to /etc/systemd/system
```bash
systemctl enable ical-aggregator.service
systemctl start ical-aggregator.service
systemctl status ical-aggregator.service
```


## Running in batch mode
```bash
node main.js
```

The calendars are processed and writen to the outfiles as defined in the config.json

## Validating results
Upload the generated files here
https://icalendar.org/validator.html


## ical library used
https://github.com/kewisch/ical.js
