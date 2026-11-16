// 在本機用「假的 Google 服務」測試 gas/Code.gs 的訂單邏輯：  node tools/test_gas.js
const fs = require('fs'), vm = require('vm'), assert = require('assert');

function makeEnv() {
  const store = {};                       // 分頁名稱 -> 二維陣列
  const mails = [], props = {}, cache = {};
  const mkSheet = (name) => ({
    getName: () => name,
    getDataRange: () => ({ getValues: () => store[name].map(r => r.slice()) }),
    getLastRow: () => store[name].length,
    getRange: (r, c, nr = 1, nc = 1) => ({
      setValues: (vals) => { vals.forEach((row, i) => { store[name][r - 1 + i] = store[name][r - 1 + i] || []; row.forEach((v, j) => store[name][r - 1 + i][c - 1 + j] = v); }); },
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (store[name][r - 1 + i] || [])[c - 1 + j] ?? '')),
      getValue: () => (store[name][r - 1] || [])[c - 1], setValue: (v) => { store[name][r - 1] = store[name][r - 1] || []; store[name][r - 1][c - 1] = v; },
    }),
  });
  const ctx = {
    console, Date, JSON, Math, Number, String, Array, Object, Error,
    SpreadsheetApp: { getActive: () => ({ getSheetByName: (n) => store[n] ? mkSheet(n) : null }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, put: (k, v) => { cache[k] = v; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    MailApp: { sendEmail: (m) => mails.push(m) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
    Utilities: { formatDate: (d, tz, f) => { const p = n => String(n).padStart(2, '0'), t = new Date(d.getTime() + 8 * 3600e3); const y = t.getUTCFullYear(), mo = p(t.getUTCMonth() + 1), da = p(t.getUTCDate());
      return f === 'yyyyMMdd' ? `${y}${mo}${da}` : f === 'yyyy-MM-dd' ? `${y}-${mo}-${da}` : `${y}-${mo}-${da} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`; } },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + '/../gas/Code.gs', 'utf8') + '\n;this.__x={MENU_SEED,ORDER_HEAD,ITEM_HEAD,MENU_HEAD,onSheetEdit,dailySummary};', ctx);
  const { MENU_SEED, ORDER_HEAD, ITEM_HEAD, MENU_HEAD } = ctx.__x;
  store['訂單'] = [ORDER_HEAD.slice()]; store['訂單明細'] = [ITEM_HEAD.slice()];
  store['菜單'] = [MENU_HEAD.slice(), ...MENU_SEED.map(r => [...r, true])];
  store['設定'] = [['項目', '值']];
  return { ctx, store, mails, post: (b) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(b) } }).text) };
}

const base = (o = {}) => ({ requestId: 'req-' + Math.random().toString(36).slice(2, 12), mode: 'take', storeId: 'flag', name: '王小明', phone: '0912-345 678', email: 'a@b.co', items: [{ id: 's1', qty: 2 }], ...o });
let n = 0; const t = (name, fn) => { fn(); n++; console.log('✓', name); };

