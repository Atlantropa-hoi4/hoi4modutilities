import { subscribeNavigators, tryRun } from './util/common';

window.addEventListener('load', tryRun(function() {
    subscribeNavigators();
}));
