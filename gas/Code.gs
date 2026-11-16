/**
 * 金匠鍋貼｜線上訂單後端（Google Apps Script，綁定在「訂單」試算表上）
 *
 * 功能：
 *  1. doPost：接收網站結帳 → 驗證 → 以「菜單」分頁重算金額 → 產生訂單編號 → 寫入試算表 → 寄通知信
 *  2. onSheetEdit：在「訂單」分頁修改「狀態」→ 自動寄信通知顧客
 *  3. dailySummary：每天固定時間寄當日營業摘要給店家
 *  4. setup：一鍵建立分頁、欄位、下拉選單、菜單與觸發器（只需執行一次）
 *
 * 部署方式請看 docs/google-sheets-setup.md
 */

const SHEET = { ORDERS: '訂單', ITEMS: '訂單明細', MENU: '菜單', CONFIG: '設定' };
const TZ = 'Asia/Taipei';
const STATUS = ['新訂單', '製作中', '可取餐', '已出貨', '已完成', '已取消'];
const NOTIFY_ON = ['可取餐', '已出貨', '已完成', '已取消'];   // 改成這些狀態時會寄信給顧客
const MODES = { dine: '內用', take: '外帶', ship: '宅配' };
const STORES = { flag: '旗艦店', xinyi: '信義店', nangang: '南港店' };

const ORDER_HEAD = ['訂單編號', '建立時間', '狀態', '取餐方式', '門市', '姓名', '電話', 'Email', '地址', '備註', '品項摘要', '小計', '運費', '合計', '通知紀錄'];
const ITEM_HEAD = ['訂單編號', '品項ID', '品名', '規格', '單價', '數量', '小計'];
const MENU_HEAD = ['ID', '分類', '名稱', '規格', '單價', '供應中'];
const C = { NO: 1, TIME: 2, STATUS: 3, MODE: 4, STORE: 5, NAME: 6, PHONE: 7, EMAIL: 8, ADDR: 9, NOTE: 10, SUMMARY: 11, SUB: 12, FEE: 13, TOTAL: 14, LOG: 15 };

const CONFIG_DEFAULTS = [
  ['店名', '金匠鍋貼'],
  ['通知信箱', ''],            // 留空 = 寄給部署者自己；多個信箱以逗號分隔
  ['運費', 100],
  ['免運門檻', 1200],
  ['單筆金額上限', 30000],
  ['每支電話10分鐘內最多訂單數', 5],
  ['每日摘要時間(時)', 21]
];

// 初次建立「菜單」分頁時的預設資料（之後請直接在試算表修改，不用再動這裡）
const MENU_SEED = [
  ["s1", "招牌鍋貼", "招牌豬肉鍋貼", "6 顆", 75],
  ["s2", "招牌鍋貼", "韭黃鮮蝦鍋貼", "6 顆", 95],
  ["s3", "招牌鍋貼", "泡菜起司鍋貼", "6 顆", 90],
  ["s4", "招牌鍋貼", "玉米豬肉鍋貼", "6 顆", 80],
  ["d1", "精選水餃", "高麗菜豬肉水餃", "8 顆", 70],
  ["d2", "精選水餃", "韭菜豬肉水餃", "8 顆", 70],
  ["d3", "精選水餃", "紅油抄手", "8 顆", 85],
  ["d4", "精選水餃", "香菇素水餃", "8 顆", 70],
  ["t1", "湯品／飲料", "酸辣湯", "1 碗", 55],
  ["t2", "湯品／飲料", "玉米濃湯", "1 碗", 45],
  ["t3", "湯品／飲料", "手作冬瓜檸檬", "500ml", 50],
  ["t4", "湯品／飲料", "凍頂烏龍冷泡茶", "500ml", 45],
  ["k1", "經典小菜", "涼拌小黃瓜", "1 份", 45],
  ["k2", "經典小菜", "滷味拼盤", "1 份", 75],
  ["k3", "經典小菜", "酥炸脆皮豆腐", "1 份", 55],
  ["k4", "經典小菜", "蔥油拌麵", "1 份", 50],
  ["g1", "冷凍禮盒", "招財鍋貼禮盒", "50 入", 690],
  ["g2", "冷凍禮盒", "雙響炮綜合禮盒", "60 入", 880],
  ["g3", "冷凍禮盒", "年節福氣禮盒", "100 入", 1380]
];

