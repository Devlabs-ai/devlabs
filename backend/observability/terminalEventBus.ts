'use strict';

import type { EventEmitter } from 'events';

const EventEmitterClass = require('events');

const bus: EventEmitter = new EventEmitterClass();
bus.setMaxListeners(100);

module.exports = bus;
