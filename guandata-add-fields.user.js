// ==UserScript==
// @name         观远：字段快速添加
// @namespace    guandata-ui-tweaks
// @version      0.3.0
// @description  各拖放栏目原地搜索，回车连续添加，快速配置动态维度和动态数值；沿用观远原生规则。
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
  const KEY = '__guandataFieldPicker';
  const PLACEHOLDER = '.zone [data-testid^="ph_"]';
  const id = f => dynamicField(f) ? `dynamic:${f.metaType}` : f.layerTreeId ? `tree:${f.layerTreeId}` : `${f.dsId || ''}:${f.fdId}`;
  const sameField = (a, b) => a.layerTreeId || b.layerTreeId ? !!a.layerTreeId && a.layerTreeId === b.layerTreeId :
    a.fdId === b.fdId && (!a.dsId || !b.dsId || a.dsId === b.dsId);
  const fieldCount = (target, field) => dynamicField(field) ? 0 : target.zoneFields.filter(f => sameField(f, field)).length;
  const label = f => f.fdType === 'SUB_DATE' && f.parentFdName ? `${f.parentFdName} · ${f.name}` : f.name;
  const normalize = s => String(s).normalize('NFKC').toLocaleLowerCase();
  const validField = f => f && ((typeof f.fdId === 'string' && f.fdId) ||
    (typeof f.layerTreeId === 'string' && f.layerTreeId)) && typeof f.name === 'string' && f.name && !f.hidden && !f.isStatic;
  const dynamicField = f => f?.isStatic === true && typeof f.dzId === 'string' && f.dzId &&
    ['DIM', 'METRIC'].includes(f.metaType) && typeof f.name === 'string' && f.name && !f.hidden;
  // Native configuration creates a new group ID instead of retaining the template ID.
  const additionCount = (target, field) => dynamicField(field)
    ? new Set(target.zoneFields.filter(f => f.dzId).map(f => f.dzId)).size : fieldCount(target, field);

  function* propsChain(node) {
    let fiber = node?.[Object.keys(node).find(k => k.startsWith('__reactFiber$'))];
    for (let depth = 0; fiber && depth < 60; depth++, fiber = fiber.return) {
      let root = fiber;
      while (root.return) root = root.return;
      const current = root.stateNode?.current;
      const active = current && current !== root && fiber.alternate ? fiber.alternate : fiber;
      yield active.memoizedProps || {};
    }
  }

  function readTarget(node) {
    if (!node?.isConnected || !node.getAttribute('data-testid')?.startsWith('ph_')) return null;
    const zoneNode = node.closest('.zone');
    if (!zoneNode) return null;
    let drop, zone, localMeta, localFields;
    for (const p of propsChain(node)) {
      if (!drop && typeof p.onDrop === 'function' && typeof p.canDrop === 'function') drop = p;
      if (!localMeta && p.zoneMeta) localMeta = p.zoneMeta;
      if (!localFields && p.zoneMeta?.zoneId === localMeta?.zoneId && Array.isArray(p.zoneFields)) localFields = p.zoneFields;
      if (p.zoneMeta && Array.isArray(p.zoneFields) && (p.dsColumns || p.im_dsColumns)) {
        zone = { ...p, zoneMeta: localMeta || p.zoneMeta, zoneFields: localFields || p.zoneFields }; break;
      }
    }
    if (!drop || !zone) return null;
    const metadata = zoneMetadata(zone, node, zoneNode);
    return metadata && { ...metadata, disabled: !!drop.dropDisabled,
      canDrop: field => drop.canDrop(field), onDrop: item => drop.onDrop(item) };
  }

  function zoneMetadata(zone, node, zoneNode) {
    const columnsRef = zone.dsColumns || zone.im_dsColumns;
    let columns;
    try { columns = Array.isArray(columnsRef) ? columnsRef : columnsRef.toJS(); } catch { return null; }
    if (!Array.isArray(columns) || !zone.zoneMeta.zoneId) return null;
    return {
      node, zoneNode, columns, columnsRef, zoneMeta: zone.zoneMeta, zoneFields: zone.zoneFields,
      chartType: zone.chartType,
      title: zone.zoneMeta.zoneType === 'DYNAMIC_ZONE' ? (zone.zoneMeta.needAggregation ? '动态数值' : '动态维度') :
        zone.zoneMeta.zoneType === 'TREE_FIELD' ? '树字段' :
        zoneNode.querySelector('.gd-text-primary')?.textContent?.trim() || zone.zoneMeta.title || zone.zoneMeta.zoneId,
    };
  }

  function readFullTarget(zoneNode) {
    if (!zoneNode?.isConnected) return null;
    for (const p of propsChain(zoneNode)) {
      if (!p.zoneMeta || !Array.isArray(p.zoneFields) || !(p.dsColumns || p.im_dsColumns)) continue;
      if (p.zoneMeta.maxCount < 0 || !(p.zoneFields.length >= p.zoneMeta.maxCount)) return null;
      const metadata = zoneMetadata(p, zoneNode, zoneNode);
      return metadata && { ...metadata, disabled: true, canDrop: () => false };
    }
    return null;
  }

  function sourceFields(doc) {
    const fields = [];
    for (const node of doc.querySelectorAll('[draggable="true"]')) {
      if (node.closest('.zone')) continue;
      for (const p of propsChain(node)) {
        if (typeof p.getItem !== 'function') continue;
        try {
          const { selectedItems, ...field } = p.getItem() || {};
          if (!p.dragDisabled && (validField(field) || dynamicField(field))) fields.push(field);
        } catch { /* A source unmounting during a dataset change is skipped. */ }
        break;
      }
    }
    return fields;
  }

  function collectFields(target, sources = []) {
    const fields = new Map();
    for (const field of [...target.columns, ...sources]) {
      if (target.zoneMeta.zoneType === 'TREE_FIELD' && !field?.layerTreeId) continue;
      if (validField(field) || dynamicField(field)) fields.set(id(field), field);
    }
    return [...fields.values()];
  }

  function optionState(target, field) {
    if (!validField(field) && !dynamicField(field)) return 'blocked';
    if (target.zoneMeta.maxCount >= 0 && target.zoneFields.length >= target.zoneMeta.maxCount) return 'full';
    if (target.disabled) return 'blocked';
    try { return target.canDrop(field) === true ? 'ready' : 'blocked'; } catch { return 'blocked'; }
  }

  function dispatchAdd(target, field) {
    if (optionState(target, field) !== 'ready') throw Error('栏目已满或原页面不允许添加');
    const { selectedItems, ...item } = field;
    // The native empty-slot handler normalizes fields and appends selectedItems;
    // configured-chip handlers would insert/replace, so they are never used.
    return target.onDrop({ ...item, selectedItems: [{ ...item }] });
  }

  function keyAction(e) {
    if (e.isComposing || e.keyCode === 229 || (e.key === 'Enter' && e.repeat)) return null;
    return { Enter: 'add', ArrowDown: 'next', ArrowUp: 'previous', Escape: 'close' }[e.key] || null;
  }

  class SearchSession {
    constructor(fields, target) { this.query = ''; this.active = -1; this.rows = []; this.refresh(fields, target); }
    get selected() { return this.rows[this.active] || null; }
    setQuery(query) { this.query = query; this.active = -1; this.rows = []; this.refresh(this.fields, this.target); }
    refresh(fields, target) {
      const previous = this.selected?.id, previousIndex = this.active;
      this.fields = fields; this.target = target;
      const terms = normalize(this.query).trim().split(/\s+/).filter(Boolean);
      this.rows = fields.filter(f => terms.every(t => normalize(label(f)).includes(t)))
        .map(field => ({ field, id: id(field), label: label(field), count: fieldCount(target, field), status: optionState(target, field) }));
      this.active = this.rows.findIndex(r => r.id === previous && r.status === 'ready');
      if (this.active < 0 && previous) this.active = this.rows.findIndex((r, i) => i >= previousIndex && r.status === 'ready');
      if (this.active < 0) this.active = this.rows.findIndex(r => r.status === 'ready');
    }
    move(direction) {
      const indices = this.rows.map((r, i) => r.status === 'ready' ? i : -1).filter(i => i >= 0);
      if (!indices.length) return;
      this.active = indices[(indices.indexOf(this.active) + direction + indices.length) % indices.length];
    }
  }

  function dynamicKeyboard(dialog) {
    const input = dialog.querySelector('input[placeholder="搜索"]');
    const list = input?.closest('.ant-input-affix-wrapper')?.nextElementSibling;
    if (!input || !list) return null;
    const saved = new Map();
    function attrs(node, values) {
      if (!saved.has(node)) saved.set(node, new Map());
      for (const [key, value] of Object.entries(values)) {
        if (!saved.get(node).has(key)) saved.get(node).set(key, node.getAttribute(key));
        if (value === null) node.removeAttribute(key); else node.setAttribute(key, value);
      }
    }
    const hint = dialog.ownerDocument.createElement('div');
    hint.className = 'gfp-native-hint';
    hint.textContent = '↑↓ 定位 · Enter 勾选/取消 · ⌘/Ctrl+Enter 确认后继续添加 · Esc 取消';
    list.before(hint);
    attrs(list, { role: 'listbox', 'aria-multiselectable': 'true', id: list.id || 'gfp-native-options' });
    attrs(input, { role: 'combobox', 'aria-controls': list.id, 'aria-expanded': 'true', 'aria-autocomplete': 'list' });
    let rows = [], current, query;
    function refreshRows() {
      rows = [...list.children].filter(n => n.querySelector('.gd-text-primary'));
      if (query !== input.value || !rows.includes(current)) current = rows[0];
      query = input.value;
      rows.forEach((row, i) => attrs(row, { id: row.id || `gfp-native-option-${i}`, role: 'option',
        'aria-selected': String(!!row.querySelector('.fg-selected')), 'data-gfp-native-current': row === current ? '' : null }));
      attrs(input, { 'aria-activedescendant': current?.id || null });
    }
    function keydown(e) {
      const action = keyAction(e);
      if (!action || action === 'close') return;
      if (action === 'add' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault(); e.stopPropagation();
        const confirm = [...dialog.querySelectorAll('.ant-modal-footer button')].find(n => n.textContent.trim() === '确定');
        if (confirm && !confirm.disabled) confirm.click();
        return;
      }
      if (e.target !== input) return;
      e.preventDefault(); e.stopPropagation(); refreshRows();
      if (action === 'add') current?.click();
      else if (rows.length) current = rows[(rows.indexOf(current) + (action === 'next' ? 1 : -1) + rows.length) % rows.length];
      refreshRows(); current?.scrollIntoView({ block: 'nearest' }); input.focus({ preventScroll: true });
    }
    dialog.addEventListener('keydown', keydown, true);
    refreshRows(); input.focus({ preventScroll: true });
    return { dialog, refresh: refreshRows, stop() {
      dialog.removeEventListener('keydown', keydown, true); hint.remove();
      for (const [node, values] of saved) for (const [key, value] of values) {
        if (value === null) node.removeAttribute(key); else node.setAttribute(key, value);
      }
    } };
  }

  function install(win) {
    win[KEY]?.stop();
    const doc = win.document;
    const onEditPage = () => /^\/card\/[^/]+\/edit\/?$/.test(win.location.pathname);
    const hosts = new Map();
    let active, pending, nativeKeys, suspended = false, stopped = false, timer, deadline;
    function el(tag, className, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }
    const style = el('style');
    style.textContent = `
      [data-gfp-host] > .gfp-add {position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:2px;background:var(--color-bg-card,#fff);color:var(--color-text-hint,#949ba8);font:inherit;font-size:12px;cursor:pointer;padding:0 4px;}
      [data-gfp-host] > .gfp-add:hover,[data-gfp-host] > .gfp-add:focus-visible {background:#f0f4ff;color:#315fcb;outline:1px solid #7c9fec;outline-offset:-1px;}
      .gfp-panel {position:fixed;z-index:1050;width:340px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);display:flex;flex-direction:column;background:var(--color-bg-card,#fff);color:var(--color-text-primary,#30343b);border:1px solid #d9dde7;border-radius:3px;box-shadow:0 5px 18px #15223b26;font:12px/1.5 -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;box-sizing:border-box;}
      .gfp-panel[hidden] {display:none;}
      .gfp-heading {display:flex;justify-content:space-between;align-items:center;padding:10px 12px 8px;}
      .gfp-close {background:none;border:0;font-size:18px;color:#969daa;cursor:pointer;padding:0 3px;}
      .gfp-search {display:block;width:calc(100% - 20px);box-sizing:border-box;flex:none;height:32px;margin:0 10px 7px;padding:5px 9px;border:1px solid #4d7cef;border-radius:2px;font:inherit;background:var(--color-bg-card,#fff);color:inherit;outline:none;}
      .gfp-search:focus {box-shadow:0 0 0 2px #edf2ff;}
      [data-gfp-native-current] {outline:1px solid #7c9fec;outline-offset:-1px;background:#e9efff;}
      .gfp-native-hint {font-size:11px;color:#68758b;padding:6px 0;}
      .gfp-options {overflow:auto;max-height:min(320px,55vh);min-height:36px;padding:0 5px 5px;}
      .gfp-option {display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:0;border-radius:0;min-height:32px;padding:7px 8px;background:none;color:inherit;font:inherit;cursor:pointer;}
      .gfp-option[aria-selected=true] {background:#e9efff;}
      .gfp-option:disabled {cursor:default;color:#a2a9b6;}
      .gfp-name {flex:1;min-width:0;white-space:normal;overflow-wrap:anywhere;}
      .gfp-kind,.gfp-state {font-size:10px;color:#8b98ae;flex-shrink:0;}
      .gfp-kind {min-width:17px;color:#536aab;}
      .gfp-foot {border-top:1px solid #e5e8ee;background:#fafbfe;padding:8px 10px;font-size:10px;color:#8d96a7;}
      .gfp-status {color:#5b7199;min-height:15px;}
      .gfp-empty {padding:18px 8px;text-align:center;color:#939cac;}
    `;
    doc.head.appendChild(style);
    const panel = el('section', 'gfp-panel');
    panel.hidden = true; panel.setAttribute('aria-label', '搜索并添加字段');
    const heading = el('div', 'gfp-heading'), title = el('span'), closeButton = el('button', 'gfp-close', '×');
    closeButton.type = 'button'; closeButton.setAttribute('aria-label', '关闭字段搜索');
    heading.append(title, closeButton);
    const input = el('input', 'gfp-search');
    input.id = 'gfp-search'; input.placeholder = '搜索字段名称…'; input.autocomplete = 'off';
    input.setAttribute('aria-label', '搜索字段'); input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-controls', 'gfp-options'); input.setAttribute('aria-expanded', 'false');
    const list = el('div', 'gfp-options'); list.id = 'gfp-options'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', '匹配字段');
    const foot = el('div', 'gfp-foot'), hint = el('div', '', '↑↓ 选择 · Enter 添加 · ⌘/Ctrl A 换词 · Esc 关闭');
    const status = el('div', 'gfp-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    foot.append(hint, status); panel.append(heading, input, list, foot); doc.body.appendChild(panel);

    const signature = t => `${win.location.pathname}|${t.chartType}|${t.columns.map(id).join('|')}`;
    function resolveTarget() {
      if (!active || !onEditPage()) return null;
      const node = [...doc.querySelectorAll(PLACEHOLDER)].find(n => n.getAttribute('data-testid') === active.phId);
      const t = readTarget(node) || readFullTarget(active.zoneNode);
      return t && t.zoneMeta.zoneId === active.zoneId && signature(t) === active.signature ? t : null;
    }
    function nativeOverlay() {
      return [...doc.querySelectorAll('[role="dialog"],[role="tooltip"],.ant-modal')].some(n =>
        !panel.contains(n) && n.getClientRects().length && win.getComputedStyle(n).visibility !== 'hidden' &&
        n.querySelector('input,button,select,[role="combobox"]'));
    }
    function tell(message) { status.textContent = message; }
    function focusSearch() {
      if (!active || suspended) return;
      input.focus({ preventScroll: true });
      if (active.selection) input.setSelectionRange(...active.selection);
    }
    function position() {
      const t = resolveTarget();
      if (!t || panel.hidden) return;
      const r = t.node.getBoundingClientRect(), box = panel.getBoundingClientRect();
      const left = r.right + 10 + box.width <= win.innerWidth ? r.right + 10 : Math.max(8, r.left - box.width - 10);
      panel.style.left = Math.max(8, Math.min(left, win.innerWidth - box.width - 8)) + 'px';
      panel.style.top = Math.max(8, Math.min(r.top, win.innerHeight - box.height - 8)) + 'px';
    }
    function highlight() {
      if (!active) return;
      [...list.querySelectorAll('.gfp-option')].forEach((n, i) => n.setAttribute('aria-selected', String(i === active.session.active)));
      if (active.session.selected) {
        input.setAttribute('aria-activedescendant', `gfp-option-${active.session.active}`);
        list.children[active.session.active]?.scrollIntoView({ block: 'nearest' });
      } else input.removeAttribute('aria-activedescendant');
    }
    function render() {
      if (!active) return;
      closeButton.textContent = active.parent ? '‹' : '×';
      closeButton.setAttribute('aria-label', active.parent ? '返回上一级字段搜索' : '关闭字段搜索');
      hint.textContent = `↑↓ 选择 · Enter 连续/重复添加 · ⌘/Ctrl A 换词 · Esc ${active.parent ? '返回上一级' : '关闭'}`;
      const scroll = list.scrollTop;
      const fragment = doc.createDocumentFragment();
      for (const [index, row] of active.session.rows.entries()) {
        const button = el('button', 'gfp-option'); button.type = 'button'; button.id = `gfp-option-${index}`; button.tabIndex = -1;
        button.dataset.index = index; button.setAttribute('role', 'option'); button.disabled = !!pending || row.status !== 'ready';
        const f = row.field, kind = /DATE|TIME/.test(f.fdType) ? '◷' : f.metaType === 'METRIC' ? '#' : 'Aa';
        button.append(el('span', 'gfp-kind', kind), el('span', 'gfp-name', row.label));
        if (row.count) button.append(el('span', 'gfp-state', `已添加 ${row.count} 次`));
        button.append(el('span', 'gfp-state', { ready: dynamicField(f) ? '打开配置' : f.layerTreeId ? '树字段' : f.fdType, blocked: '此栏目不支持', full: '栏目已满' }[row.status]));
        fragment.appendChild(button);
      }
      if (!active.session.rows.length) fragment.appendChild(el('div', 'gfp-empty', active.session.target.zoneMeta.zoneType === 'TREE_FIELD'
        ? '没有匹配的树字段；此位置仅接受原生树字段' : '没有匹配字段，试试其他关键词'));
      list.replaceChildren(fragment); list.scrollTop = scroll; position(); highlight();
    }
    function close(restore = true) {
      if (restore && active?.parent) {
        const parent = active.parent;
        close(false); active = parent;
        const t = resolveTarget();
        if (!t) { close(false); return; }
        active.fields = collectFields(t, sourceFields(doc)); active.session.refresh(active.fields, t);
        input.value = active.session.query; title.textContent = `添加到：${t.title}`;
        panel.hidden = false; input.setAttribute('aria-expanded', 'true');
        tell('已返回原栏目搜索'); render(); focusSearch(); return;
      }
      const node = resolveTarget()?.node;
      active = null; pending = null; suspended = false;
      nativeKeys?.stop(); nativeKeys = null;
      win.clearTimeout(deadline); panel.hidden = true; input.setAttribute('aria-expanded', 'false');
      if (restore) node?.querySelector('.gfp-add')?.focus({ preventScroll: true });
    }
    function open(node) {
      const t = readTarget(node);
      if (!t || nativeOverlay()) return;
      close(false);
      const fields = collectFields(t, sourceFields(doc));
      active = { phId: node.getAttribute('data-testid'), zoneId: t.zoneMeta.zoneId, zoneNode: t.zoneNode,
        signature: signature(t), fields, session: new SearchSession(fields, t) };
      input.value = ''; title.textContent = `添加到：${t.title}`; tell(`共 ${fields.length} 个字段 · 添加后保留搜索`);
      panel.hidden = false; input.setAttribute('aria-expanded', 'true'); render(); focusSearch();
    }
    function waitForResult(request) {
      win.clearTimeout(deadline);
      if (suspended) return;
      deadline = win.setTimeout(() => {
        if (pending === request && !nativeOverlay()) fail('尚未检测到添加结果，请检查原页面提示后重试');
      }, 10000);
    }
    function settle() {
      const t = resolveTarget();
      if (!t) { close(false); return; }
      const overlay = nativeOverlay();
      if (overlay) {
        if (!suspended) active.selection = [input.selectionStart, input.selectionEnd];
        win.clearTimeout(deadline);
        suspended = true; panel.hidden = true;
        return;
      }
      if (suspended) {
        suspended = false; panel.hidden = false; focusSearch();
        if (pending) waitForResult(pending);
      }
      if (pending?.cancelled) {
        pending = null; win.clearTimeout(deadline); tell('已取消动态字段配置');
      }
      if (pending && additionCount(t, pending.field) > pending.count) {
        if (dynamicField(pending.field)) {
          const dzId = t.zoneFields.find(f => f.dzId && !pending.groupIds.includes(f.dzId))?.dzId;
          const node = [...doc.querySelectorAll(PLACEHOLDER)].find(n => {
            const target = readTarget(n);
            return target?.zoneMeta.zoneType === 'DYNAMIC_ZONE' && target.zoneMeta.zoneId === dzId;
          });
          if (node) {
            const parent = active;
            open(node); active.parent = parent;
            const first = active.session.target.zoneFields[0];
            const index = active.session.rows.findIndex(r => first && sameField(r.field, first) && r.status === 'ready');
            if (index >= 0) active.session.active = index;
            tell('动态组已创建 · Enter 可重复添加当前字段 · Esc 返回原栏目'); render(); focusSearch(); return;
          }
        }
        tell(`已添加「${label(pending.field)}」到${t.title}` + (dynamicField(pending.field) ? '' : ` · 已添加 ${fieldCount(t, pending.field)} 次`)); pending = null; win.clearTimeout(deadline);
        active.session.refresh(active.fields, t); render(); focusSearch(); return;
      }
      active.session.refresh(active.fields, t); render();
    }
    function fail(message) {
      if (!active) return;
      pending = null; win.clearTimeout(deadline); tell(message);
      if (!suspended) { render(); focusSearch(); }
    }
    function addSelected() {
      if (!active || pending || suspended) return;
      const t = resolveTarget(), selected = active.session.selected;
      if (!t) { close(false); return; }
      if (!selected) return;
      const fresh = collectFields(t, sourceFields(doc)).find(f => id(f) === selected.id);
      if (!fresh) { fail('字段已变化，请关闭后重新搜索'); return; }
      active.selection = [input.selectionStart, input.selectionEnd];
      const request = { field: fresh, count: additionCount(t, fresh), groupIds: t.zoneFields.map(f => f.dzId).filter(Boolean) };
      pending = request; tell('正在由观远处理…'); render();
      try {
        const result = dispatchAdd(t, fresh);
        if (result?.then) Promise.resolve(result).then(schedule).catch(e => {
          if (pending === request) fail(`添加失败：${e.message || '请检查原页面提示'}`);
        });
        settle(); schedule();
        if (pending === request) waitForResult(request);
      } catch (e) { fail(`添加失败：${e.message || '请检查原页面提示'}`); }
    }
    function refresh() {
      if (stopped) return;
      const wanted = new Set(onEditPage() ? doc.querySelectorAll(PLACEHOLDER) : []);
      for (const [node, button] of hosts) {
        if (!wanted.has(node)) { button.remove(); node.removeAttribute('data-gfp-host'); hosts.delete(node); }
      }
      for (const node of wanted) {
        const target = readTarget(node);
        if (!target) {
          hosts.get(node)?.remove(); hosts.delete(node); node.removeAttribute('data-gfp-host');
          continue;
        }
        if (hosts.has(node)) {
          hosts.get(node).setAttribute('aria-label', `搜索添加字段到${target.title}`);
          continue;
        }
        const button = el('button', 'gfp-add', '＋ 搜索或拖入字段'); button.type = 'button';
        button.setAttribute('aria-label', `搜索添加字段到${target.title}`);
        button.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); open(node); });
        node.setAttribute('data-gfp-host', ''); node.appendChild(button); hosts.set(node, button);
      }
      if (active) settle();
      const dialog = dynamicField(pending?.field) && [...doc.querySelectorAll('[role="dialog"]')].find(n =>
        n.getClientRects().length && /^配置动态(维度|数值)$/.test(n.querySelector('.ant-modal-title')?.textContent?.trim()));
      if (nativeKeys?.dialog !== dialog) { nativeKeys?.stop(); nativeKeys = dialog ? dynamicKeyboard(dialog) : null; }
      nativeKeys?.refresh();
    }
    function schedule() {
      if (stopped || timer !== undefined) return;
      timer = win.setTimeout(() => { timer = undefined; refresh(); }, 80);
    }
    input.addEventListener('input', () => { if (!active) return; active.selection = null; active.session.setQuery(input.value); render(); });
    input.addEventListener('keydown', e => {
      const action = keyAction(e); if (!action) return;
      e.preventDefault(); e.stopPropagation();
      if (action === 'close') close();
      else if (action === 'add') addSelected();
      else if (active) { active.session.move(action === 'next' ? 1 : -1); highlight(); }
    });
    list.addEventListener('mousedown', e => e.preventDefault());
    list.addEventListener('click', e => {
      const button = e.target.closest('.gfp-option');
      if (!active || !button || button.disabled) return;
      active.session.active = Number(button.dataset.index); addSelected();
    });
    closeButton.addEventListener('click', () => close());
    function outside(e) {
      if (!active || suspended || pending || panel.contains(e.target) || e.target.closest('.gfp-add')) return;
      // Configuring a chip in this column is part of the same search session.
      if (e.target.closest('[data-testid^="drop_"]')?.closest('.zone') === resolveTarget()?.zoneNode) return;
      close(false);
    }
    function escape(e) {
      if (e.key === 'Escape' && suspended && dynamicField(pending?.field)) pending.cancelled = true;
      if (e.key === 'Escape' && active && !suspended && !nativeOverlay() && !panel.contains(e.target)) close();
    }
    function nativeCancel(e) {
      if (!dynamicField(pending?.field) || !nativeOverlay() || panel.contains(e.target)) return;
      const button = e.target.closest('button');
      if (button && (button.textContent.trim() === '取消' || button.getAttribute('aria-label') === 'Close')) pending.cancelled = true;
    }
    doc.addEventListener('pointerdown', outside, true); doc.addEventListener('keydown', escape, true);
    doc.addEventListener('click', nativeCancel, true);
    win.addEventListener('resize', position); win.addEventListener('scroll', position, true); win.addEventListener('popstate', schedule);
    const observer = new win.MutationObserver(mutations => {
      if (mutations.some(m => !panel.contains(m.target) && !m.target.closest?.('.gfp-add'))) schedule();
    });
    observer.observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'aria-hidden'] });
    win[KEY] = {
      refresh,
      stop() {
        stopped = true; close(false); observer.disconnect();
        win.clearTimeout(timer);
        for (const [node, button] of hosts) { button.remove(); node.removeAttribute('data-gfp-host'); }
        hosts.clear(); panel.remove(); style.remove();
        doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('keydown', escape, true);
        doc.removeEventListener('click', nativeCancel, true);
        win.removeEventListener('resize', position); win.removeEventListener('scroll', position, true); win.removeEventListener('popstate', schedule);
        delete win[KEY];
      },
    };
    refresh();
    return win[KEY];
  }
  return { readTarget, readFullTarget, collectFields, optionState, fieldCount, additionCount, dynamicField, dynamicKeyboard, dispatchAdd, SearchSession, keyAction, install };
});