/* ====================================================================
 *  網站呼叫入口
 * ==================================================================== */

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    return json_(handleOrder_(body));
  } catch (err) {
    if (err && err.user) return json_({ ok: false, error: err.message });
    console.error(err && err.stack || err);
    return json_({ ok: false, error: '系統忙碌中，請稍後再試，或直接來電訂購。' });
  }
}

function doGet() {
  return json_({ ok: true, service: 'jinjiang-orders' });   // 用瀏覽器開網址時，看到這行代表部署成功
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(msg) { const e = new Error(msg); e.user = true; throw e; }

/* ====================================================================
 *  訂單處理
 * ==================================================================== */

function handleOrder_(b) {
  if (b.hp) return { ok: true, orderNo: 'JJ-OK' };                      // 蜜罐欄位被填 = 機器人，靜默忽略

  const cache = CacheService.getScriptCache();
  const reqId = String(b.requestId || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(reqId)) fail_('訂單資料不完整，請重新整理頁面再試。');
  const dup = cache.get('req:' + reqId);
  if (dup) return JSON.parse(dup);                                      // 重複送出（連點、網路重試）→ 回傳同一張訂單

  const cfg = getConfig_();
  const mode = String(b.mode || '');
  if (!MODES[mode]) fail_('請選擇取餐方式。');
  const name = clean_(b.name, 30);
  const phone = String(b.phone || '').replace(/[\s-]/g, '');
  const email = clean_(b.email, 100);
  const addr = clean_(b.addr, 120);
  const note = clean_(b.note, 200);
  const storeId = String(b.storeId || '');
  if (!name) fail_('請填寫姓名。');
  if (!/^(09\d{8}|0\d{8,9})$/.test(phone)) fail_('請填寫正確的聯絡電話。');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail_('Email 格式不正確。');
  if (mode === 'ship' && !addr) fail_('宅配請填寫收件地址。');
  if (mode !== 'ship' && !STORES[storeId]) fail_('請選擇門市。');

  const lines = normalizeItems_(b.items);

  // 同一支電話短時間內下太多張單 → 擋下
  const rlKey = 'rl:' + phone;
  const used = Number(cache.get(rlKey) || 0);
  if (used >= Number(cfg['每支電話10分鐘內最多訂單數'])) fail_('訂單送出太頻繁，請稍後再試，或來電訂購。');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let result, orderRow, itemRows;
  try {
    const menu = readMenu_();
    itemRows = [];
    let subtotal = 0;
    const parts = [];
    lines.forEach(function (l) {
      const m = menu[l.id];
      if (!m) fail_('有餐點已下架，請重新整理頁面後再點餐。');
      if (!m.available) fail_('「' + m.name + '」目前暫停供應，請從購物車移除後再送出。');
      const lineTotal = m.price * l.qty;
      subtotal += lineTotal;
      parts.push(m.name + ' ×' + l.qty);
      itemRows.push([null, l.id, m.name, m.spec, m.price, l.qty, lineTotal]);
    });
    const fee = (mode === 'ship' && subtotal < Number(cfg['免運門檻'])) ? Number(cfg['運費']) : 0;
    const total = subtotal + fee;
    if (total > Number(cfg['單筆金額上限'])) fail_('單筆金額過高，請來電洽詢。');

    const orderNo = nextOrderNo_();
    itemRows.forEach(function (r) { r[0] = orderNo; });
    orderRow = [orderNo, now_(), STATUS[0], MODES[mode], mode === 'ship' ? '' : STORES[storeId],
      safe_(name), phone, safe_(email), safe_(addr), safe_(note), parts.join('、'), subtotal, fee, total, ''];

    append_(SHEET.ORDERS, [orderRow]);
    append_(SHEET.ITEMS, itemRows);

    result = {
      ok: true, orderNo: orderNo, mode: mode, modeName: MODES[mode], storeName: mode === 'ship' ? '' : STORES[storeId],
      subtotal: subtotal, fee: fee, total: total
    };
  } finally {
    lock.releaseLock();
  }

  cache.put('req:' + reqId, JSON.stringify(result), 600);
  cache.put(rlKey, String(used + 1), 600);

  try { sendNewOrderMails_(cfg, orderRow, itemRows); } catch (err) { console.error('寄信失敗：' + err); }
  return result;
}

function normalizeItems_(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 30) fail_('購物車是空的。');
  const merged = {};
  items.forEach(function (it) {
    const id = String(it && it.id || '');
    const qty = Number(it && it.qty);
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(id) || !Number.isInteger(qty) || qty < 1 || qty > 99) fail_('購物車內容有誤，請重新加入餐點。');
    merged[id] = (merged[id] || 0) + qty;
  });
  return Object.keys(merged).map(function (id) { return { id: id, qty: Math.min(merged[id], 99) }; });
}

