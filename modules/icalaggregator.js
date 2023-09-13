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



class IcalAggregator {

    //
    // Create a Ical aggregator
    //
    // requestedConfigKey = Name of config key from te config.json file, can be null to process all
    // requestedWriteToStdOut = Write to stdout instead of the file specified in the config
    //
    constructor(configKey, writeToStdOut) {
        // Init logger
        this.logger = pino({
          //level: 'info'
          level: 'debug'
        });

        // this.logger.error("Calling constructor");
        this.configKey= configKey;
        this.writeToStdOut= writeToStdOut;
        let rawdata = fs.readFileSync('config.json');
        this.configData = JSON.parse(rawdata);
    }
    


    // Nested array holding all output calendar events
    // In the first array, we have the config key
    newCalendarContent= [];
    // Requested config to be processed, or null for all
    configKey= null;
    // The loaded json config
    configData= null;
    // Write to file or to stdOut
    writeToStdOut= false;

    async processAllCalendars() {
        for (let key in this.configData) {
            if (typeof this.configKey === 'undefined' || this.configKey === key) {
                this.logger.debug("Processing ["+key+"]");
                this.newCalendarContent[key]= [];
                let singleConfig= this.configData[key];
                await this.processCalendarSet(key, singleConfig);
            } else {
                this.logger.debug("Not processing config set: "+key);
            }
        }
    }

    //
    // Process all calendar entries for this config key
    //
    async processCalendarSet(key, singleConfig) {
        this.logger.debug(singleConfig.inputs.length);
        this.logger.debug(singleConfig.output);
        this.allProcessed= [];

        let comp = new ICAL.Component(['vcalendar', [], []]);
        comp.updatePropertyWithValue('prodid', '-//iCal.js churchtool calendar merger');
        comp.updatePropertyWithValue('version', '2.0');
        comp.updatePropertyWithValue('calscale', 'GREGORIAN');

        if (this.writeToStdOut) {
            for (let ls of singleConfig.inputs) {
                await this.loadCalendarFromSource(ls, key);
            }
            this.logger.debug("All calendars processed");

            for (const srcEvent of this.newCalendarContent[key]) {
                // Add the new component
                comp.addSubcomponent(srcEvent);
            }
            // this.logger.debug("Output to: "+config.output);
            this.logger.debug("Output to console");
            this.retVal= comp.toString();
        } else {
            for (let ls of singleConfig.inputs) {
                this.allProcessed.push(this.loadCalendarFromSource(ls, key));            
            }
        }
        Promise.all(this.allProcessed).then((values) => {
            this.logger.debug("All calendars processed");
            //this.logger.debug("Values: "+values);
            //this.logger.debug(this.newCalendarContent[key]);

            for (const srcEvent of this.newCalendarContent[key]) {
                // Add the new component
                comp.addSubcomponent(srcEvent);
            }
            // this.logger.debug("Output to: "+config.output);
            if (this.writeToStdOut) {
                this.logger.debug("Output to console");
                this.retVal= comp.toString();
            } else {
                this.logger.debug("Output to file: "+singleConfig.output.fileName);
                fs.writeFile(singleConfig.output.fileName, this.fixFullDayEvents(comp.toString()), err => {
                    if (err) {
                        console.error(err);
                        this.logger.error(err);
                    }
                    // file written successfully
                });    
            }
        });
        this.logger.info("Finished processall");
    }

    //
    // Read a calendar from an url
    // and start processing entries
    //
    async loadCalendarFromSource(source, key) {    
        this.logger.info("Reading ics file from: "+source.src);
        var buf = await this.httpGet(source.src);
        var calContent= buf.toString('utf-8');
        this.logger.debug("Calendar content: "+calContent);
        // Get the basic data out
        var jCalData = ICAL.parse(calContent);
        this.logger.debug("jcal data length: "+jCalData.length);
        var comp = new ICAL.Component(jCalData);
        var vevents = comp.getAllSubcomponents("vevent");
        if (Array.isArray(vevents)) {
            this.logger.debug("vevent: "+vevents);
            this.logger.debug("vevent length: "+vevents.length);
            vevents.forEach(this.addJCalEvent.bind(this, source, key));
        }
    }

    //
    // Add calendar entries to newCalendarContent
    // and modifry entry if required
    //
    addJCalEvent(calendarSrc, key, jCalEventData) {
//        console.info("Logger: "+this.logger);
//        console.info("Key: "+key);
//        console.info("Event: "+jCalEventData);
        this.logger.debug("jcal src: "+calendarSrc.src+" key["+key+"]");
        this.logger.debug("vevent: "+jCalEventData);
        var event = new ICAL.Event(jCalEventData); 
        this.logger.debug("jcal new location: "+calendarSrc.newLocation);
        if (typeof calendarSrc.newLocation !== 'undefined') {
            this.logger.info("Updating location from ["+event.location+"] to ["+calendarSrc.newLocation+"]");
            event.location= calendarSrc.newLocation;
        }
//        this.logger.debug("jcal event data: "+jCalEventData);
        this.newCalendarContent[key].push(jCalEventData);
    //    var comp = new ICAL.Component(jCalData);
    //    this.logger.debug("jcal data comp: "+comp);
    //    if (comp.vevent != null) {
    //        var vevent = comp.getFirstSubcomponent("vevent");
    //        this.logger.debug("jcal vevent: "+vevent);
    //    }
    };


    httpGet(url) {
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
            this.logger.error("Error in retrieving calendar from ["+url+"] "+err);
          reject(err);
        });
      });
    }
    
    getRetVal() {
        return this.retVal;
    }
    
    fixFullDayEvents(sourceIcal) {
        let r1Result= sourceIcal.replace(/DTSTART:(\d\d\d\d)-(\d\d)-(\d\d)T::/gm, "DTSTART:$1$2$3");
        return r1Result.replace(/DTEND:(\d\d\d\d)-(\d\d)-(\d\d)T::/gm, "DTEND:$1$2$3");
    }
}

module.exports= IcalAggregator;
