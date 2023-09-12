/* 
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Other/javascript.js to edit this template
 * 
 * https://github.com/kewisch/ical.js
 *  */

'use strict';

//
// Import dependencies
//
const ICAL= require("ical.js");
const pino = require('pino');
const fs = require('fs');

// Init logger
const logger = pino({
  level: 'info'
//  level: 'debug'
});

// Nested array holding all output calendar events
// In the first array, we have the config key
let newCalendarContent= [];

let rawdata = fs.readFileSync('config.json');
let config = JSON.parse(rawdata);
for (let key in config) {
    logger.debug("Processing ["+key+"]");
    newCalendarContent[key]= [];
    let singleConfig= config[key];
    processCalendarSet(key, singleConfig);
}

function processCalendarSet(key, singleConfig) {
    logger.debug(singleConfig.inputs.length);
    logger.debug(singleConfig.output);
    let allProcessed= [];

    for (let ls of singleConfig.inputs) {
        allProcessed.push(loadSource(ls, key));
    }
    Promise.all(allProcessed).then((values) => {
        logger.debug("Values: "+values);
        logger.debug(newCalendarContent[key]);

        let comp = new ICAL.Component(['vcalendar', [], []]);
        comp.updatePropertyWithValue('prodid', '-//iCal.js churchtool calendar merger');
        comp.updatePropertyWithValue('version', '2.0');
        comp.updatePropertyWithValue('calscale', 'GREGORIAN');
        for (const srcEvent of newCalendarContent[key]) {
            // Add the new components
            comp.addSubcomponent(srcEvent);
        }
        // logger.debug("Output to: "+config.output);
        logger.info("Output to: "+singleConfig.output.fileName);
        fs.writeFile(singleConfig.output.fileName, comp.toString(), err => {
            if (err) {
                console.error(err);
            }
            // file written successfully
        });    
    });
}

//
// Read a calendar from an url
// and start processing entries
//
async function loadSource(source, key) {    
    logger.info("Reading ics file from: "+source.src);
    var buf = await httpGet(source.src);
    var calContent= buf.toString('utf-8');
    // logger.debug(calContent);
    // Get the basic data out
    var jCalData = ICAL.parse(calContent);
    logger.debug("jcal data length: "+jCalData.length);
    var comp = new ICAL.Component(jCalData);
    var vevents = comp.getAllSubcomponents("vevent");
    if (Array.isArray(vevents)) {
        // logger.debug("vevent: "+vevents);
        vevents.forEach(addJCalEven.bind(null, source, key));
        // logger.debug("vevent length: "+vevents.length);
    }
}
    
//
// Add calendar entries to newCalendarContent
// and modifry entry if required
//
function addJCalEven(calendarSrc, key, jCalEventData) {
    logger.debug("jcal src: "+calendarSrc.src+" key["+key+"]");
    logger.debug("vevent: "+jCalEventData);
    var event = new ICAL.Event(jCalEventData); 
    // logger.debug("jcal new location: "+calendarSrc.newLocation);
    if (typeof calendarSrc.newLocation !== 'undefined') {
        logger.info("Updating location from ["+event.location+"] to ["+calendarSrc.newLocation+"]");
        event.location= calendarSrc.newLocation;
    }
    logger.debug("jcal event data: "+jCalEventData);
    newCalendarContent[key].push(jCalEventData);
//    var comp = new ICAL.Component(jCalData);
//    logger.debug("jcal data comp: "+comp);
//    if (comp.vevent != null) {
//        var vevent = comp.getFirstSubcomponent("vevent");
//        logger.debug("jcal vevent: "+vevent);
//    }
};


function httpGet(url) {
  return new Promise((resolve, reject) => {
    const http = require('http'),
      https = require('https');

    let client = http;

    if (url.toString().indexOf("https") === 0) {
      client = https;
    }

    client.get(url, (resp) => {
      let chunks = [];

      // A chunk of data has been recieved.
      resp.on('data', (chunk) => {
        chunks.push(chunk);
      });

      // The whole response has been received. Print out the result.
      resp.on('end', () => {
        resolve(Buffer.concat(chunks));
      });

    }).on("error", (err) => {
        logger.error("Error in retrieving calendar from ["+url+"] "+err);
      reject(err);
    });
  });
}
