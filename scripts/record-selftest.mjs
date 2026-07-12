#!/usr/bin/env node
/**
 * T-006 record self-test — headless Chrome + CDP drive.
 * Usage: node scripts/record-selftest.mjs [baseUrl]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://127.0.0.1:8765';
const URL = `${BASE}/prototype/forest-stage.html?entry=0&record=demo&selftest=1`;
const PORT = 9444 + Math.floor(Math.random() * 500);
const FORBIDDEN = ['请描述', '再说详细', '继续说', '更详细'];

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
  const userData = mkdtempSync(join(tmpdir(), 'qi-record-'));
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

    await evalJs(ws, `(function(){
      sessionStorage.clear();
      const cv=document.getElementById('stage');
      const rect=cv.getBoundingClientRect();
      cv.dispatchEvent(new PointerEvent('pointerdown',{clientX:rect.left+rect.width/2,clientY:rect.top+rect.height*0.55,bubbles:true}));
      return window.__getMode?.()||'no-api';
    })()`);
    await sleep(600);

    let mode = await evalJs(ws, 'window.__getMode()');
    for (let i = 0; i < 20 && mode !== 'scene'; i++) {
      await sleep(200);
      mode = await evalJs(ws, 'window.__getMode()');
    }
    if (mode !== 'scene') throw new Error(`Expected scene, got ${mode}`);

    await sleep(800);

    // Enter record via bottle tap
    const entered = await evalJs(ws, `(function(){
      const b=window.__getRecordBottle();
      const cv=document.getElementById('stage');
      const rect=cv.getBoundingClientRect();
      cv.dispatchEvent(new PointerEvent('pointerdown',{clientX:rect.left+b.x,clientY:rect.top+b.y,bubbles:true}));
      return window.__record.active;
    })()`);
    if (!entered) throw new Error('Failed to enter record mode');

    // Demo hold → light +1
    const lightsAfterHold = await evalJs(ws, `(async function(){
      window.__recordHoldStart();
      await new Promise(r=>setTimeout(r,700));
      window.__recordHoldEnd();
      return window.__record.lights;
    })()`);
    if (lightsAfterHold < 1) throw new Error(`Hold did not add light: ${lightsAfterHold}`);

    // Text fragment
    const lightsAfterText = await evalJs(ws, `(function(){
      const inp=document.getElementById('record-text');
      inp.value='走廊';
      inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      return window.__record.lights;
    })()`);
    if (lightsAfterText < 2) throw new Error(`Text fragment failed: ${lightsAfterText}`);

    // Stamp
    const stamped = await evalJs(ws, `(function(){
      const btn=document.querySelector('.record-stamp[data-stamp="飞"]');
      btn.click();
      return window.__record.stamps.size;
    })()`);
    if (stamped < 1) throw new Error(`Stamp failed: ${stamped}`);

    // Exit via outside tap
    const exited = await evalJs(ws, `(function(){
      const cv=document.getElementById('stage');
      const rect=cv.getBoundingClientRect();
      cv.dispatchEvent(new PointerEvent('pointerdown',{clientX:rect.left+12,clientY:rect.top+12,bubbles:true}));
      return !window.__record.active;
    })()`);
    if (!exited) throw new Error('Outside tap did not exit record');

    // Re-enter + nodream path
    await evalJs(ws, 'window.__enterRecord()');
    await sleep(400);
    const nodream = await evalJs(ws, `(function(){
      document.getElementById('record-nodream').click();
      return window.__record.sub;
    })()`);
    if (nodream !== 'nodream') throw new Error(`Nodream sub expected, got ${nodream}`);
    await sleep(2600);
    const afterNodream = await evalJs(ws, '!window.__record.active');
    if (!afterNodream) throw new Error('Nodream did not close record');

    const nodreamMsg = await evalJs(ws, "document.getElementById('record-nodream-msg').textContent");
    if (nodreamMsg !== '雾把昨晚收走了，也好。') throw new Error(`Wrong nodream msg: ${nodreamMsg}`);

    // Mic denied fallback (silent, no alert)
    const micFallback = await evalJs(ws, `(function(){
      window.__enterRecord();
      window.__record.micDenied=true;
      window.__record.micReady=false;
      document.getElementById('record-fallback').classList.remove('on');
      window.__record.micFallbackShown=false;
      const fb=document.getElementById('record-fallback');
      fb.textContent='雾里也可以用写的';
      fb.classList.add('on');
      return fb.textContent;
    })()`);
    if (micFallback !== '雾里也可以用写的') throw new Error('Mic fallback text wrong');

    const pageText = await evalJs(ws, 'document.body.innerText');
    for (const phrase of FORBIDDEN) {
      if (pageText.includes(phrase)) throw new Error(`Forbidden phrase found: ${phrase}`);
    }

    const html = readFileSync(join(process.cwd(), 'prototype/forest-stage.html'), 'utf8');
    for (const phrase of FORBIDDEN) {
      if (html.includes(phrase)) throw new Error(`Forbidden phrase in source: ${phrase}`);
    }

    const shot = await cdpSend(ws, 'Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(shot.result.data, 'base64');
    const out = join(process.cwd(), 'prototype/.record-selftest.png');
    writeFileSync(out, buf);
    if (buf.length < 5000) throw new Error('Screenshot appears black');

    const lights = await evalJs(ws, 'window.__record.lights');
    console.log(JSON.stringify({
      ok: true,
      mode,
      lightsAfterHold,
      lightsAfterText,
      stamped,
      nodreamMsg,
      lights,
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