function nextOrderNo_() {
  const ymd = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd');
  const props = PropertiesService.getScriptProperties();
  const key = 'seq:' + ymd;
  const n = Number(props.getProperty(key) || 0) + 1;
  props.setProperty(key, String(n));
  return 'JJ' + ymd + '-' + String(n).padStart(3, '0');
}

function readMenu_() {
  const rows = sheet_(SHEET.MENU).getDataRange().getValues();
  const menu = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const id = String(r[0]).trim();
    if (!id) continue;
    menu[id] = { name: String(r[2]), spec: String(r[3]), price: Number(r[4]), available: r[5] === true || String(r[5]).toUpperCase() === 'TRUE' };
  }
  return menu;
}

function getConfig_() {
  const cfg = {};
  CONFIG_DEFAULTS.forEach(function (kv) { cfg[kv[0]] = kv[1]; });
  const s = SpreadsheetApp.getActive().getSheetByName(SHEET.CONFIG);
  if (s) s.getDataRange().getValues().forEach(function (r) { if (r[0] !== '' && r[1] !== '') cfg[String(r[0]).trim()] = r[1]; });
  return cfg;
}

function sheet_(name) {
  const s = SpreadsheetApp.getActive().getSheetByName(name);
  if (!s) throw new Error('找不到分頁「' + name + '」，請先執行 setup()。');
  return s;
}

function append_(name, rows) {
  if (!rows.length) return;
  const s = sheet_(name);
  s.getRange(s.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

const now_ = function () { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); };
const clean_ = function (v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max); };
// 避免顧客輸入 =、+、-、@ 開頭的文字被試算表當成公式執行
const safe_ = function (s) { return /^[=+\-@]/.test(s) ? ' ' + s : s; };
const esc_ = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
const money_ = function (n) { return 'NT$' + Number(n).toLocaleString('en-US'); };

/* ====================================================================
 *  通知信
 * ==================================================================== */

function notifyList_(cfg) {
  const raw = String(cfg['通知信箱'] || '').trim();
  return raw || Session.getEffectiveUser().getEmail();
}

function sendNewOrderMails_(cfg, o, items) {
  const shop = cfg['店名'];
  const where = o[C.MODE - 1] === '宅配' ? '宅配至：' + o[C.ADDR - 1] : (o[C.MODE - 1] + '｜' + o[C.STORE - 1]);
  const rows = items.map(function (r) { return '<tr><td>' + esc_(r[2]) + '</td><td align="right">×' + r[5] + '</td><td align="right">' + money_(r[6]) + '</td></tr>'; }).join('');
  const table = '<table cellpadding="4" style="border-collapse:collapse">' + rows +
    '<tr><td colspan="2" align="right">運費</td><td align="right">' + (o[C.FEE - 1] ? money_(o[C.FEE - 1]) : '—') + '</td></tr>' +
    '<tr><td colspan="2" align="right"><b>合計</b></td><td align="right"><b>' + money_(o[C.TOTAL - 1]) + '</b></td></tr></table>';

  MailApp.sendEmail({
    to: notifyList_(cfg),
    subject: '【' + shop + '】新訂單 ' + o[0] + '｜' + o[C.MODE - 1] + '｜' + money_(o[C.TOTAL - 1]),
    htmlBody: '<p><b>' + esc_(o[0]) + '</b>（' + esc_(o[C.MODE - 1]) + '）</p>' +
      '<p>' + esc_(where) + '<br>顧客：' + esc_(o[C.NAME - 1]) + '　電話：' + esc_(o[C.PHONE - 1]) + '<br>備註：' + esc_(o[C.NOTE - 1] || '無') + '</p>' + table
  });

  const email = o[C.EMAIL - 1];
  if (email) {
    MailApp.sendEmail({
      to: email, name: shop,
      subject: '【' + shop + '】訂單 ' + o[0] + ' 已收到',
      htmlBody: '<p>' + esc_(o[C.NAME - 1]) + ' 您好，我們已收到您的訂單，謝謝您！</p><p>訂單編號：<b>' + esc_(o[0]) + '</b><br>' + esc_(where) + '</p>' + table +
        '<p>店家確認後會再通知您。如需更改請來電聯繫。</p>'
    });
  }
}