t('外帶：金額由伺服器依菜單計算、寫入訂單與明細', () => {
  const e = makeEnv(), r = e.post(base({ items: [{ id: 's1', qty: 2 }, { id: 't1', qty: 1 }], price: 1 }));
  assert.equal(r.ok, true); assert.equal(r.total, 75 * 2 + 55); assert.equal(r.fee, 0);
  assert.match(r.orderNo, /^JJ\d{8}-001$/);
  assert.equal(e.store['訂單'].length, 2); assert.equal(e.store['訂單明細'].length, 3);
  assert.equal(e.store['訂單'][1][6], '0912345678'); assert.equal(e.store['訂單'][1][4], '旗艦店');
});
t('宅配未達免運門檻加運費 100；達門檻免運', () => {
  const e = makeEnv();
  assert.equal(e.post(base({ mode: 'ship', addr: '台北市某路 1 號', items: [{ id: 's1', qty: 1 }] })).fee, 100);
  assert.equal(e.post(base({ mode: 'ship', addr: '台北市某路 1 號', items: [{ id: 'g3', qty: 1 }] })).fee, 0);
});
t('訂單編號依日期流水號遞增', () => {
  const e = makeEnv(); e.post(base()); const r = e.post(base()); assert.match(r.orderNo, /-002$/);
});
t('同一個 requestId 重複送出只會建立一張訂單', () => {
  const e = makeEnv(), b = base(), a = e.post(b), c = e.post(b);
  assert.equal(a.orderNo, c.orderNo); assert.equal(e.store['訂單'].length, 2);
});
t('欄位驗證：姓名／電話／Email／宅配地址／門市', () => {
  const e = makeEnv();
  [[{ name: '' }, '姓名'], [{ phone: '123' }, '電話'], [{ email: 'x' }, 'Email'], [{ mode: 'ship' }, '地址'], [{ storeId: 'zzz' }, '門市'], [{ mode: 'fly' }, '取餐方式']]
    .forEach(([o, k]) => { const r = e.post(base(o)); assert.equal(r.ok, false); assert.ok(r.error.includes(k), r.error); });
  assert.equal(e.store['訂單'].length, 1);
});
t('購物車驗證：空、數量非法、未知品項', () => {
  const e = makeEnv();
  [[], [{ id: 's1', qty: 0 }], [{ id: 's1', qty: 1.5 }], [{ id: 's1', qty: 100 }], [{ id: 'nope', qty: 1 }]].forEach(items => assert.equal(e.post(base({ items })).ok, false));
});
t('菜單分頁把品項設為「供應中＝FALSE」就無法下單', () => {
  const e = makeEnv(); e.store['菜單'].find(r => r[0] === 's2')[5] = false;
  const r = e.post(base({ items: [{ id: 's2', qty: 1 }] })); assert.equal(r.ok, false); assert.ok(r.error.includes('暫停供應'));
});
t('改菜單價格後，訂單立刻用新價格', () => {
  const e = makeEnv(); e.store['菜單'].find(r => r[0] === 's1')[4] = 80;
  assert.equal(e.post(base({ items: [{ id: 's1', qty: 1 }] })).total, 80);
});
t('蜜罐欄位有值＝機器人，不寫入、不寄信', () => {
  const e = makeEnv(); e.post(base({ hp: 'x' })); assert.equal(e.store['訂單'].length, 1); assert.equal(e.mails.length, 0);
});
t('同一支電話 10 分鐘內超過 5 張單會被擋', () => {
  const e = makeEnv(); for (let i = 0; i < 5; i++) assert.equal(e.post(base()).ok, true); assert.equal(e.post(base()).ok, false);
});
t('公式注入：=、+、-、@ 開頭的文字會被加空白前綴', () => {
  const e = makeEnv(); e.post(base({ name: '=HYPERLINK("http://x")', note: '+cmd' }));
  assert.equal(e.store['訂單'][1][5][0], ' '); assert.equal(e.store['訂單'][1][9][0], ' ');
});
t('寄信：店家一封；顧客有留 Email 才寄；備註裡的 HTML 會被跳脫', () => {
  const e = makeEnv(); e.post(base({ note: '<script>x</script>' }));
  assert.equal(e.mails.length, 2); assert.equal(e.mails[0].to, 'owner@example.com'); assert.equal(e.mails[1].to, 'a@b.co');
  assert.ok(!e.mails[0].htmlBody.includes('<script>')); assert.equal(e.post(base({ email: '' })) && e.mails.length, 3);
});
t('改「狀態」會寄通知給顧客並寫入通知紀錄', () => {
  const e = makeEnv(); e.post(base()); const before = e.mails.length;
  e.store['訂單'][1][2] = '可取餐';
  const sh = { getName: () => '訂單', getRange: (r, c, nr, nc) => ({ getValues: () => [e.store['訂單'][r - 1]], setValue: v => { e.store['訂單'][r - 1][c - 1] = v; } }) };
  e.ctx.__x.onSheetEdit({ range: { getSheet: () => sh, getColumn: () => 3, getRow: () => 2, getNumRows: () => 1, getValue: () => '可取餐' } });
  assert.equal(e.mails.length, before + 1); assert.match(e.mails.at(-1).subject, /可取餐/); assert.match(e.store['訂單'][1][14], /已寄「可取餐」通知/);
});
console.log(`\n${n} 項測試全部通過`);
