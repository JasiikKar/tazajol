// Observer pattern: services publish domain events, observers (e.g. notifier) subscribe.
const { EventEmitter } = require('events');
module.exports = { createBus: () => new EventEmitter() };
