
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
    if (typeof query["config"] !== 'undefined') {
        logger.debug("Config requested: "+query["config"]);
        let icalAggregator= new IcalAggregator(query['config'], true);
        await icalAggregator.processAllCalendars();
        logger.info("After processAllCalendars");
        logger.debug("ICS Content: "+icalAggregator.getRetVal());
        res.statusCode = 200;
        res.setHeader('Content-Disposition', 'inline;filename='+query["config"]+".ics");
        res.setHeader('Content-Type', 'text/calendar;charset=utf-8');
        res.end(icalAggregator.getRetVal());
    } else {
        logger.warn("No config requested");
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end('No such config');
    }
});
 
server.listen(port, hostname, () => {
  logger.info(`Server running at http://${hostname}:${port}/`);
});
