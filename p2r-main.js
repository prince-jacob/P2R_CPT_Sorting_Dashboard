// ==UserScript==
// OFFICIAL_P2R_CPT_SCRIPT_PRINCE_JACOB
// @name         Rodeo P2R CPT Sorting Dashboard - NCL1
// @namespace    wprijaco.rodeo.p2r.shipment.dashboard
// @version      1.9
// @description  Live P2R dashboard with safer scan engine, toast/status messages, missing-column checks, persisted UI, and official-script marker.
// @author       Prince Jacob (Wprijaco)
// @creator      Prince Jacob (Wprijaco)
// @match        https://rodeo-dub.amazon.com/NCL1/Search*
// @match        file:///*
// @grant        GM_setClipboard
// @grant        GM_info
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /******************************************************************
   * PAGE LIMITER
   ******************************************************************/
  function isAllowedPage() {
    const url = new URL(location.href);

    if (url.protocol === 'file:') {
      return /Search\s*Result\s*List/i.test(decodeURIComponent(url.href));
    }

    if (url.hostname !== 'rodeo-dub.amazon.com') return false;
    if (url.pathname !== '/NCL1/Search') return false;
    if (url.searchParams.get('searchKey') !== 'tspsP2R') return false;

    const enabled = url.searchParams.getAll('enabledColumns');

    return (
      enabled.includes('ASIN_TITLES') &&
      enabled.includes('DEMAND_ID') &&
      enabled.includes('OUTER_SCANNABLE_ID')
    );
  }

  if (!isAllowedPage()) return;

  /******************************************************************
   * SETTINGS
   ******************************************************************/
  const SCRIPT_VERSION = '1.9';
  const OFFICIAL_SCRIPT_MARKER = 'OFFICIAL_P2R_CPT_SORTER_PRINCE_JACOB_V1';

  // When we move this to GitHub, add @updateURL and @downloadURL in the metadata above.
  // Keep this main script local and fast: no repeated external checks during live work.
  const CHECK_INTERVAL_MS = 2500;
  const TAB_REFRESH_INTERVAL_MS = 15000;
  const SCAN_DEBOUNCE_MS = 700;
  const MAX_CHANGE_LOG = 15;

  const RED_MINUTES_LEFT = 70;
  const ORANGE_MINUTES_LEFT = 90;

  const ISSUE_RULES = [
    { key: 'missing', label: 'Missing', emoji: '🚩', match: /missing/i, className: 'rp2r-missing' },
    { key: 'cannot_create_package', label: 'Cannot create package', emoji: '🆘', match: /cannot create package/i, className: 'rp2r-cannot' },
    { key: 'duplicate_serial', label: 'Duplicate Serial', emoji: '⛔', match: /duplicate serial/i, className: 'rp2r-duplicate' },
    { key: 'damage', label: 'Damage', emoji: '☢️', match: /damage/i, className: 'rp2r-damage' },
    { key: 'pslip', label: 'PSlip', emoji: '🖨️', match: /pslip/i, className: 'rp2r-pslip' },
    { key: 'rollback', label: 'Rollback', emoji: '↩️', match: /rollback/i, className: 'rp2r-rollback' }
  ];

  const state = {
    previous: new Map(),
    currentRows: [],
    groups: [],
    changes: [],
    filter: 'all',
    paused: false,
    collapsed: localStorage.getItem('rp2rDashboardCollapsed') === 'true',
    autoTabRefresh: localStorage.getItem('rp2rAutoTabRefresh') === 'true',
    tabRefreshTimer: null,
    scanRunning: false,
    lastScanStarted: 0,
    lastWarning: ''
  };

  /******************************************************************
   * CSS
   ******************************************************************/
  const css = `
    .rp2r-row {
      transition: background 0.25s ease, outline 0.25s ease;
    }

    .rp2r-urgent-red {
      background: rgba(255, 80, 80, 0.78) !important;
      outline: 3px solid rgba(180, 0, 0, 0.95) !important;
      color: #111 !important;
      font-weight: 700 !important;
    }

    .rp2r-urgent-orange {
      background: rgba(255, 180, 70, 0.78) !important;
      outline: 3px solid rgba(220, 105, 0, 0.95) !important;
      color: #111 !important;
      font-weight: 700 !important;
    }

    .rp2r-missing {
      box-shadow: inset 6px 0 0 #f59e0b !important;
    }

    .rp2r-cannot {
      box-shadow: inset 6px 0 0 #dc2626 !important;
    }

    .rp2r-duplicate {
      box-shadow: inset 6px 0 0 #7c3aed !important;
    }

    .rp2r-damage {
      box-shadow: inset 6px 0 0 #991b1b !important;
    }

    .rp2r-pslip {
      box-shadow: inset 6px 0 0 #0284c7 !important;
    }

    .rp2r-rollback {
      box-shadow: inset 6px 0 0 #ea580c !important;
    }

    .rp2r-newflash {
      animation: rp2rFlash 1.2s ease 0s 2;
    }

    @keyframes rp2rFlash {
      0% { box-shadow: inset 0 0 0 9999px rgba(0,255,90,0.25); }
      100% { box-shadow: inset 0 0 0 9999px rgba(0,255,90,0); }
    }

    #rp2r-panel {
      position: fixed;
      top: 90px;
      left: 20px;
      right: auto;
      width: 490px;
      height: 650px;
      max-height: calc(100vh - 75px);
      min-width: 320px;
      min-height: 160px;
      max-width: 95vw;
      z-index: 999999;
      background: #111827;
      color: #f9fafb;
      border-radius: 14px;
      box-shadow: 0 18px 50px rgba(0,0,0,0.35);
      font-family: Arial, sans-serif;
      overflow: hidden;
      resize: both;
      border: 1px solid rgba(255,255,255,0.12);
    }

    #rp2r-panel.rp2r-collapsed {
      width: 300px !important;
      height: auto !important;
      resize: none;
    }

    #rp2r-panel.rp2r-collapsed .rp2r-body {
      display: none;
    }

    #rp2r-panel.rp2r-collapsed #rp2r-creator {
      display: none;
    }

    #rp2r-panel.rp2r-collapsed #rp2r-status {
      display: block;
    }

    .rp2r-head {
      padding: 12px 14px;
      background: linear-gradient(135deg, #232f3e, #111827);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      cursor: move;
    }

    .rp2r-title {
      font-size: 14px;
      font-weight: 800;
    }

    .rp2r-sub {
      display: block;
      margin-top: 2px;
      font-size: 11px;
      color: #a7f3d0;
      font-weight: 500;
    }

    .rp2r-status-line {
      color: #d1d5db;
      font-size: 10px;
    }

    .rp2r-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .rp2r-btn {
      border: 0;
      border-radius: 8px;
      padding: 6px 8px;
      background: #374151;
      color: #fff;
      font-size: 11px;
      cursor: pointer;
      font-weight: 700;
    }

    .rp2r-btn:hover {
      background: #4b5563;
    }

    .rp2r-btn-good {
      background: #047857 !important;
    }

    .rp2r-btn-warn {
      background: #b45309 !important;
    }

    .rp2r-btn-danger {
      background: #b91c1c !important;
    }

    .rp2r-body {
      padding: 12px;
      overflow: auto;
      height: calc(100% - 74px);
    }

    .rp2r-stats {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 7px;
      margin-bottom: 10px;
    }

    .rp2r-stat {
      background: #1f2937;
      border-radius: 10px;
      padding: 8px;
      border: 1px solid rgba(255,255,255,0.08);
      text-align: center;
    }

    .rp2r-stat b {
      display: block;
      font-size: 18px;
      line-height: 18px;
    }

    .rp2r-stat span {
      display: block;
      font-size: 10px;
      color: #d1d5db;
      margin-top: 3px;
    }

    .rp2r-filters {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 10px;
    }

    .rp2r-chip {
      border: 1px solid rgba(255,255,255,0.12);
      background: #1f2937;
      color: #fff;
      border-radius: 999px;
      padding: 5px 8px;
      font-size: 11px;
      cursor: pointer;
    }

    .rp2r-chip.active {
      background: #2563eb;
      border-color: #60a5fa;
    }

    .rp2r-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .rp2r-group {
      background: #f9fafb;
      color: #111827;
      border-radius: 13px;
      overflow: hidden;
      border-left: 8px solid #6b7280;
      box-shadow: 0 5px 18px rgba(0,0,0,0.25);
    }

    .rp2r-group.rp2r-group-red {
      border-left-color: #dc2626;
    }

    .rp2r-group.rp2r-group-orange {
      border-left-color: #f97316;
    }

    .rp2r-group-head {
      padding: 10px;
      display: flex;
      justify-content: space-between;
      gap: 8px;
      background: #eef2ff;
      border-bottom: 1px solid #dbeafe;
    }

    .rp2r-group.rp2r-group-red .rp2r-group-head {
      background: #fee2e2;
    }

    .rp2r-group.rp2r-group-orange .rp2r-group-head {
      background: #ffedd5;
    }

    .rp2r-ship {
      font-size: 13px;
      font-weight: 900;
    }

    .rp2r-floor {
      display: inline-block;
      background: #111827;
      color: #fff;
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 11px;
      margin-left: 5px;
    }

    .rp2r-time {
      text-align: right;
      font-size: 12px;
      font-weight: 900;
      white-space: nowrap;
    }

    .rp2r-time-red {
      color: #b91c1c;
    }

    .rp2r-time-orange {
      color: #c2410c;
    }

    .rp2r-group-body {
      padding: 9px 10px;
      display: flex;
      flex-direction: column;
      gap: 7px;
    }

    .rp2r-item {
      font-size: 12px;
      line-height: 1.45;
      padding: 7px;
      border-radius: 9px;
      background: #ffffff;
      border: 1px solid #e5e7eb;
    }

    .rp2r-issue {
      font-weight: 900;
    }

    .rp2r-muted {
      color: #4b5563;
      font-size: 11px;
    }

    .rp2r-copyline {
      margin-top: 6px;
      background: #eef2ff;
      border-radius: 8px;
      padding: 6px;
      font-size: 11px;
      color: #111827;
      user-select: text;
      word-break: break-word;
    }

    .rp2r-changes {
      margin-top: 12px;
      background: #0b1220;
      border-radius: 10px;
      padding: 8px;
      border: 1px solid rgba(255,255,255,0.1);
    }

    .rp2r-changes h4 {
      margin: 0 0 6px;
      font-size: 12px;
      color: #fcd34d;
    }

    .rp2r-change-item {
      font-size: 11px;
      padding: 5px 0;
      border-top: 1px solid rgba(255,255,255,0.08);
      color: #e5e7eb;
    }

    .rp2r-empty {
      text-align: center;
      color: #d1d5db;
      padding: 20px 8px;
      font-size: 13px;
    }



    #rp2r-toast {
      position: fixed;
      left: 50%;
      bottom: 28px;
      transform: translateX(-50%);
      z-index: 2147483647;
      background: #111827;
      color: #fff;
      border: 1px solid rgba(255,255,255,0.18);
      box-shadow: 0 10px 30px rgba(0,0,0,0.35);
      border-radius: 999px;
      padding: 10px 16px;
      font-size: 12px;
      font-weight: 800;
      opacity: 0;
      pointer-events: none;
      transition: opacity .2s ease, bottom .2s ease;
    }

    #rp2r-toast.rp2r-toast-show {
      opacity: 1;
      bottom: 42px;
    }

    #rp2r-warning-banner {
      display: none;
      margin-bottom: 10px;
      background: #7f1d1d;
      color: #fff;
      border: 1px solid #fecaca;
      border-radius: 10px;
      padding: 8px 10px;
      font-size: 12px;
      font-weight: 800;
      line-height: 1.35;
    }

    #rp2r-warning-banner.show {
      display: block;
    }

    .rp2r-footer-credit {
      margin-top: 10px;
      text-align: center;
      color: #9ca3af;
      font-size: 10px;
    }
  `;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /******************************************************************
   * UI
   ******************************************************************/
  const panel = document.createElement('div');
  panel.id = 'rp2r-panel';

  if (state.collapsed) {
    panel.classList.add('rp2r-collapsed');
  }

  panel.innerHTML = `
    <div class="rp2r-head">
      <div>
        <div class="rp2r-title">P2R Shipment CPT Sorter</div>
        <span class="rp2r-sub" id="rp2r-creator">Creator: Prince Jacob (Wprijaco)</span>
        <span class="rp2r-sub rp2r-status-line" id="rp2r-status">Starting...</span>
      </div>
      <div class="rp2r-actions">
        <button class="rp2r-btn rp2r-btn-good" id="rp2r-copy">Copy</button>
        <button class="rp2r-btn" id="rp2r-refresh">Scan</button>
        <button class="rp2r-btn rp2r-btn-warn" id="rp2r-pause">Pause</button>
        <button class="rp2r-btn" id="rp2r-tab-refresh">Auto Refresh OFF</button>
        <button class="rp2r-btn" id="rp2r-min">${state.collapsed ? 'Maximize' : 'Minimize'}</button>
      </div>
    </div>
    <div class="rp2r-body">
      <div id="rp2r-warning-banner"></div>
      <div class="rp2r-stats" id="rp2r-stats"></div>
      <div class="rp2r-filters" id="rp2r-filters"></div>
      <div class="rp2r-list" id="rp2r-list"></div>
      <div class="rp2r-changes">
        <h4>Live changes</h4>
        <div id="rp2r-changes-list"></div>
      </div>
      <div class="rp2r-footer-credit">Creator: Prince Jacob (Wprijaco) • Official v${SCRIPT_VERSION}</div>
    </div>
  `;

  document.body.appendChild(panel);

  const elStatus = document.getElementById('rp2r-status');
  const elStats = document.getElementById('rp2r-stats');
  const elFilters = document.getElementById('rp2r-filters');
  const elList = document.getElementById('rp2r-list');
  const elChanges = document.getElementById('rp2r-changes-list');
  const autoRefreshBtn = document.getElementById('rp2r-tab-refresh');
  const warningBanner = document.getElementById('rp2r-warning-banner');

  /******************************************************************
   * HELPERS
   ******************************************************************/
  function cleanText(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .replace(/\u00a0/g, ' ')
      .trim();
  }

  function escapeHTML(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setWarning(message) {
    state.lastWarning = message || '';
    if (!warningBanner) return;
    warningBanner.textContent = state.lastWarning;
    warningBanner.classList.toggle('show', Boolean(state.lastWarning));
  }

  function getTable() {
    return document.querySelector('table.result-table');
  }

  function buildColumnMap(table) {
    const map = {};
    const headers = Array.from(table.querySelectorAll('thead th'));

    headers.forEach((th, i) => {
      const name = cleanText(th.innerText).toLowerCase();
      if (name) map[name] = i;
    });

    return map;
  }

  function colIndex(map, names) {
    for (const name of names) {
      const key = name.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
    }
    return -1;
  }

  function getCell(cells, index) {
    if (index < 0 || index >= cells.length) return null;
    return cells[index];
  }

  function getCellText(cells, index) {
    const cell = getCell(cells, index);
    return cell ? cleanText(cell.innerText) : '';
  }

  function parseFnSkuLogin(cell) {
    if (!cell) return { fnsku: '', login: '', loginUrl: '' };

    const text = cleanText(cell.innerText);
    let fnsku = text;
    let login = '';
    let loginUrl = '';

    const fclmLink = cell.querySelector('a[href*="fclm-portal.amazon.com/employee/timeDetails"]');

    if (fclmLink) {
      login = cleanText(fclmLink.innerText);
      loginUrl = fclmLink.href;
    }

    const firstLink = cell.querySelector('a');
    if (firstLink) {
      fnsku = cleanText(firstLink.innerText);
    }

    if (!login && text.includes('/')) {
      const parts = text.split('/').map(x => cleanText(x));
      fnsku = parts[0] || fnsku;
      login = parts[1] || '';
    }

    return { fnsku, login, loginUrl };
  }

  function detectFloorFromScannable(scannableText) {
    const text = String(scannableText || '');

    if (/tspsP2R4/i.test(text)) return 'P4';
    if (/tspsP2R3/i.test(text)) return 'P3';
    if (/tspsP2R2/i.test(text)) return 'P2';

    return 'Unknown';
  }

  function parseScannable(scannableText) {
    const parts = scannableText.split('/').map(x => cleanText(x)).filter(Boolean);
    const station = parts[0] || '';

    const issueRule = ISSUE_RULES.find(rule => rule.match.test(scannableText));

    const issue = issueRule
      ? `${issueRule.emoji} ${issueRule.label}`
      : parts.slice(1).join(' / ') || 'Other';

    const location = parts
      .slice(1)
      .filter(x => !/missing|cannot create package|duplicate serial|damage|pslip|rollback/i.test(x))
      .join(' / ');

    return {
      station,
      floor: detectFloorFromScannable(scannableText),
      issue,
      issueKey: issueRule ? issueRule.key : 'other',
      issueClass: issueRule ? issueRule.className : '',
      location
    };
  }

  function parseExpectedDate(rawText) {
    const text = cleanText(rawText);
    if (!text) return null;

    let d = new Date(text);
    if (!Number.isNaN(d.getTime())) return d;

    const ukMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\s+(\d{1,2}):(\d{2})/);

    if (ukMatch) {
      const day = Number(ukMatch[1]);
      const month = Number(ukMatch[2]) - 1;
      let year = Number(ukMatch[3]);
      const hour = Number(ukMatch[4]);
      const min = Number(ukMatch[5]);

      if (year < 100) year += 2000;

      d = new Date(year, month, day, hour, min, 0, 0);
      if (!Number.isNaN(d.getTime())) return d;
    }

    return null;
  }

  function minutesUntilExpected(expectedText) {
    const expectedDate = parseExpectedDate(expectedText);
    if (!expectedDate) return null;

    return Math.round((expectedDate.getTime() - Date.now()) / 60000);
  }

  function formatMinutesLeft(minutes) {
    if (minutes === null) return '-';

    if (minutes < 0) {
      const abs = Math.abs(minutes);
      return `Late ${Math.floor(abs / 60)}h ${abs % 60}m`;
    }

    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }

  function urgencyFromMinutes(minutesLeft) {
    if (minutesLeft === null) {
      return {
        key: 'none',
        rowClass: '',
        groupClass: '',
        timeClass: '',
        label: '-'
      };
    }

    if (minutesLeft <= RED_MINUTES_LEFT) {
      return {
        key: 'red',
        rowClass: 'rp2r-urgent-red',
        groupClass: 'rp2r-group-red',
        timeClass: 'rp2r-time-red',
        label: formatMinutesLeft(minutesLeft)
      };
    }

    if (minutesLeft <= ORANGE_MINUTES_LEFT) {
      return {
        key: 'orange',
        rowClass: 'rp2r-urgent-orange',
        groupClass: 'rp2r-group-orange',
        timeClass: 'rp2r-time-orange',
        label: formatMinutesLeft(minutesLeft)
      };
    }

    return {
      key: 'normal',
      rowClass: '',
      groupClass: '',
      timeClass: '',
      label: formatMinutesLeft(minutesLeft)
    };
  }

  function dwellMinutes(dwellText) {
    const text = cleanText(dwellText).toLowerCase();

    const hrMatch = text.match(/(\d+)\s*h/);
    const minMatch = text.match(/(\d+)\s*m/);

    if (hrMatch || minMatch) {
      return (hrMatch ? Number(hrMatch[1]) * 60 : 0) + (minMatch ? Number(minMatch[1]) : 0);
    }

    const num = text.match(/\d+/);
    return num ? Number(num[0]) : 0;
  }

  function makeKey(item) {
    return [
      item.shipmentId,
      item.fnsku,
      item.station,
      item.issue,
      item.demandId
    ].join('|');
  }

  function rowCopyLine(item) {
    return [
      item.floor,
      item.shipmentId,
      item.station,
      item.issue,
      item.location,
      `Expected: ${item.expected || '-'}`,
      `Left: ${item.minutesLeft === null ? '-' : formatMinutesLeft(item.minutesLeft)}`,
      `FNSKU: ${escapeHTML(item.fnsku || '-')}`,
      `Qty: ${escapeHTML(item.qty || '-')}`,
      `Dwell: ${escapeHTML(item.dwell || '-')}`
    ].join(' | ');
  }

  function groupCopyLine(group) {
    const head = [
      `SHIPMENT: ${group.shipmentId}`,
      `Floor: ${escapeHTML(group.floor)}`,
      `Expected: ${escapeHTML(group.expected || '-')}`,
      `Left: ${group.minutesLeft === null ? '-' : formatMinutesLeft(group.minutesLeft)}`
    ].join(' | ');

    const rows = group.items.map(item => `  - ${escapeHTML(rowCopyLine(item))}`).join('\n');

    return `${head}\n${rows}`;
  }

  function copyText(text) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text);
      return;
    }

    navigator.clipboard.writeText(text);
  }

  function showToast(message) {
    let toast = document.getElementById('rp2r-toast');

    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'rp2r-toast';
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add('rp2r-toast-show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('rp2r-toast-show'), 2400);
  }

  /******************************************************************
   * DATA CAPTURE
   ******************************************************************/
  function getVisibleProblemRows() {
    const table = getTable();

    if (!table) {
      elStatus.textContent = 'No result table found';
      return [];
    }

    const map = buildColumnMap(table);

    const idx = {
      shipment: colIndex(map, ['Shipment ID']),
      fnsku: colIndex(map, ['FN SKU']),
      title: colIndex(map, ['Title']),
      expected: colIndex(map, ['Expected Ship Date']),
      scannable: colIndex(map, ['Scannable ID']),
      outer: colIndex(map, ['Outer Scannable ID']),
      process: colIndex(map, ['Process Path']),
      demand: colIndex(map, ['Demand ID']),
      qty: colIndex(map, ['Quantity']),
      workpool: colIndex(map, ['Work Pool']),
      dwell: colIndex(map, ['Dwell Time'])
    };

    const requiredColumns = [
      ['Shipment ID', idx.shipment],
      ['FN SKU', idx.fnsku],
      ['Expected Ship Date', idx.expected],
      ['Scannable ID', idx.scannable],
      ['Work Pool', idx.workpool]
    ];

    const missingColumns = requiredColumns.filter(([, index]) => index < 0).map(([name]) => name);

    if (missingColumns.length) {
      setWarning(`Missing Rodeo columns: ${missingColumns.join(', ')}. Add them in Rodeo enabled columns, then rescan.`);
      elStatus.textContent = 'Missing required column(s)';
      return [];
    }

    setWarning('');

    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const items = [];

    rows.forEach(row => {
      row.classList.remove(
        'rp2r-row',
        'rp2r-missing',
        'rp2r-cannot',
        'rp2r-duplicate',
        'rp2r-damage',
        'rp2r-pslip',
        'rp2r-rollback',
        'rp2r-newflash',
        'rp2r-urgent-red',
        'rp2r-urgent-orange'
      );

      const cells = Array.from(row.children);
      if (!cells.length) return;

      const scannableText = getCellText(cells, idx.scannable);
      const workPool = getCellText(cells, idx.workpool);

      const isProblem =
        /ProblemSolving/i.test(workPool) ||
        /missing|cannot create package|duplicate serial|damage|pslip|rollback/i.test(scannableText);

      if (!isProblem) return;

      const fn = parseFnSkuLogin(getCell(cells, idx.fnsku));
      const sc = parseScannable(scannableText);
      const expected = getCellText(cells, idx.expected);
      const minutesLeft = minutesUntilExpected(expected);
      const urgency = urgencyFromMinutes(minutesLeft);

      const item = {
        row,
        shipmentId: getCellText(cells, idx.shipment) || 'NO SHIPMENT ID',
        fnsku: fn.fnsku,
        login: fn.login,
        loginUrl: fn.loginUrl,
        title: getCellText(cells, idx.title),
        expected,
        minutesLeft,
        urgency,
        scannableText,
        station: sc.station,
        floor: sc.floor,
        outer: getCellText(cells, idx.outer),
        issue: sc.issue,
        issueKey: sc.issueKey,
        issueClass: sc.issueClass,
        location: sc.location,
        process: getCellText(cells, idx.process),
        demandId: getCellText(cells, idx.demand),
        qty: getCellText(cells, idx.qty),
        workPool,
        dwell: getCellText(cells, idx.dwell),
        dwellMins: dwellMinutes(getCellText(cells, idx.dwell))
      };

      item.key = makeKey(item);

      row.classList.add('rp2r-row');

      if (item.issueClass) row.classList.add(item.issueClass);
      if (item.urgency.rowClass) row.classList.add(item.urgency.rowClass);

      items.push(item);
    });

    return items;
  }

  function buildGroups(items) {
    const groupMap = new Map();

    for (const item of items) {
      const key = item.shipmentId || 'NO SHIPMENT ID';

      if (!groupMap.has(key)) {
        groupMap.set(key, {
          shipmentId: key,
          items: [],
          floorSet: new Set(),
          expected: item.expected,
          minutesLeft: item.minutesLeft,
          urgency: item.urgency
        });
      }

      const group = groupMap.get(key);

      group.items.push(item);
      group.floorSet.add(item.floor);

      if (
        item.minutesLeft !== null &&
        (group.minutesLeft === null || item.minutesLeft < group.minutesLeft)
      ) {
        group.expected = item.expected;
        group.minutesLeft = item.minutesLeft;
        group.urgency = item.urgency;
      }
    }

    const groups = Array.from(groupMap.values()).map(group => {
      group.floor = Array.from(group.floorSet).filter(Boolean).join(', ') || 'Unknown';
      group.items.sort((a, b) => b.dwellMins - a.dwellMins);
      return group;
    });

    groups.sort((a, b) => {
      const am = a.minutesLeft === null ? 999999 : a.minutesLeft;
      const bm = b.minutesLeft === null ? 999999 : b.minutesLeft;
      return am - bm;
    });

    return groups;
  }

  /******************************************************************
   * CHANGE DETECTION
   ******************************************************************/
  function addChange(type, item, extra = '') {
    const time = new Date().toLocaleTimeString();

    state.changes.unshift({
      time,
      text: `${type}: ${item.floor} | ${item.shipmentId} | ${item.station || '-'} | ${escapeHTML(item.issue)} | ${escapeHTML(item.fnsku || '-')} ${extra}`
    });

    state.changes = state.changes.slice(0, MAX_CHANGE_LOG);
  }

  function detectChanges(items) {
    const nowMap = new Map(items.map(item => [item.key, item]));

    for (const item of items) {
      const old = state.previous.get(item.key);

      if (!old) {
        addChange('NEW', item);
        item.row.classList.add('rp2r-newflash');
      } else {
        const oldSig = `${old.dwell}|${old.workPool}|${old.qty}|${old.outer}|${old.expected}|${old.floor}`;
        const newSig = `${item.dwell}|${item.workPool}|${item.qty}|${item.outer}|${item.expected}|${item.floor}`;

        if (oldSig !== newSig) {
          addChange('UPDATED', item, `(${old.dwell || '-'} → ${escapeHTML(item.dwell || '-')})`);
          item.row.classList.add('rp2r-newflash');
        }
      }
    }

    for (const [key, oldItem] of state.previous.entries()) {
      if (!nowMap.has(key)) {
        addChange('CLEARED', oldItem);
      }
    }

    state.previous = nowMap;
  }

  /******************************************************************
   * RENDER
   ******************************************************************/
  function renderStats(groups) {
    const p2 = groups.filter(g => /\bP2\b/.test(g.floor)).length;
    const p3 = groups.filter(g => /\bP3\b/.test(g.floor)).length;
    const p4 = groups.filter(g => /\bP4\b/.test(g.floor)).length;
    const red = groups.filter(g => g.urgency.key === 'red').length;

    elStats.innerHTML = `
      <div class="rp2r-stat"><b>${groups.length}</b><span>Shipments</span></div>
      <div class="rp2r-stat"><b>${p2}</b><span>P2</span></div>
      <div class="rp2r-stat"><b>${p3}</b><span>P3</span></div>
      <div class="rp2r-stat"><b>${p4}</b><span>P4</span></div>
      <div class="rp2r-stat"><b>${red}</b><span>Red</span></div>
    `;
  }

  function renderFilters(groups) {
    const counts = {
      all: groups.length,
      P2: groups.filter(g => /\bP2\b/.test(g.floor)).length,
      P3: groups.filter(g => /\bP3\b/.test(g.floor)).length,
      P4: groups.filter(g => /\bP4\b/.test(g.floor)).length,
      red: groups.filter(g => g.urgency.key === 'red').length,
      orange: groups.filter(g => g.urgency.key === 'orange').length
    };

    const chips = [
      { key: 'all', label: `All ${counts.all}` },
      { key: 'P2', label: `P2 ${counts.P2}` },
      { key: 'P3', label: `P3 ${counts.P3}` },
      { key: 'P4', label: `P4 ${counts.P4}` },
      { key: 'red', label: `🔴 ≤1h10 ${counts.red}` },
      { key: 'orange', label: `🟠 ≤1h30 ${counts.orange}` }
    ];

    elFilters.innerHTML = chips.map(chip => `
      <button class="rp2r-chip ${state.filter === chip.key ? 'active' : ''}" data-filter="${chip.key}">
        ${chip.label}
      </button>
    `).join('');

    elFilters.querySelectorAll('.rp2r-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        state.filter = btn.dataset.filter;
        render();
      });
    });
  }

  function getFilteredGroups() {
    const groups = state.groups;

    if (state.filter === 'all') return groups;

    if (['P2', 'P3', 'P4'].includes(state.filter)) {
      return groups.filter(group => group.floor.includes(state.filter));
    }

    if (state.filter === 'red') {
      return groups.filter(group => group.urgency.key === 'red');
    }

    if (state.filter === 'orange') {
      return groups.filter(group => group.urgency.key === 'orange');
    }

    return groups;
  }

  function renderList() {
    const groups = getFilteredGroups();

    if (!groups.length) {
      elList.innerHTML = `<div class="rp2r-empty">No shipment groups for this filter.</div>`;
      return;
    }

    elList.innerHTML = groups.map(group => {
      const groupUrgencyClass = group.urgency.groupClass || '';
      const timeClass = group.urgency.timeClass || '';

      const itemsHtml = group.items.map(item => {
        return `
          <div class="rp2r-item">
            <div>
              <span class="rp2r-issue">${escapeHTML(item.issue)}</span>
              ${item.station ? `<span class="rp2r-muted"> / ${escapeHTML(item.station)}</span>` : ''}
              ${item.location ? `<span class="rp2r-muted"> / ${escapeHTML(item.location)}</span>` : ''}
            </div>
            <div>
              FNSKU: <b>${escapeHTML(item.fnsku || '-')}</b> &nbsp; Qty: <b>${escapeHTML(item.qty || '-')}</b>
              <br>
              <span class="rp2r-muted">${escapeHTML(item.title || '')}</span>
              <br>
              <span class="rp2r-muted">Dwell: ${escapeHTML(item.dwell || '-')}</span>
            </div>
            <div class="rp2r-copyline">${escapeHTML(rowCopyLine(item))}</div>
          </div>
        `;
      }).join('');

      return `
        <div class="rp2r-group ${groupUrgencyClass}">
          <div class="rp2r-group-head">
            <div>
              <div class="rp2r-ship">Shipment: ${escapeHTML(group.shipmentId)}</div>
              <div class="rp2r-muted">
                Floor <span class="rp2r-floor">${escapeHTML(group.floor)}</span>
              </div>
            </div>
            <div class="rp2r-time ${timeClass}">
              ${group.urgency.key === 'red' ? '🔴 ' : ''}
              ${group.urgency.key === 'orange' ? '🟠 ' : ''}
              ${escapeHTML(group.urgency.label)}
              <br>
              <span class="rp2r-muted">${escapeHTML(group.expected || '-')}</span>
            </div>
          </div>
          <div class="rp2r-group-body">
            ${itemsHtml}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderChanges() {
    if (!state.changes.length) {
      elChanges.innerHTML = `<div class="rp2r-change-item">No changes detected yet.</div>`;
      return;
    }

    elChanges.innerHTML = state.changes.map(ch => `
      <div class="rp2r-change-item"><b>${escapeHTML(ch.time)}</b> — ${escapeHTML(ch.text)}</div>
    `).join('');
  }

  function render() {
    renderStats(state.groups);
    renderFilters(state.groups);
    renderList();
    renderChanges();

    const red = state.groups.filter(g => g.urgency.key === 'red').length;
    const orange = state.groups.filter(g => g.urgency.key === 'orange').length;

    elStatus.textContent =
      `${state.groups.length} shipments | 🔴 ${red} | 🟠 ${orange} | ${new Date().toLocaleTimeString()}${state.paused ? ' | Paused' : ''}`;
  }

  function scan() {
    if (state.paused || state.scanRunning) return;

    const now = Date.now();
    if (now - state.lastScanStarted < SCAN_DEBOUNCE_MS) return;

    state.scanRunning = true;
    state.lastScanStarted = now;

    try {
      const rows = getVisibleProblemRows();
      const groups = buildGroups(rows);

      state.currentRows = rows;
      state.groups = groups;

      detectChanges(rows);
      render();
    } catch (err) {
      console.error('[P2R CPT Sorter] Scan failed:', err);
      setWarning(`Scan error: ${err && err.message ? err.message : err}`);
      elStatus.textContent = 'Scan error — check console';
    } finally {
      state.scanRunning = false;
    }
  }

  /******************************************************************
   * DRAGGABLE DASHBOARD
   ******************************************************************/
  function makeDashboardDraggable() {
    const header = panel.querySelector('.rp2r-head');

    const savedLeft = localStorage.getItem('rp2rPanelLeft');
    const savedTop = localStorage.getItem('rp2rPanelTop');

    if (savedLeft && savedTop) {
      panel.style.left = savedLeft;
      panel.style.top = savedTop;
      panel.style.right = 'auto';
    }

    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    header.addEventListener('mousedown', e => {
      if (e.target.closest('button')) return;

      dragging = true;

      const rect = panel.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;

      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', e => {
      if (!dragging) return;

      let left = e.clientX - offsetX;
      let top = e.clientY - offsetY;

      left = Math.max(0, Math.min(left, window.innerWidth - panel.offsetWidth));
      top = Math.max(0, Math.min(top, window.innerHeight - 50));

      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;

      dragging = false;
      document.body.style.userSelect = '';

      localStorage.setItem('rp2rPanelLeft', panel.style.left);
      localStorage.setItem('rp2rPanelTop', panel.style.top);
    });
  }

  /******************************************************************
   * RESIZABLE DASHBOARD MEMORY
   ******************************************************************/
  function restoreDashboardSize() {
    if (state.collapsed) return;

    const savedWidth = localStorage.getItem('rp2rPanelWidth');
    const savedHeight = localStorage.getItem('rp2rPanelHeight');

    if (savedWidth) panel.style.width = savedWidth;
    if (savedHeight) panel.style.height = savedHeight;
  }

  function rememberDashboardSize() {
    let lastWidth = panel.offsetWidth;
    let lastHeight = panel.offsetHeight;

    setInterval(() => {
      if (state.collapsed) return;

      if (panel.offsetWidth !== lastWidth || panel.offsetHeight !== lastHeight) {
        lastWidth = panel.offsetWidth;
        lastHeight = panel.offsetHeight;

        localStorage.setItem('rp2rPanelWidth', `${lastWidth}px`);
        localStorage.setItem('rp2rPanelHeight', `${lastHeight}px`);
      }
    }, 1000);
  }

  /******************************************************************
   * AUTO TAB REFRESH
   ******************************************************************/
  function startTabAutoRefresh() {
    if (state.tabRefreshTimer) clearInterval(state.tabRefreshTimer);

    state.tabRefreshTimer = setInterval(() => {
      location.reload();
    }, TAB_REFRESH_INTERVAL_MS);
  }

  function stopTabAutoRefresh() {
    if (state.tabRefreshTimer) {
      clearInterval(state.tabRefreshTimer);
      state.tabRefreshTimer = null;
    }
  }

  function updateAutoRefreshButton() {
    if (state.autoTabRefresh) {
      autoRefreshBtn.textContent = 'Auto Refresh ON';
      autoRefreshBtn.classList.add('rp2r-btn-good');
      autoRefreshBtn.classList.remove('rp2r-btn-danger');
      startTabAutoRefresh();
    } else {
      autoRefreshBtn.textContent = 'Auto Refresh OFF';
      autoRefreshBtn.classList.remove('rp2r-btn-good');
      autoRefreshBtn.classList.add('rp2r-btn-danger');
      stopTabAutoRefresh();
    }
  }

  /******************************************************************
   * BUTTONS
   ******************************************************************/
  document.getElementById('rp2r-copy').addEventListener('click', () => {
    const groups = getFilteredGroups();
    const text = groups.map(groupCopyLine).join('\n\n');

    copyText(text || 'No shipment groups to copy');
    elStatus.textContent = `Copied ${groups.length} shipment group(s)`;
    showToast(`Copied ${groups.length} shipment group(s)`);
  });

  document.getElementById('rp2r-refresh').addEventListener('click', () => {
    scan();
    showToast('Scan complete');
  });

  document.getElementById('rp2r-pause').addEventListener('click', e => {
    state.paused = !state.paused;
    e.target.textContent = state.paused ? 'Resume' : 'Pause';
    showToast(state.paused ? 'Dashboard paused' : 'Dashboard resumed');
    render();
  });

  autoRefreshBtn.addEventListener('click', () => {
    state.autoTabRefresh = !state.autoTabRefresh;
    localStorage.setItem('rp2rAutoTabRefresh', String(state.autoTabRefresh));

    updateAutoRefreshButton();

    elStatus.textContent = state.autoTabRefresh
      ? 'Auto tab refresh ON — refreshing every 15 seconds'
      : 'Auto tab refresh OFF';

    showToast(state.autoTabRefresh ? 'Auto refresh ON' : 'Auto refresh OFF');
  });

  document.getElementById('rp2r-min').addEventListener('click', e => {
    state.collapsed = !state.collapsed;

    panel.classList.toggle('rp2r-collapsed', state.collapsed);
    localStorage.setItem('rp2rDashboardCollapsed', String(state.collapsed));

    e.target.textContent = state.collapsed ? 'Maximize' : 'Minimize';

    if (!state.collapsed) {
      restoreDashboardSize();
    }

    render();
    showToast(state.collapsed ? 'Dashboard minimized' : 'Dashboard maximized');
  });

  /******************************************************************
   * LIVE WATCH
   ******************************************************************/
  let mutationTimer = null;

  const observer = new MutationObserver(() => {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(scan, SCAN_DEBOUNCE_MS);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });

  restoreDashboardSize();
  rememberDashboardSize();
  makeDashboardDraggable();
  scan();
  setInterval(scan, CHECK_INTERVAL_MS);
  updateAutoRefreshButton();
  console.log(`[P2R CPT Sorter] ${OFFICIAL_SCRIPT_MARKER} loaded v${SCRIPT_VERSION}`);

})();
