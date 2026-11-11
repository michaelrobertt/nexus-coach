'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('overlay UI state machine: compact race, layouts, panel transitions, active fade', { timeout: 90000 }, async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-test-'));
  const app = await electron.launch({
    args: ['.', '--dev', `--user-data-dir=${userData}`],
    env
  });
  const errors = [];
  try {
    await wait(3000);
    const toolbar = app.windows().find((w) => w.url().includes('toolbar/index.html'));
    const overlay = app.windows().find((w) => w.url().includes('overlay/index.html'));
    assert.ok(toolbar && overlay, 'toolbar and overlay must exist');
    for (const win of app.windows()) {
      win.on('pageerror', (err) => errors.push(err.message));
    }

    const tbState = () => toolbar.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      classes: document.body.className,
      panelHidden: document.querySelector('#panel').classList.contains('hidden')
    }));

    assert.deepEqual((await tbState()).width, 1080);

    // Compact animation must not resurrect compact state after restore wins the race.
    await toolbar.click('#compactBtn');
    await wait(40);
    await toolbar.evaluate(() => window.nexus.restoreCompact());
    await wait(700);
    let state = await tbState();
    assert.ok(!state.classes.includes('compact'), 'restore must cancel pending compact transition');
    assert.ok(state.width > 56, 'toolbar must be expanded after restore');

    // Layout, size and display mode are applied immediately.
    await toolbar.click('#settingsBtn');
    await wait(800);
    const settings = app.windows().find((w) => w.url().includes('settings/index.html'));
    settings.on('pageerror', (err) => errors.push(err.message));
    await settings.click('[data-nav="interface"]');
    await settings.click('[data-layout-choice="vertical"]');
    await settings.click('[data-size-choice="small"]');
    await settings.click('[data-display-mode="minimal"]');
    await wait(900);
    await settings.click('#closeBtn');
    await wait(700);
    state = await tbState();
    assert.ok(state.classes.includes('layout-vertical'));
    assert.ok(state.classes.includes('size-small'));
    assert.ok(state.classes.includes('mode-minimal'));
    assert.equal(state.width, 292);
    assert.equal(state.height, 360);

    // Opening a panel and immediately selecting a tool must leave no stale panel.
    await toolbar.evaluate(() => {
      document.querySelector('#stampsBtn').click();
      document.querySelector('#toolGroups [data-tool="pen"]').click();
    });
    await wait(600);
    state = await tbState();
    assert.ok(state.panelHidden, 'panel transition must be cancelled by tool selection');

    // A fading draft must not be pruned while the pointer is still drawing it.
    await overlay.evaluate(() => window.__nexusEngine.setStyle({ fade: true, fadeSeconds: 1 }));
    await overlay.mouse.move(420, 300);
    await overlay.mouse.down();
    await overlay.mouse.move(700, 360, { steps: 8 });
    await wait(1400);
    const whileDrawing = await overlay.evaluate(() =>
      window.__nexusEngine.items.filter((item) => item.type === 'stroke').length
    );
    await overlay.mouse.up();
    assert.ok(whileDrawing > 0, 'active fading stroke must survive until pointerup');

    // Clearing while a route is being built must reset route state, not leave it pending.
    await overlay.evaluate(() => window.__nexusEngine.setStyle({ fade: false }));
    await overlay.evaluate(() => window.__nexusEngine.clear());
    await toolbar.click('#toolGroups [data-tool="route"]');
    await overlay.mouse.click(450, 300);
    await overlay.mouse.click(650, 380);
    assert.equal(await overlay.evaluate(() => Boolean(window.__nexusEngine.route)), true);
    await toolbar.click('#clearBtn');
    await wait(250);
    assert.equal(await overlay.evaluate(() => Boolean(window.__nexusEngine.route)), false);

    await toolbar.click('#boardBtn');
    await wait(1600);
    const board = app.windows().find((w) => w.url().includes('board/index.html'));
    assert.ok(board, 'mini-board must open');
    board.on('pageerror', (err) => errors.push(err.message));
    const boardReady = await board.evaluate(() => ({
      cache: window.__nexusEngine._bgCache.width,
      items: window.__nexusEngine.items.length
    }));
    assert.ok(boardReady.cache > 0, 'board background cache must be allocated');

    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