/** 在「訂單」分頁把「狀態」改成可取餐／已出貨／已完成／已取消時，自動寄信給顧客（需已建立觸發器，setup() 會處理） */
function onSheetEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (sh.getName() !== SHEET.ORDERS || e.range.getColumn() !== C.STATUS || e.range.getRow() < 2 || e.range.getNumRows() !== 1) return;
  const status = String(e.range.getValue());
  if (NOTIFY_ON.indexOf(status) < 0) return;

  const row = sh.getRange(e.range.getRow(), 1, 1, ORDER_HEAD.length).getValues()[0];
  const email = String(row[C.EMAIL - 1] || '').trim();
  const logCell = sh.getRange(e.range.getRow(), C.LOG);
  if (!email) { logCell.setValue(now_() + ' 「' + status + '」未通知（顧客沒留 Email）'); return; }

  const cfg = getConfig_(), shop = cfg['店名'], isShip = row[C.MODE - 1] === '宅配';
  const msg = {
    '可取餐': '您的餐點已經準備好了，歡迎到「' + row[C.STORE - 1] + '」取餐。',
    '已出貨': '您的訂單已經出貨，預計 2–3 個工作天送達，請留意收貨。',
    '已完成': '感謝您的惠顧，期待再次為您服務！',
    '已取消': '很抱歉，您的訂單已被取消。如有疑問請來電聯繫' + (isShip ? '' : '「' + row[C.STORE - 1] + '」') + '。'
  }[status];
  MailApp.sendEmail({
    to: email, name: shop,
    subject: '【' + shop + '】訂單 ' + row[0] + '：' + status,
    htmlBody: '<p>' + esc_(row[C.NAME - 1]) + ' 您好，</p><p>' + esc_(msg) + '</p><p>訂單編號：' + esc_(row[0]) + '<br>' + esc_(row[C.SUMMARY - 1]) + '<br>合計：' + money_(row[C.TOTAL - 1]) + '</p>'
  });
  logCell.setValue(now_() + ' 已寄「' + status + '」通知');
}

/** 每日營業摘要（setup() 會設定每天固定時間執行） */
function dailySummary() {
  const cfg = getConfig_();
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const s = sheet_(SHEET.ORDERS);
  const last = s.getLastRow();
  if (last < 2) return;
  const rows = s.getRange(2, 1, last - 1, ORDER_HEAD.length).getValues()
    .filter(function (r) { return String(r[C.TIME - 1]).slice(0, 10) === today; });
  if (!rows.length) return;
  const ok = rows.filter(function (r) { return r[C.STATUS - 1] !== '已取消'; });
  const sum = function (a) { return a.reduce(function (t, r) { return t + Number(r[C.TOTAL - 1]); }, 0); };
  const byMode = {};
  ok.forEach(function (r) { const k = r[C.MODE - 1]; byMode[k] = byMode[k] || { n: 0, t: 0 }; byMode[k].n++; byMode[k].t += Number(r[C.TOTAL - 1]); });
  const open = ok.filter(function (r) { return r[C.STATUS - 1] === '新訂單' || r[C.STATUS - 1] === '製作中'; }).length;

  MailApp.sendEmail({
    to: notifyList_(cfg),
    subject: '【' + cfg['店名'] + '】' + today + ' 營業摘要：' + ok.length + ' 筆／' + money_(sum(ok)),
    htmlBody: '<p>有效訂單 <b>' + ok.length + '</b> 筆，營業額 <b>' + money_(sum(ok)) + '</b>（已取消 ' + (rows.length - ok.length) + ' 筆未計入）</p>' +
      '<ul>' + Object.keys(byMode).map(function (k) { return '<li>' + esc_(k) + '：' + byMode[k].n + ' 筆／' + money_(byMode[k].t) + '</li>'; }).join('') + '</ul>' +
      (open ? '<p>⚠ 仍有 ' + open + ' 筆狀態為「新訂單／製作中」，請確認是否已處理。</p>' : '')
  });
}

