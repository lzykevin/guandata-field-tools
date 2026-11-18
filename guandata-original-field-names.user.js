// ==UserScript==
// @name         观远：重命名字段显示原名
// @namespace    guandata-field-tools
// @version      0.3.3
// @description  显示配置字段原名及完整筛选条件，长内容自动换行；不发送网络请求。
// @match        https://bibr.staff.xdf.cn/*
// @run-at       document-idle
// @grant        none
// @sandbox      raw
// ==/UserScript==

(() => {
  'use strict';
  const KEY = '__guandataOriginalFieldNames';
  window[KEY]?.stop();
  const ATTR = 'data-guandata-original-name';
  const SUMMARY = 'data-guandata-filter-summary';
  const HEADING = 'data-guandata-filter-heading';
  const VALUES = 'data-guandata-filter-values';
  // Shared field-chip structure, not chart types, headings or dimension/metric variants.
  // Requiring a configured drop slot excludes the source field list and chart text.
  const FIELD = '.zone [data-testid^="drop_"] [draggable="true"] [class*="gd-color-bg-"]';
  const style = document.createElement('style');
  style.textContent = `
    [${ATTR}] {
      position: relative !important;
      padding-bottom: 16px !important;
      min-height: 42px !important;
      box-sizing: border-box !important;
    }
    .zone [data-testid^="drop_"]:has([${ATTR}]) {
      height: auto !important;
      min-height: 44px !important;
      flex-shrink: 0 !important;
    }
    [${ATTR}]::after {
      content: attr(${ATTR});
      position: absolute;
      left: 30px;
      right: 22px;
      bottom: 2px;
      font-size: 11px;
      font-weight: normal;
      line-height: 14px;
      color: #687482;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      pointer-events: none;
    }
    [${SUMMARY}] {
      position: relative !important;
      height: auto !important;
      min-height: 26px !important;
      padding-bottom: 0 !important;
      flex-wrap: wrap !important;
      box-sizing: border-box !important;
    }
    .zone [data-testid^="drop_"]:has([${SUMMARY}]) {
      height: auto !important;
      flex-shrink: 0 !important;
    }
    [${SUMMARY}]::after {
      content: attr(${SUMMARY});
      position: static;
      display: block;
      flex: 0 0 calc(100% - 44px);
      min-width: 0;
      margin: 0 22px 4px;
      left: auto;
      right: auto;
      bottom: auto;
      font-size: 11px;
      font-weight: normal;
      line-height: 16px;
      color: var(--color-text-hint, #687482);
      white-space: pre-wrap;
      max-height: 96px;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: transparent transparent;
      overflow-wrap: anywhere;
      text-overflow: clip;
      pointer-events: auto;
    }
    [${SUMMARY}]:hover::after,
    [${SUMMARY}]:focus-within::after {
      scrollbar-color: rgb(104 116 130 / 45%) transparent;
    }
    [${HEADING}]::before {
      content: attr(${HEADING});
      order: 1;
      display: block;
      flex: 0 0 calc(100% - 44px);
      margin: 0 22px;
      font-size: 11px;
      font-weight: normal;
      line-height: 16px;
      color: var(--color-text-hint, #687482);
      pointer-events: none;
    }
    [${HEADING}]::after {
      content: attr(${VALUES});
      order: 2;
      max-height: 80px;
    }
  `;
  document.head.appendChild(style);

  // Only read React element text, never invoke components, handlers or getters.
  function elementText(value, depth = 0) {
    if (depth > 10 || value == null) return '';
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (Array.isArray(value)) return value.map(v => elementText(v, depth + 1)).join('');
    return value.props ? elementText(value.props.children, depth + 1) : '';
  }

  function parseTitle(title) {
    // The app's tooltip is a div containing the display name and a separate
    // "原名: ..." div. Do not infer a source name from the displayed alias.
    const children = title?.props?.children;
    if (!Array.isArray(children)) return '';
    for (const child of children) {
      const match = elementText(child).match(/^原名\s*[:：]\s*(.+)$/s);
      if (match) return match[1].trim();
    }
    return '';
  }

  function fieldInfo(node) {
    const key = Object.keys(node).find(k => k.startsWith('__reactFiber$'));
    let fiber = key && node[key];
    let tooltipName = '';
    let foundTooltip = false;
    for (let depth = 0; fiber && depth < 40; depth++, fiber = fiber.return) {
      // DOM-linked fibers may describe the previous commit after a rename.
      let root = fiber;
      while (root.return) root = root.return;
      const current = root.stateNode?.current;
      const active = current && current !== root && fiber.alternate ? fiber.alternate : fiber;
      const props = active.memoizedProps || {};
      // Never climb beyond this configured field's zone into unrelated state.
      if (typeof props.className === 'string' && props.className.split(/\s+/).includes('zone')) break;
      const field = props.zoneField;
      if (field && typeof field === 'object') {
        // SUB_DATE.name is a granularity label (年/月/日), NOT the source name.
        // Show the source even without an alias: the primary label still includes
        // its date granularity. Missing metadata must not produce a guessed name.
        const name = field.fdType === 'SUB_DATE'
          ? (typeof field.parentFdName === 'string' ? field.parentFdName.trim() : '')
          : tooltipName;
        return { name, field, isFilter: field.zoneId === 'filters' || props.zoneMeta?.zoneId === 'filters' };
      }
      if (!foundTooltip && Object.prototype.hasOwnProperty.call(props, 'title')) {
        foundTooltip = true;
        tooltipName = parseTitle(props.title);
      }
    }
    return { name: tooltipName, isFilter: false };
  }

  function filterSummary(field) {
    const unknown = '暂无法读取筛选条件';
    const { filterType: type, filterValue: values, fdType } = field;
    if (field.compareColumn) return unknown;
    if (type === 'CUSTOM') return typeof field.advFilterContent === 'string' && field.advFilterContent.trim()
      ? field.advFilterContent : unknown;
    const unary = { IS_NULL: '为空', NOT_NULL: '不为空', NO_LIMIT: '不限' };
    if (Object.hasOwn(unary, type)) return unary[type];
    if (!Array.isArray(values) || !values.length || !values.every(v =>
      v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)))) return unknown;
    const text = values.map(v => v === null ? '(null)' : String(v));
    if (type === 'IN' || type === 'NI') {
      return `${type === 'NI' ? '排除' : '选中'} · ${text.length} 项\n${text.join('、')}`;
    }
    const ranges = { BT: ['≥', '≤'], CLOSE_BT_OPEN: ['≥', '<'], OPEN_BT_CLOSE: ['>', '≤'], OPEN_BT_OPEN: ['>', '<'] };
    if (Object.hasOwn(ranges, type)) {
      if (text.length !== 2 || values.some(v => v === null || v === '')) return unknown;
      const date = ['DATE', 'TIMESTAMP', 'SUB_DATE'].includes(fdType);
      const mode = date ? (text.some(v => v.includes('{{')) ? ' · 自定义时间宏' : ' · 固定日期') : '';
      return `区间${mode}\n${ranges[type][0]} ${text[0]}\n${ranges[type][1]} ${text[1]}`;
    }
    const labels = {
      EQ: '等于', NE: '不等于', GT: '大于', GE: '大于等于', LT: '小于', LE: '小于等于',
      CONTAINS: '包含', NOT_CONTAINS: '不包含', STARTSWITH: '以...开始', ENDSWITH: '以...结尾',
      NOT_STARTSWITH: '不以...开始', NOT_ENDSWITH: '不以...结尾',
    };
    return Object.hasOwn(labels, type) && text.length === 1 ? `${labels[type]}：${text[0]}` : unknown;
  }

  function refresh() {
    const wanted = new Map();
    const summaries = new Map();
    if (/^\/card\/[^/]+\/edit\/?$/.test(location.pathname)) {
      for (const node of document.querySelectorAll(FIELD)) {
        const { name, field, isFilter } = fieldInfo(node);
        if (name) wanted.set(node, name);
        if (isFilter) {
          const summary = filterSummary(field);
          const split = summary.indexOf('\n');
          const multi = ['IN', 'NI'].includes(field.filterType) && split !== -1;
          summaries.set(node, {
            [SUMMARY]: [name, summary].filter(Boolean).join('\n'),
            [HEADING]: multi ? summary.slice(0, split) : null,
            [VALUES]: multi ? [name, summary.slice(split + 1)].filter(Boolean).join('\n') : null,
          });
        }
      }
    }
    for (const node of document.querySelectorAll(`[${ATTR}]`)) {
      if (!wanted.has(node)) node.removeAttribute(ATTR);
    }
    for (const [node, name] of wanted) {
      if (node.getAttribute(ATTR) !== name) node.setAttribute(ATTR, name);
    }
    for (const node of document.querySelectorAll(`[${SUMMARY}]`)) {
      if (!summaries.has(node)) {
        for (const attr of [SUMMARY, HEADING, VALUES]) node.removeAttribute(attr);
      }
    }
    for (const [node, attrs] of summaries) {
      for (const [attr, text] of Object.entries(attrs)) {
        if (text === null) node.removeAttribute(attr);
        else if (node.getAttribute(attr) !== text) node.setAttribute(attr, text);
      }
    }
  }

  // Local DOM notifications only; no timers that poll the site, no network APIs.
  let timer;
  let stopped = false;
  const schedule = () => {
    if (stopped || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      refresh();
    }, 120);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['class'],
  });
  window.addEventListener('popstate', schedule);
  window[KEY] = {
    refresh,
    stop() {
      stopped = true;
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener('popstate', schedule);
      style.remove();
      document.querySelectorAll(`[${ATTR}]`).forEach(node => node.removeAttribute(ATTR));
      document.querySelectorAll(`[${SUMMARY}]`).forEach(node => {
        for (const attr of [SUMMARY, HEADING, VALUES]) node.removeAttribute(attr);
      });
      delete window[KEY];
    },
  };
  refresh();
})();
