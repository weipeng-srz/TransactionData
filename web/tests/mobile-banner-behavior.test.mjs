import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import * as security from "../app/lib/security.ts";
import * as watchlist from "../app/lib/watchlist.ts";
import * as lookupError from "../app/lib/stockLookupError.ts";
import * as mobileNavigation from "../app/lib/mobileNavigation.ts";

const compiled = ts.transpileModule(readFileSync(new URL("../app/components/SiteBanner.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function bannerHarness({ mobile = true, scrollY = 0, user = { displayName: "测试", email: "test@example.test" }, fetchStock } = {}) {
  const slots = [];
  const effects = [];
  const frames = new Map();
  const timers = new Map();
  const listeners = new Map();
  const mediaListeners = new Set();
  const nodes = new WeakMap();
  const requests = [];
  const opened = [];
  const storage = new Map();
  const document = { activeElement: null, querySelectorAll: () => [] };
  let cursor = 0;
  let nextId = 0;
  let dirty = true;
  let tree;
  let modalOpen = false;
  class FakeNode {
    children = [];
    focus(options) { document.activeElement = this; this.focusOptions = options; }
    contains(target) { return target === this || this.children.some((child) => child.contains(target)); }
  }
  const addListener = (name, callback) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(callback);
  };
  const removeListener = (name, callback) => listeners.get(name)?.delete(callback);
  const media = {
    matches: mobile,
    addEventListener(_name, callback) { mediaListeners.add(callback); },
    removeEventListener(_name, callback) { mediaListeners.delete(callback); },
  };
  const window = {
    scrollY,
    matchMedia: () => media,
    addEventListener: addListener,
    removeEventListener: removeListener,
    requestAnimationFrame(callback) { frames.set(++nextId, callback); return nextId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback) { timers.set(++nextId, callback); return nextId; },
    clearTimeout(id) { timers.delete(id); },
    dispatchEvent(event) { listeners.get(event.type)?.forEach((callback) => callback(event)); },
    location: { pathname: "/", search: "", assign: (url) => opened.push(url) },
  };
  document.addEventListener = addListener;
  document.removeEventListener = removeListener;
  document.querySelectorAll = () => modalOpen ? [{ getClientRects: () => [1] }] : [];
  const changed = (previous, deps) => !previous || deps.some((value, index) => !Object.is(value, previous.deps[index]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (update) => {
        const value = typeof update === "function" ? update(slots[index]) : update;
        if (!Object.is(value, slots[index])) { slots[index] = value; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(callback, deps) {
      const index = cursor++;
      if (changed(slots[index], deps)) slots[index] = { value: callback, deps: [...deps] };
      return slots[index].value;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (changed(previous, deps)) {
        slots[index] = { deps: [...deps], cleanup: previous?.cleanup };
        effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); });
      }
    },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, window, document, Node: FakeNode, AbortController, Error, Date,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    async fetch(url, options) {
      requests.push({ url, ...options });
      return fetchStock ? fetchStock(url, options) : { ok: true, json: async () => url.includes("us-stock") ? { code: "AAPL", name: "Apple", market: "US" } : { code: "600519", name: "贵州茅台", market: "CN" } };
    },
    require(name) {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name === "next/link") return { default: "a" };
      if (name.endsWith(".css")) return { default: new Proxy({}, { get: (_, key) => key }) };
      if (name === "./AuthProvider") return { useAuth: () => ({ user, syncStatus: "synced" }) };
      if (name === "../lib/accountStorage") return { accountStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) } };
      if (name === "../lib/security") return security;
      if (name === "../lib/watchlist") return watchlist;
      if (name === "../lib/stockLookupError") return lookupError;
      if (name === "../lib/mobileNavigation") return mobileNavigation;
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  function elements(root) {
    if (!root || typeof root !== "object") return [];
    if (Array.isArray(root)) return root.flatMap((child) => elements(child));
    return [root, ...elements(root.props?.children)];
  }
  function attach(root) {
    if (!root || typeof root !== "object") return [];
    if (Array.isArray(root)) return root.flatMap(attach);
    const children = attach(root.props?.children);
    const ref = root.props?.ref;
    if (!ref) return children;
    if (!nodes.has(ref)) nodes.set(ref, new FakeNode());
    ref.current = nodes.get(ref);
    ref.current.children = children;
    return [ref.current];
  }
  function settle() {
    let turns = 0;
    while (dirty || effects.length || frames.size) {
      assert.ok(turns++ < 30, "banner hooks must converge");
      if (dirty) {
        dirty = false;
        cursor = 0;
        tree = exports.default({ activePage: "stock", appearance: "light", onToggleAppearance() {}, onOpenStock: (code) => opened.push(code) });
        attach(tree);
      }
      effects.splice(0).forEach((effect) => effect());
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback());
    }
    return tree;
  }
  const find = (predicate) => { const element = elements(tree).find(predicate); assert.ok(element, "expected banner element exists"); return element; };
  const byLabel = (label) => find((element) => element.props?.["aria-label"] === label);
  const input = () => find((element) => element.type === "input");
  const fire = (name, event = {}) => { listeners.get(name)?.forEach((callback) => callback(event)); settle(); };
  settle();
  return {
    document, window, requests, opened, storage, frames, timers, listeners, mediaListeners, elements: () => elements(tree), find, byLabel, input,
    header: () => find((element) => element.type === "header").props,
    click(label) { byLabel(label).props.onClick(); settle(); },
    change(value) { input().props.onChange({ target: { value } }); settle(); },
    scroll(value) { window.scrollY = value; fire("scroll"); },
    resize(isMobile) { media.matches = isMobile; mediaListeners.forEach((callback) => callback()); settle(); },
    setModal(value) { modalOpen = value; },
    key(key, modifiers = {}) {
      const event = { key, preventDefault() { this.defaultPrevented = true; }, ...modifiers };
      fire("keydown", event);
      return event;
    },
    dispatch: fire,
    settle,
    async complete() { for (let i = 0; i < 12; i += 1) { await Promise.resolve(); settle(); } },
    async suggest() { const callbacks = [...timers.values()]; timers.clear(); await Promise.all(callbacks.map((callback) => callback())); settle(); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}

test("mobile banner collapses after 96px and returns only at 24px without threshold flicker", () => {
  const harness = bannerHarness();
  assert.equal(harness.header()["data-compact"], false);
  for (const position of [24, 80, 96]) { harness.scroll(position); assert.equal(harness.header()["data-compact"], false); }
  harness.scroll(97);
  assert.equal(harness.header()["data-compact"], true);
  for (const position of [96, 80, 25]) { harness.scroll(position); assert.equal(harness.header()["data-compact"], true); }
  harness.scroll(24);
  assert.equal(harness.header()["data-compact"], false);
  harness.unmount();
});

test("deep mobile entry is compact while desktop scrolling and breakpoint changes preserve desktop mode", () => {
  const harness = bannerHarness({ scrollY: 300 });
  assert.equal(harness.header()["data-compact"], true);
  harness.click("搜索股票");
  assert.equal(harness.header()["data-search-open"], true);
  harness.resize(false);
  assert.equal(harness.header()["data-compact"], false);
  assert.equal(harness.header()["data-search-open"], false);
  harness.scroll(500);
  assert.equal(harness.header()["data-compact"], false);
  harness.resize(true);
  assert.equal(harness.header()["data-compact"], true);
  assert.equal(harness.header()["data-search-open"], false);
  harness.unmount();
});

test("mobile search opens with input focus and closes through button, backdrop and Escape", () => {
  const harness = bannerHarness();
  for (const close of [() => harness.click("关闭股票搜索"), () => harness.click("收起股票搜索"), () => harness.key("Escape")]) {
    harness.click("搜索股票");
    assert.equal(harness.header()["data-search-open"], true);
    assert.equal(harness.byLabel("搜索股票").props["aria-expanded"], true);
    assert.equal(harness.document.activeElement, harness.input().props.ref.current);
    assert.equal(harness.document.activeElement.focusOptions.preventScroll, true);
    close();
    assert.equal(harness.header()["data-search-open"], false);
    assert.equal(harness.document.activeElement, harness.byLabel("搜索股票").props.ref.current);
  }
  harness.unmount();
});

test("search shortcuts respect IME and active modal, and custom open-search focuses the input", () => {
  const harness = bannerHarness();
  harness.key("k", { ctrlKey: true, isComposing: true });
  assert.equal(harness.header()["data-search-open"], false);
  harness.setModal(true);
  harness.key("k", { metaKey: true });
  assert.equal(harness.header()["data-search-open"], false);
  harness.setModal(false);
  assert.equal(harness.key("k", { ctrlKey: true }).defaultPrevented, true);
  assert.equal(harness.header()["data-search-open"], true);
  harness.click("关闭股票搜索");
  harness.dispatch("trendsight:open-search");
  assert.equal(harness.header()["data-search-open"], true);
  harness.input().props.onCompositionStart();
  harness.key("Escape");
  assert.equal(harness.header()["data-search-open"], true);
  harness.input().props.onCompositionEnd();
  harness.key("Escape");
  assert.equal(harness.header()["data-search-open"], false);
  harness.unmount();
});

test("mobile search opens a US stock with its market route key and closes the panel", async () => {
  const harness = bannerHarness();
  harness.click("搜索股票");
  harness.change("AAPL");
  harness.byLabel("快速搜索股票").props.onSubmit({ preventDefault() {} });
  await harness.complete();
  assert.deepEqual(harness.opened, ["US:AAPL"]);
  assert.equal(harness.requests[0].url, "/api/us-stock-lookup");
  assert.equal(harness.header()["data-search-open"], false);
  assert.equal(harness.input().props.value, "");
  harness.unmount();
});

test("search errors keep the mobile panel open with readable feedback and enable retry", async () => {
  const harness = bannerHarness({ fetchStock: async () => ({ ok: false, json: async () => ({ error: "股票查询失败" }) }) });
  harness.click("搜索股票");
  harness.change("AAPL");
  harness.byLabel("快速搜索股票").props.onSubmit({ preventDefault() {} });
  await harness.complete();
  assert.equal(harness.header()["data-search-open"], true);
  assert.equal(harness.input().props.readOnly, false);
  assert.equal(harness.opened.length, 0);
  const status = harness.find((element) => element.props?.role === "status");
  assert.ok(status.props.children.length > 0);
  assert.match(status.props.className, /searchError/);
  harness.unmount();
});

test("closing search aborts pending suggestions and prevents late result reopening", async () => {
  let finish;
  const harness = bannerHarness({ fetchStock: () => new Promise((resolve) => { finish = resolve; }) });
  harness.click("搜索股票");
  harness.change("AAPL");
  const pending = harness.suggest();
  harness.click("关闭股票搜索");
  assert.equal(harness.requests[0].signal.aborted, true);
  finish({ ok: true, json: async () => ({ code: "AAPL", name: "Apple", market: "US" }) });
  await pending;
  assert.equal(harness.header()["data-search-open"], false);
  assert.equal(harness.elements().some((element) => element.props?.role === "dialog"), false);
  harness.unmount();
});

test("authenticated search retains adding a suggestion to account watchlist", async () => {
  const harness = bannerHarness();
  harness.click("搜索股票");
  harness.change("AAPL");
  await harness.suggest();
  const add = harness.find((element) => element.type === "button" && element.props.children === "＋ 添加自选");
  add.props.onClick();
  await harness.complete();
  const saved = JSON.parse(harness.storage.get("ticklens.watchlist.v1"));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].code, "AAPL");
  assert.equal(saved[0].market, "US");
  assert.equal(harness.header()["data-search-open"], true);
  harness.unmount();
});

test("guest navigation and mobile avatar preserve authentication boundaries", () => {
  const harness = bannerHarness({ user: null });
  assert.equal(harness.byLabel("登录").props.href, "/login");
  const destinations = harness.elements().map((element) => element.props?.href).filter(Boolean);
  assert.ok(destinations.includes("/register"));
  for (const route of ["/account", "/screener", "/review", "/global-markets"]) assert.equal(destinations.includes(route), false);
  assert.equal(harness.elements().some((element) => element.props?.["aria-label"] === "添加自选股"), false);
  harness.unmount();
});

test("unmount cancels scheduled work, aborts lookup and removes banner subscriptions", async () => {
  let finish;
  const harness = bannerHarness({ fetchStock: () => new Promise((resolve) => { finish = resolve; }) });
  harness.change("AAPL");
  const pending = harness.suggest();
  harness.unmount();
  assert.equal(harness.requests[0].signal.aborted, true);
  assert.equal(harness.frames.size, 0);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.mediaListeners.size, 0);
  for (const callbacks of harness.listeners.values()) assert.equal(callbacks.size, 0);
  finish({ ok: true, json: async () => ({ code: "AAPL", name: "Apple", market: "US" }) });
  await pending;
});
