'use strict';
const DEFAULT_VERSION = process.env.MC_BEDROCK_VERSION || '1.21.90';
function createGhost({ stateKey, schemDir, stateFile, onSay = () => {}, log = () => {} }) {
  let relay = null;
  let lastStatus = { connected: false, note: 'Schematic rendering and command forwarding are not implemented in this starter.' };
  return {
    version: DEFAULT_VERSION,
    attach(r) { relay = r; log('Ghost engine attached. Schematic rendering is not implemented in this starter.'); },
    current() {
      return {
        status() { return { ...lastStatus, stateKey }; },
        async run() {
          if (!relay) throw new Error('Relay is not attached.');
          throw new Error('Command forwarding is not implemented in this starter.');
        }
      };
    }
  };
}
function defaultVersion() { return DEFAULT_VERSION; }
module.exports = { createGhost, defaultVersion };
