#!/usr/bin/env node
/**
 * T-005 presence self-test — headless Chrome + CDP drive.
 * Usage: node scripts/presence-selftest.mjs [baseUrl]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://127.0.0.1:8765';
const URL = `${BASE}/prototype/forest-stage.html?entry=0&presence=fast&selftest=1`;
const PORT = 9333 + Math.floor(Math.random() * 500);

let msgId = 0;
const pending = new Map();

function cdpSend(ws, method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 30000);
  });
}

async function evalJs(ws, expression) {
  const r = await cdpSend(ws, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.result?.exceptionDetails) {
    throw new Error(JSON.stringify(r.result.exceptionDetails));
  }
  return r.result?.result?.value;
}

async function waitForCdp(port, tries = 30) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return;
    } catch (_) { /* retry */ }
    await sleep(200);
  }
  throw new Error('CDP not ready');
}

async function openPage(port, url) {
  const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!r.ok) throw new Error(`json/new failed: ${r.status}`);
  return r.json();
}
async function main() {
  const userData = mkdtempSync(join(tmpdir(), 'qi-presence-'));
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userData}`,
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    await waitForCdp(PORT);
    const target = await openPage(PORT, URL);
    const wsUrl = target.webSocketDebuggerUrl;
    if (!wsUrl) throw new Error('No CDP websocket');

    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id).resolve(msg);
        pending.delete(msg.id);
      }
    });

    await cdpSend(ws, 'Page.enable');
    await cdpSend(ws, 'Runtime.enable');
    await cdpSend(ws, 'Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await cdpSend(ws, 'Page.reload', { ignoreCache: true });
    await sleep(2000);

    // Gate tap → scene (reduced-motion skips surge)
    await evalJs(ws, `(function(){
      sessionStorage.clear();
      const cv=document.getElementById('stage');
      const rect=cv.getBoundingClientRect();
      const x=rect.left+rect.width/2, y=rect.top+rect.height*0.55;
      cv.dispatchEvent(new PointerEvent('pointerdown',{clientX:x,clientY:y,bubbles:true}));
      return window.__getMode?.()||'no-api';
    })()`);
    await sleep(400);

    let mode = await evalJs(ws, 'window.__getMode()');
    for (let i = 0; i < 20 && mode !== 'scene'; i++) {
      await sleep(200);
      mode = await evalJs(ws, 'window.__getMode()');
    }
    if (mode !== 'scene') throw new Error(`Expected mode=scene after gate tap, got ${mode}`);

    const errBar = await evalJs(ws, "getComputedStyle(document.getElementById('error-bar')).display");
    if (errBar !== 'none') throw new Error('error-bar visible');

    // Welcome: fast scale → ~0.2s delay + ~0.3s rise + blink
    await sleep(1200);
    const welcomeDone = await evalJs(ws, 'window.__presence.welcomePhase');
    if (welcomeDone !== 'done') throw new Error(`Welcome not done: ${welcomeDone}`);

    // Idle warmth at 9s (90s scaled)
    await sleep(9500);
    const gathered = await evalJs(ws, 'window.__presence.gatheredCount');
    if (gathered < 1) throw new Error(`Warm gather failed: gathered=${gathered}`);

    // Whisper at 18s (180s scaled)
    await sleep(9500);
    const whisperDone = await evalJs(ws, 'window.__presence.whisperDone');
    const whisperText = await evalJs(ws, "document.getElementById('whisper').textContent");
    if (!whisperDone) throw new Error('Whisper not triggered');
    if (whisperText !== '（它还在）') throw new Error(`Wrong whisper: ${whisperText}`);

    // Screenshot non-black
    const shot = await cdpSend(ws, 'Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(shot.result.data, 'base64');
    const out = join(process.cwd(), 'prototype/.presence-selftest.png');
    writeFileSync(out, buf);
    const dark = buf.length < 5000;
    if (dark) throw new Error('Screenshot appears black');

    const sceneT = await evalJs(ws, 'window.__getSceneT()');
    console.log(JSON.stringify({
      ok: true,
      mode,
      welcomeDone,
      gathered,
      whisperDone,
      whisperText,
      sceneT: Math.round(sceneT),
      screenshot: out,
    }, null, 2));
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
});
