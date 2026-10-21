import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync(new URL("../app/components/useWorkspaceTabIndicator.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function indicatorHarness({ reducedMotion = false, hidden = false, viewportWidth = 500 } = {}) {
  const slots = [];
  const effects = [];
  const frames = new Map();
  const motionListeners = new Set();
  const observers = [];
  const scrollCalls = [];
  let cursor = 0;
  let frameId = 0;
  let time = 100;
  let selected = "first";
  let concealed = hidden;
  const buttons = [
    { id: "first", offsetLeft: 6, width: 120 },
    { id: "second", offsetLeft: 130, width: 180 },
    { id: "third", offsetLeft: 314, width: 150 },
  ].map((button) => ({ ...button, get offsetWidth() { return concealed ? 0 : this.width; } }));
  const track = {
    dataset: {},
    querySelector: () => buttons.find((button) => button.id === selected),
    querySelectorAll: () => buttons,
  };
  const indicator = { style: {} };
  const scroller = {
    scrollLeft: 0, clientWidth: viewportWidth,
    scrollTo(options) { scrollCalls.push({ ...options }); this.scrollLeft = options.left; },
  };
  const motion = {
    matches: reducedMotion,
    addEventListener(_name, listener) { motionListeners.add(listener); },
    removeEventListener(_name, listener) { motionListeners.delete(listener); },
  };
  const hooks = {
    useRef(initial) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useLayoutEffect(effect, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) {
        slots[index] = { deps: [...deps], cleanup: previous?.cleanup };
        effects.push(() => {
          slots[index].cleanup?.();
          slots[index].cleanup = effect();
        });
      }
    },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    window: { matchMedia: () => motion },
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    ResizeObserver: class {
      observed = new Set();
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(element) { this.observed.add(element); }
      disconnect() { this.observed.clear(); }
    },
    require(name) {
      assert.equal(name, "react");
      return hooks;
    },
  });
  const render = (value = selected) => {
    selected = value;
    cursor = 0;
    const refs = exports.useWorkspaceTabIndicator(value);
    refs.scrollRef.current = scroller;
    refs.trackRef.current = track;
    refs.indicatorRef.current = indicator;
    effects.splice(0).forEach((effect) => effect());
  };
  const tick = (elapsed = 1000 / 60) => {
    time += elapsed;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(time));
  };
  render();
  return {
    buttons, indicator, track, scroller, frames, motionListeners, observers, scrollCalls,
    select: render, tick,
    geometry() {
      const transform = indicator.style.transform.match(/translate3d\(([-\d.e]+)px, 0, 0\) scaleX\(([-\d.e]+)\)/);
      assert.ok(transform, "indicator must have finite rendered geometry");
      return { x: Number(transform[1]), width: Number.parseFloat(indicator.style.width) * Number(transform[2]) };
    },
    finish() {
      let ticks = 0;
      while (frames.size) {
        assert.ok(ticks++ < 180, "spring must settle within three seconds");
        tick();
      }
    },
    resize() { observers.forEach((observer) => { if (observer.observed.size) observer.callback(); }); },
    hide(value) { concealed = value; },
    reduceMotion(value) { motion.matches = value; motionListeners.forEach((listener) => listener()); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}

test("tab indicator initializes at the selected tab without an entrance animation", () => {
  const harness = indicatorHarness();
  assert.deepEqual(harness.geometry(), { x: 6, width: 120 });
  assert.equal(harness.track.dataset.indicatorReady, "true");
  assert.equal(harness.frames.size, 0);
  assert.ok(harness.observers[0].observed.has(harness.track));
  for (const button of harness.buttons) assert.ok(harness.observers[0].observed.has(button));
  harness.unmount();
});

test("rapid switches preserve rendered position, width and momentum until the new target settles", () => {
  const harness = indicatorHarness();
  const initial = harness.geometry();
  harness.select("third");
  assert.deepEqual(harness.geometry(), initial, "retargeting must not teleport or resize the visible pill before the next frame");
  for (let i = 0; i < 3; i += 1) harness.tick();
  const moving = harness.geometry();
  assert.ok(moving.x > initial.x && moving.x < 314);
  harness.select("first");
  assert.equal(harness.geometry().x, moving.x, "interruption must preserve the current rendered position");
  assert.ok(Math.abs(harness.geometry().width - moving.width) < 1e-8, "interruption must preserve the current rendered width");
  assert.equal(harness.frames.size, 1, "retargeting must keep a single animation loop");
  harness.tick(1);
  assert.ok(harness.geometry().x > moving.x, "reversal retains the outgoing momentum before returning");
  harness.finish();
  assert.deepEqual(harness.geometry(), initial);
  harness.unmount();
});

test("reduced motion settles immediately and cancels an animation when enabled during a switch", () => {
  const harness = indicatorHarness({ reducedMotion: true, viewportWidth: 180 });
  harness.select("third");
  assert.deepEqual(harness.geometry(), { x: 314, width: 150 });
  assert.equal(harness.frames.size, 0);
  assert.equal(harness.scrollCalls.at(-1).behavior, "instant");
  harness.reduceMotion(false);
  harness.select("first");
  harness.tick();
  assert.ok(harness.frames.size > 0);
  harness.reduceMotion(true);
  assert.deepEqual(harness.geometry(), { x: 6, width: 120 });
  assert.equal(harness.frames.size, 0);
  harness.unmount();
});

test("hidden nested tabs recover on reveal and resized labels realign without animating", () => {
  const harness = indicatorHarness({ hidden: true });
  harness.select("second");
  assert.equal(harness.track.dataset.indicatorReady, undefined);
  assert.equal(harness.frames.size, 0);
  harness.hide(false);
  harness.resize();
  assert.deepEqual(harness.geometry(), { x: 130, width: 180 });
  assert.equal(harness.track.dataset.indicatorReady, "true");
  harness.select("third");
  harness.tick();
  harness.buttons[2].offsetLeft = 280;
  harness.buttons[2].width = 190;
  harness.resize();
  assert.deepEqual(harness.geometry(), { x: 280, width: 190 });
  assert.equal(harness.frames.size, 0);
  harness.unmount();
});

test("offscreen selections scroll only the tab rail and cleanup removes all subscriptions", () => {
  const harness = indicatorHarness({ viewportWidth: 180 });
  harness.select("third");
  assert.deepEqual(harness.scrollCalls.at(-1), { left: 290, behavior: "smooth" });
  harness.tick();
  const beforeCleanup = harness.geometry();
  harness.unmount();
  assert.equal(harness.frames.size, 0);
  assert.equal(harness.motionListeners.size, 0);
  assert.equal(harness.observers[0].observed.size, 0);
  assert.equal(harness.track.dataset.indicatorReady, undefined);
  harness.tick();
  harness.resize();
  harness.reduceMotion(true);
  assert.deepEqual(harness.geometry(), beforeCleanup);
});