/* ====================================================================
 *  一次性設定：在 Apps Script 編輯器選 setup 並按「執行」
 * ==================================================================== */

function setup() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ);

  const orders = ensureSheet_(ss, SHEET.ORDERS, ORDER_HEAD);
  const items = ensureSheet_(ss, SHEET.ITEMS, ITEM_HEAD);
  const menu = ensureSheet_(ss, SHEET.MENU, MENU_HEAD);
  const cfg = ensureSheet_(ss, SHEET.CONFIG, ['項目', '值']);

  if (menu.getLastRow() < 2) {
    menu.getRange(2, 1, MENU_SEED.length, 5).setValues(MENU_SEED);
    menu.getRange(2, 6, MENU_SEED.length, 1).insertCheckboxes().setValue(true);
  }
  if (cfg.getLastRow() < 2) cfg.getRange(2, 1, CONFIG_DEFAULTS.length, 2).setValues(CONFIG_DEFAULTS);

  // 先把分頁擴充到足夠列數（新分頁預設只有 1000 列），再設定格式
  growRows_(orders, 5000); growRows_(items, 20000);
  const oRows = orders.getMaxRows() - 1, iRows = items.getMaxRows() - 1;

  // 訂單分頁：文字欄位一律當純文字（電話開頭的 0 才不會消失，也不會被當公式）
  [C.NO, C.TIME, C.MODE, C.STORE, C.NAME, C.PHONE, C.EMAIL, C.ADDR, C.NOTE, C.SUMMARY, C.LOG].forEach(function (c) { orders.getRange(2, c, oRows, 1).setNumberFormat('@'); });
  orders.getRange(2, C.STATUS, oRows, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUS, true).setAllowInvalid(false).build());
  items.getRange(2, 1, iRows, 2).setNumberFormat('@');

  const rules = [['新訂單', '#fde7d3'], ['製作中', '#fff3bf'], ['可取餐', '#d3f0dc'], ['已出貨', '#d3f0dc'], ['已完成', '#e5e5e5'], ['已取消', '#f6d4d4']].map(function (p) {
    return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(p[0]).setBackground(p[1]).setRanges([orders.getRange(2, C.STATUS, oRows, 1)]).build();
  });
  orders.setConditionalFormatRules(rules);
  orders.setColumnWidths(1, 1, 140); orders.setColumnWidths(2, 1, 150); orders.setColumnWidth(C.SUMMARY, 320); orders.setColumnWidth(C.ADDR, 220); orders.setColumnWidth(C.LOG, 240);
  menu.setColumnWidth(3, 200);
  cfg.setColumnWidth(1, 240);

  // 觸發器：先清掉舊的避免重複
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['onSheetEdit', 'dailySummary'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('dailySummary').timeBased().everyDays(1).atHour(Number(getConfig_()['每日摘要時間(時)'])).inTimezone(TZ).create();

  SpreadsheetApp.getUi().alert('設定完成！\n\n下一步：右上角「部署」→「新增部署作業」→ 類型選「網頁應用程式」，存取權選「所有人」，再把網址貼進網站。');
}

function growRows_(s, n) {
  if (s.getMaxRows() < n) s.insertRowsAfter(s.getMaxRows(), n - s.getMaxRows());
}

function ensureSheet_(ss, name, head) {
  const s = ss.getSheetByName(name) || ss.insertSheet(name);
  if (s.getLastRow() < 1) {
    s.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#2b1d14').setFontColor('#fdfaf3');
    s.setFrozenRows(1);
  }
  return s;
}
