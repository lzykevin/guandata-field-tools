// ==UserScript==
// @name         观远：栏目内编辑计算字段
// @namespace    guandata-field-tools
// @version      0.1.0
// @description  悬停栏目中的可编辑计算字段，点击铅笔打开原生公式编辑器。
// @match        https://bibr.staff.xdf.cn/*
// @run-at       document-idle
// @grant        none
// @sandbox      raw
// ==/UserScript==

((factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.install(window);
})(() => {
  'use strict';
  const KEY = '__guandataFormulaShortcut';
  const CHIP = '.zone [data-testid^="drop_"] [draggable="true"] [class*="gd-color-bg-"]';
  const editable = f => !!f && f.editable === true && typeof f.fdId === 'string' && !!f.fdId && typeof f.formula === 'string';

  function* propsChain(node) {
    let fiber = node?.[Object.keys(node).find(k => k.startsWith('__reactFiber$'))];
    for (let depth = 0; fiber && depth < 40; depth++, fiber = fiber.return) {
      let root = fiber;
      while (root.return) root = root.return;
      const active = root.stateNode?.current && root.stateNode.current !== root && fiber.alternate ? fiber.alternate : fiber;
      yield active.memoizedProps || {};
    }
  }

  function readField(node) {
    for (const p of propsChain(node)) {
      if (p.zoneField) return editable(p.zoneField) ? p.zoneField : null;
      if (typeof p.className === 'string' && p.className.split(/\s+/).includes('zone')) break;
    }
    return null;
  }

  function readEditor(node, field) {
    let menu;
    for (const p of propsChain(node)) {
      const overlay = p.overlay?.props;
      if (typeof overlay?.onClick === 'function' && Array.isArray(overlay.children)) {
        const item = overlay.children.find(c => c?.props?.children === '编辑公式');
        if (item?.key != null) menu = { key: item.key, onClick: overlay.onClick };
      }
      if (p.field) {
        return typeof p.field.formula === 'string' && p.field.fdId === field.fdId &&
          (!p.field.dsId || !field.dsId || p.field.dsId === field.dsId) ? menu || null : null;
      }
    }
    return null;
  }

  function openEditor(doc, chip, event) {
    const field = readField(chip);
    if (!field) throw Error('该字段已变化或不可编辑，请重新打开卡片编辑页。');
    // Resolve the native menu afresh: names and previously captured callbacks can become stale.
    for (const source of doc.querySelectorAll('[data-testid^="dc_"] .fg-setting')) {
      const editor = readEditor(source, field);
      if (editor) return editor.onClick({ key: editor.key, domEvent: event });
    }
    // shortcut: native source menu must be mounted; clear the source search if it is hidden.
    throw Error('暂未找到该字段的原生编辑入口，请清空左侧字段搜索后重试。');
  }

  function install(win) {
    win[KEY]?.stop();
    const doc = win.document;
    const buttons = new Map();
    const style = doc.createElement('style');
    style.textContent = `
      .gfs-host { position: relative; }
      .gfs-host > :first-child { margin-right: 20px; }
      .gfs-edit { position:absolute; top:3px; right:22px; width:20px; height:20px;
        display:flex; align-items:center; justify-content:center; padding:0; border:0;
        border-radius:3px; background:transparent; color:inherit; cursor:pointer;
        opacity:0; pointer-events:none; }
      .gfs-host:hover > .gfs-edit, .gfs-host:focus-within > .gfs-edit {
        opacity:1; pointer-events:auto; }
      .gfs-edit:hover { background:rgb(0 0 0 / 8%); }
      .gfs-edit:focus-visible { outline:2px solid currentColor; outline-offset:1px; }
    `;
    doc.head.appendChild(style);
    function remove(chip, button) {
      button.remove();
      chip.classList.remove('gfs-host');
      buttons.delete(chip);
    }
    function refresh() {
      const chips = new Set(/^\/card\/[^/]+\/edit\/?$/.test(win.location.pathname)
        ? [...doc.querySelectorAll(CHIP)].filter(n => readField(n)) : []);
      for (const [chip, button] of buttons) {
        if (!chips.has(chip) || !chip.contains(button)) remove(chip, button);
      }
      for (const chip of chips) {
        if (buttons.has(chip)) continue;
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'gfs-edit';
        button.title = '编辑公式';
        button.setAttribute('aria-label', '编辑计算字段公式');
        button.setAttribute('draggable', 'false');
        button.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 3 5 5-13 13H3v-5Z"/><path d="m14 5 5 5"/></svg>';
        button.addEventListener('mousedown', e => e.stopPropagation());
        button.addEventListener('keydown', e => e.stopPropagation());
        button.addEventListener('dragstart', e => { e.preventDefault(); e.stopPropagation(); });
        button.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          try { openEditor(doc, chip, e); }
          catch (error) { win.alert(error.message || '无法打开原生公式编辑器。'); }
        });
        chip.classList.add('gfs-host');
        chip.appendChild(button);
        buttons.set(chip, button);
      }
    }
    let timer;
    const schedule = () => {
      if (timer !== undefined) return;
      timer = win.setTimeout(() => { timer = undefined; refresh(); }, 120);
    };
    const observer = new win.MutationObserver(schedule);
    observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
    win.addEventListener('popstate', schedule);
    win[KEY] = { refresh, stop() {
      win.clearTimeout(timer);
      observer.disconnect();
      win.removeEventListener('popstate', schedule);
      for (const [chip, button] of buttons) remove(chip, button);
      style.remove();
      delete win[KEY];
    } };
    refresh();
    return win[KEY];
  }
  return { editable, readField, readEditor, openEditor, install };
});
