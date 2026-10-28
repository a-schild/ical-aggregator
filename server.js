'use strict';

const pino = require('pino');
const http = require('http');
const url = require('url');

const IcalAggregator = require('./modules/icalaggregator.js');

const hostname = '127.0.0.1';
const port = 3000;
// Init logger
const logger = pino({
  level: 'info'
//  level: 'debug'
});

const server = http.createServer(async (req, res) => {
    var query = url.parse(req.url,true).query;
    let configKey= query["config"];
    if (typeof configKey !== 'string') {
        logger.warn("No config requested");
        sendText(res, 404, 'No such config');
        return;
    }
    try {
        logger.debug("Config requested: "+configKey);
        let icalAggregator= new IcalAggregator(configKey, true);
        if (!icalAggregator.hasConfig(configKey)) {
            // Don't answer with an empty calendar, clients would remove all their events
            logger.warn("Unknown config requested: "+JSON.stringify(configKey));
            sendText(res, 404, 'No such config');
            return;
        }
        await icalAggregator.processAllCalendars();
        logger.info("After processAllCalendars");
        logger.debug("ICS Content: "+icalAggregator.getRetVal());
        res.statusCode = 200;
        // configKey is a key from config.json here, so it is safe to put in a header
        res.setHeader('Content-Disposition', 'inline;filename='+configKey+".ics");
        res.setHeader('Content-Type', 'text/calendar;charset=utf-8');
        res.end(icalAggregator.getRetVal());
    } catch (err) {
        // A source failed: no partial calendar, the client keeps its last good copy
        logger.error("Failed to build calendar ["+configKey+"]: "+err);
        if (!res.headersSent) {
            sendText(res, 502, 'Source calendar not available');
        } else {
            res.end();
        }
    }
});

function sendText(res, statusCode, text) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'text/plain');
    res.end(text);
}

server.listen(port, hostname, () => {
  logger.info(`Server running at http://${hostname}:${port}/`);
});
