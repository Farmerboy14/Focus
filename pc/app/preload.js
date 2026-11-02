'use strict';
// The only bridge between the windows and the app. Pages get window.focusApp with a fixed set of calls.
const { contextBridge, ipcRenderer } = require('electron');

const CALLS = [
  'state:get', 'sched:set', 'pc:set', 'steps:set', 'settings:set', 'pair:new', 'clip:send',
  'bible:text', 'bible:phone', 'journal:unlock', 'journal:save', 'pause:start', 'pause:end', 'update:check',
  'update:restart', 'procs:refresh', 'log:open', 'win:minimize', 'win:close', 'win:fullscreen', 'widget:move',
  'widget:open', 'notnow:pass', 'notnow:close', 'notnow:back', 'desk:drawn', 'phone:collapse', 'phone:shrunk', 'phone:retry', 'phone:choose', 'desk:image', 'desk:cloudinfo', 'desk:action'
];
const EVENTS = ['state', 'nav', 'notnow:show', 'fullscreen', 'phone:show', 'phone:shrink', 'phone:status', 'desk:pause', 'desk:clouds'];

contextBridge.exposeInMainWorld('focusApp', {
  invoke: function (name, arg) {
    if (CALLS.indexOf(name) < 0) return Promise.reject(new Error('unknown call ' + name));
    return ipcRenderer.invoke(name, arg);
  },
  on: function (name, cb) {
    if (EVENTS.indexOf(name) < 0) return;
    ipcRenderer.on(name, function (e, data) { cb(data); });
  }
});
