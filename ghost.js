'use strict';

const fs = require('fs');
const path = require('path');
const bedrockData = require('minecraft-data');
const prismarineBlock = require('prismarine-block');
const { Schematic } = require('prismarine-schematic');
const { Vec3 } = require('vec3');

const DEFAULT_VERSION = process.env.MC_BEDROCK_VERSION || '1.26.51';
const MAX_PREVIEW_BLOCKS = 2500;
const UPDATE_FLAGS = 2; // BlockUpdateNetwork

function createGhost({ stateKey, schemDir, stateFile, onSay = () => {}, log = () => {} }) {
  let relay = null;
  let activePlayer = null;
  let playerPosition = null;
  let loaded = null;
  let anchor = null;
  let locked = false;
  let previewCount = 0;
  let lastStatus = { connected: false, note: 'Waiting for a player through the relay.' };
  let bedrockBlocks = null;
  let bedrockMappings = null;
  let BedrockBlock = null;

  function canonicalStates(states) {
    const ordered = {};
    for (const key of Object.keys(states || {}).sort()) ordered[key] = states[key];
    return JSON.stringify(ordered);
  }

  function canonicalBlockName(name) {
    return String(name || '').replace(/^minecraft:/, '');
  }

  function tell(message) {
    onSay(message);
    if (!activePlayer) return;
    try {
      activePlayer.queue('text', {
        type: 'system', needs_translation: false, source_name: 'Ghost Bridge',
        xuid: '', platform_chat_id: '', filtered_message: '', message
      });
    } catch (e) {
      log('Could not send bridge message to player: ' + e.message);
    }
  }

  function getBedrockData() {
    if (!bedrockBlocks) {
      const data = bedrockData('bedrock_' + DEFAULT_VERSION);
      if (!data || !data.blocksByName) throw new Error('No Bedrock block palette found for ' + DEFAULT_VERSION + '.');
      if (!Array.isArray(data.blockMappings) || !Array.isArray(data.blockStates)) {
        throw new Error('Bedrock block mappings are missing for ' + DEFAULT_VERSION + '. Update minecraft-data before using schematic preview.');
      }
      bedrockBlocks = data.blocksByName;
      bedrockMappings = new Map();
      for (const mapping of data.blockMappings) {
        if (!mapping || !mapping.pc || !mapping.pe || !mapping.pc.name) continue;
        const key = canonicalBlockName(mapping.pc.name) + '|' + canonicalStates(mapping.pc.states);
        bedrockMappings.set(key, mapping.pe);
      }
      BedrockBlock = prismarineBlock('bedrock_' + DEFAULT_VERSION);
      if (!BedrockBlock || typeof BedrockBlock.getHash !== 'function') {
        throw new Error('The installed prismarine-block version cannot calculate Bedrock runtime IDs.');
      }
    }
    return bedrockBlocks;
  }

  function resolveRuntimeId(block) {
    if (!block || !block.name || ['air', 'cave_air', 'void_air'].includes(canonicalBlockName(block.name))) return 0;
    getBedrockData();
    const name = canonicalBlockName(block.name);
    const states = typeof block.getProperties === 'function' ? block.getProperties() : (block.properties || {});
    const target = bedrockMappings.get(name + '|' + canonicalStates(states));
    if (!target || !target.name) return null;
    const targetName = String(target.name).startsWith('minecraft:') ? target.name : 'minecraft:' + target.name;
    const runtimeId = BedrockBlock.getHash(targetName, target.states || {});
    return Number.isInteger(runtimeId) ? (runtimeId >>> 0) : null;
  }

  function sendBlock(pos, runtimeId) {
    if (!activePlayer) return;
    activePlayer.queue('update_block', {
      position: { x: pos.x, y: pos.y, z: pos.z },
      block_runtime_id: runtimeId,
      flags: UPDATE_FLAGS,
      layer: 0
    });
  }

  function drawPreview() {
    if (!activePlayer || !loaded || !anchor) throw new Error('Join through the Ghost Bridge relay and load a schematic first.');
    let count = 0;
    let skipped = 0;
    const blocks = getBedrockData();
    const start = loaded.start();
    const end = loaded.end();
    for (let y = start.y; y <= end.y; y++) {
      for (let z = start.z; z <= end.z; z++) {
        for (let x = start.x; x <= end.x; x++) {
          const source = loaded.getBlock(new Vec3(x, y, z));
          if (!source || !source.name || ['air', 'cave_air', 'void_air'].includes(source.name.replace(/^minecraft:/, ''))) continue;
          if (count >= MAX_PREVIEW_BLOCKS) break;
          const runtimeId = resolveRuntimeId(source);
          if (runtimeId === null) { skipped++; continue; }
          sendBlock({ x: anchor.x + x - start.x, y: anchor.y + y - start.y, z: anchor.z + z - start.z }, runtimeId);
          count++;
        }
      }
      if (count >= MAX_PREVIEW_BLOCKS) break;
    }
    previewCount = count;
    lastStatus = { connected: true, note: 'Preview sent to the client. It is client-side only and does not place real blocks.', schematic: loaded.name, blocks: count, skipped, anchor: { ...anchor }, locked };
    log('Preview sent: ' + count + ' blocks' + (skipped ? ', skipped ' + skipped + ' unsupported block types' : '') + '.');
    tell('Ghost Bridge: preview sent (' + count + ' blocks). ' + (skipped ? skipped + ' block types were unsupported. ' : '') + 'Use /.build move x y z to reposition or /.build place to lock the preview.');
  }

  async function runCommand(raw) {
    const text = String(raw || '').trim();
    const match = text.match(/^\/?\.?build\s+(start|move|place|stop|status)(?:\s+(.*))?$/i);
    if (!match) throw new Error('Use /.build start <filename>, /.build move <x> <y> <z>, /.build place, /.build stop, or /.build status.');
    const action = match[1].toLowerCase();
    const args = (match[2] || '').trim();

    if (action === 'start') {
      let fileName = path.basename(args);
      if (!fileName || fileName !== args || !/^[\w .()-]{1,80}(?:\.(schem|schematic))?$/i.test(fileName)) {
        throw new Error('For this first preview engine, upload a Sponge .schem or legacy .schematic file. .litematic and .mcstructure are not supported yet.');
      }
      if (!/\.(schem|schematic)$/i.test(fileName)) {
        const found = ['.schem', '.schematic'].map(ext => fileName + ext).find(candidate => fs.existsSync(path.join(schemDir, candidate)));
        if (!found) throw new Error('I cannot find ' + fileName + '.schem or ' + fileName + '.schematic in your uploaded schematics.');
        fileName = found;
      }
      const filePath = path.join(schemDir, fileName);
      if (!fs.existsSync(filePath)) throw new Error('I cannot find "' + fileName + '" in your uploaded schematics.');
      const schematic = await Schematic.read(await fs.promises.readFile(filePath));
      const size = schematic.size;
      if (!size || size.x * size.y * size.z > 100000) throw new Error('That schematic is too large to preview safely.');
      loaded = schematic;
      loaded.name = fileName;
      locked = false;
      if (!playerPosition) throw new Error('Move around in the game once so Ghost Bridge can read your position, then run start again.');
      anchor = { x: Math.floor(playerPosition.x) + 2, y: Math.floor(playerPosition.y), z: Math.floor(playerPosition.z) + 2 };
      drawPreview();
      return;
    }
    if (action === 'move') {
      if (!loaded) throw new Error('Run /.build start <filename> first.');
      const nums = args.split(/[ ,]+/).map(Number);
      if (nums.length !== 3 || nums.some(n => !Number.isFinite(n) || !Number.isInteger(n))) throw new Error('Format: /.build move <x> <y> <z> using whole-number world coordinates.');
      anchor = { x: nums[0], y: nums[1], z: nums[2] };
      locked = false;
      drawPreview();
      return;
    }
    if (action === 'place') {
      if (!loaded || !anchor) throw new Error('Run /.build start <filename> first.');
      locked = true;
      lastStatus = { ...lastStatus, locked: true };
      tell('Preview position locked at ' + anchor.x + ' ' + anchor.y + ' ' + anchor.z + '. This does not place blocks in the server world.');
      return;
    }
    if (action === 'stop') {
      loaded = null; anchor = null; locked = false; previewCount = 0;
      lastStatus = { connected: Boolean(activePlayer), note: 'Preview stopped. Client-side preview blocks may remain until the server refreshes those positions.' };
      tell('Ghost Bridge preview stopped. The server may need to refresh the affected area to clear old client-side preview blocks.');
      return;
    }
    tell(loaded ? ('Preview: ' + loaded.name + ', ' + previewCount + ' blocks, anchor ' + anchor.x + ' ' + anchor.y + ' ' + anchor.z + (locked ? ' (locked).' : ' (unlocked).')) : 'No schematic preview is active.');
  }

  const commandHandlers = new WeakSet();

  function attachPlayer(player) {
    activePlayer = player;
    playerPosition = null;
    lastStatus = { connected: true, note: 'Player connected through relay; waiting for server login and resource-pack negotiation.' };
    player.on('close', () => {
      if (activePlayer === player) {
        activePlayer = null;
        playerPosition = null;
        lastStatus = { connected: false, note: 'Player disconnected.' };
      }
    });
    log('Ghost preview engine detected a connecting player. Resource-pack negotiation is left untouched until the player joins.');
  }

  function attachCommandHandlers(player) {
    if (!player || commandHandlers.has(player)) return;
    commandHandlers.add(player);
    player.on('serverbound', (packet, destination) => {
      const name = packet && packet.name;
      const params = packet && packet.params || {};
      if (name === 'move_player' && params.position && Number.isFinite(params.position.x)) {
        playerPosition = { x: params.position.x, y: params.position.y, z: params.position.z };
      }
      let command = null;
      if (name === 'text' && typeof params.message === 'string') command = params.message;
      if (name === 'command_request' && typeof params.command === 'string') command = params.command;
      if (command && /^\/?\.?build\s+/i.test(command.trim())) {
        if (destination) destination.canceled = true;
        runCommand(command).catch(err => tell('Ghost Bridge: ' + err.message));
      }
    });
    log('Ghost in-game commands enabled after the relay join event; initial resource-pack packets were not intercepted.');
  }

  return {
    version: DEFAULT_VERSION,
    attach(r) {
      relay = r;
      relay.on('connect', attachPlayer);
      relay.on('join', () => {
        // Resource-pack negotiation happens before join. Do not register a generic
        // serverbound packet handler until the destination has completed login.
        // This lets the relay forward pack responses/chunk requests untouched.
        if (activePlayer) attachCommandHandlers(activePlayer);
      });
      log('Ghost preview engine attached. Resource-pack handshake is left untouched; in-game build commands activate after join.');
    },
    current() {
      return {
        status() { return { ...lastStatus, stateKey, loaded: loaded && loaded.name, anchor: anchor && { ...anchor }, locked, previewCount }; },
        async run(text) { if (!relay) throw new Error('Relay is not attached.'); await runCommand(text); }
      };
    }
  };
}
function defaultVersion() { return DEFAULT_VERSION; }
module.exports = { createGhost, defaultVersion };
