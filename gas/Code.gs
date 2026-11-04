/**
 * わだちログ（wadachi-log）バックエンド  Code.gs
 * GitHub Pages(index.html) ⇔ GAS ウェブアプリ（JSON API）
 *
 * ★ 修正したら必ず再デプロイ：
 *   ［デプロイ］→［デプロイを管理］→ 鉛筆 → バージョン「新バージョン」→［デプロイ］
 */
const SERVER_VERSION = '2.0.0';
const TERMS_VERSION = '2026-11-04';
const DEFAULT_APP_URL = 'https://kenken6291.github.io/wadachi-log/';

const SHEETS = {
  Users: ['userId', 'email', 'displayName', 'salt', 'passwordHash', 'mustChangePassword', 'tokenVersion', 'failedCount', 'lockedUntil', 'createdAt', 'updatedAt', 'lastLoginAt', 'agreedAt', 'termsVersion'],
  Trips: ['tripId', 'userId', 'title', 'tripType', 'description', 'startDate', 'endDate', 'distanceKm', 'elevationGainM', 'durationSec', 'pointCount', 'routeName', 'routeFileId', 'aiSummary', 'aiHighlights', 'aiSns', 'createdAt', 'updatedAt', 'visibility'],
  Waypoints_Media: ['spotId', 'tripId', 'userId', 'lat', 'lng', 'title', 'memo', 'takenAt', 'source', 'mediaJson', 'createdAt', 'updatedAt'],
  Comments: ['commentId', 'tripId', 'userId', 'body', 'createdAt', 'updatedAt'],
  Likes: ['tripId', 'userId', 'createdAt'],
  Contacts: ['ownerId', 'contactId', 'label', 'createdAt'],
  TripShares: ['tripId', 'ownerId', 'userId', 'createdAt']
};
const VIS = ['private', 'selected', 'members'];
const TRIP_TYPES = ['cycling', 'drive', 'other'];
const MAX_POINTS = 8000;
const MAX_MEDIA = 30;
const MAX_CONTACTS = 100;

/* ============================================================
 * エントリーポイント
 * ============================================================ */
function doGet(e) {
  const out = { ok: true, app: 'wadachi-log', serverVersion: SERVER_VERSION, termsVersion: TERMS_VERSION, time: new Date().toISOString() };
  const cb = e && e.parameter && e.parameter.callback;
  if (cb && /^[\w.$]+$/.test(cb)) {
    return ContentService.createTextOutput(cb + '(' + JSON.stringify(out) + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json_(out);
}

function doPost(e) {
  let req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (x) { return json_({ ok: false, error: 'BAD_REQUEST', message: 'リクエストを読み取れませんでした' }); }
  const action = String(req.action || '');
  try {
    const pub = PUBLIC_ACTIONS[action];
    if (pub) return json_(Object.assign({ ok: true }, pub(req)));
    const fn = ACTIONS[action];
    if (!fn) return json_({ ok: false, error: 'BAD_ACTION', message: '不明な操作です（' + action + '）' });
    const user = auth_(req.token);
    if (needsAgreement_(user) && AGREE_FREE.indexOf(action) < 0) {
      err_('AGREE', 'ご利用には、注意事項・免責事項への同意が必要です');
    }
    if (WRITE_ACTIONS.indexOf(action) >= 0) {
      const lock = LockService.getScriptLock();
      lock.waitLock(25000);
      try { return json_(Object.assign({ ok: true }, fn(req, user))); }
      finally { lock.releaseLock(); }
    }
    return json_(Object.assign({ ok: true }, fn(req, user)));
  } catch (x) {
    if (!x.code) console.error(action, x && x.stack || x);
    return json_({ ok: false, error: x.code || 'ERROR', message: x.code ? x.message : ('エラーが発生しました：' + (x && x.message || x)) });
  }
}

const PUBLIC_ACTIONS = {
  ping: () => ({ serverVersion: SERVER_VERSION, termsVersion: TERMS_VERSION }),
  login: req => login_(req),
  register: req => register_(req),
  forgotPassword: req => forgotPassword_(req)
};
const ACTIONS = {
  me: (req, u) => ({ user: userOut_(u), serverVersion: SERVER_VERSION, termsVersion: TERMS_VERSION }),
  agreeTerms: (req, u) => agreeTerms_(req, u),
  changePassword: (req, u) => changePassword_(req, u),
  updateProfile: (req, u) => updateProfile_(req, u),
  listTrips: (req, u) => listTrips_(u),
  listPublicTrips: (req, u) => listPublicTrips_(u),
  listSharedTrips: (req, u) => listSharedTrips_(u),
  getTrip: (req, u) => getTrip_(req, u),
  getRoutes: (req, u) => getRoutes_(req, u),
  saveTrip: (req, u) => saveTrip_(req, u),
  importTrip: (req, u) => importTrip_(req, u),
  saveRoute: (req, u) => saveRoute_(req, u),
  deleteTrip: (req, u) => deleteTrip_(req, u),
  uploadMedia: (req, u) => uploadMedia_(req, u),
  saveSpot: (req, u) => saveSpot_(req, u),
  deleteSpot: (req, u) => deleteSpot_(req, u),
  generateAi: (req, u) => generateAi_(req, u),
  routeFromImage: (req, u) => routeFromImage_(req, u),
  fetchRemote: (req, u) => fetchRemote_(req, u),
  addComment: (req, u) => addComment_(req, u),
  updateComment: (req, u) => updateComment_(req, u),
  deleteComment: (req, u) => deleteComment_(req, u),
  toggleLike: (req, u) => toggleLike_(req, u),
  listContacts: (req, u) => ({ contacts: contactsOut_(u.userId) }),
  addContact: (req, u) => addContact_(req, u),
  updateContact: (req, u) => updateContact_(req, u),
  removeContact: (req, u) => removeContact_(req, u),
  getShareOverview: (req, u) => getShareOverview_(u),
  setTripSharing: (req, u) => setTripSharing_(req, u)
};
const AGREE_FREE = ['me', 'agreeTerms', 'changePassword', 'updateProfile'];
const WRITE_ACTIONS = ['agreeTerms', 'changePassword', 'updateProfile', 'saveTrip', 'importTrip', 'saveRoute', 'deleteTrip', 'saveSpot', 'deleteSpot',
  'addComment', 'updateComment', 'deleteComment', 'toggleLike', 'addContact', 'updateContact', 'removeContact', 'setTripSharing'];

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function err_(code, msg) { const e = new Error(msg); e.code = code; throw e; }
function nowIso_() { return new Date().toISOString(); }
function newId_(p) { return p + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12); }
function str_(v, max) { v = v == null ? '' : String(v); v = v.replace(/\r\n?/g, '\n').trim(); return max ? v.slice(0, max) : v; }
function num_(v) { const n = Number(v); return isFinite(n) && v !== '' && v != null ? n : null; }

/* ============================================================
 * 設定・セットアップ
 * ============================================================ */
function props_() { return PropertiesService.getScriptProperties(); }
function prop_(k) { return props_().getProperty(k) || ''; }
function appUrl_() { return prop_('APP_URL') || DEFAULT_APP_URL; }

function setup() {
  const p = props_();
  let ss = null;
  if (p.getProperty('SPREADSHEET_ID')) { try { ss = SpreadsheetApp.openById(p.getProperty('SPREADSHEET_ID')); } catch (e) { ss = null; } }
  if (!ss) { ss = SpreadsheetApp.getActiveSpreadsheet(); if (!ss) ss = SpreadsheetApp.create('wadachi-log-db'); p.setProperty('SPREADSHEET_ID', ss.getId()); }
  if (!p.getProperty('TOKEN_SECRET')) p.setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  if (!p.getProperty('PEPPER')) p.setProperty('PEPPER', Utilities.getUuid());
  Object.keys(SHEETS).forEach(n => tbl_(n));
  rootFolder_(); subFolder_('routes'); subFolder_('media');
  console.log('セットアップ完了  サーバー v' + SERVER_VERSION + '  シート: ' + ss.getUrl());
}

function testGemini() {
  const t = gemini_([{ text: '「接続テスト成功」とだけ答えてください。' }], { temperature: 0 });
  console.log(t);
}

function ss_() {
  const id = prop_('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) err_('CONFIG', 'スプレッドシートが未設定です。GASエディタで setup を実行してください');
  return ss;
}
function rootFolder_() {
  const p = props_();
  const id = p.getProperty('DRIVE_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* 作り直す */ } }
  const it = DriveApp.getFoldersByName('wadachi-log-data');
  const f = it.hasNext() ? it.next() : DriveApp.createFolder('wadachi-log-data');
  p.setProperty('DRIVE_FOLDER_ID', f.getId());
  return f;
}
function subFolder_(name, parent) {
  parent = parent || rootFolder_();
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/* ============================================================
 * シート操作（見出し名で列を特定するので、既存シートの列順に依存しない）
 * ============================================================ */
const TBL_CACHE = {};
function tbl_(name) {
  if (TBL_CACHE[name]) return TBL_CACHE[name];
  const ss = ss_();
  const cols = SHEETS[name];
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, Math.max(sh.getMaxRows(), 2), cols.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    sh.setFrozenRows(1);
  }
  let head = [];
  if (sh.getLastRow() >= 1 && sh.getLastColumn() >= 1) {
    head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(v => String(v).trim());
    while (head.length && !head[head.length - 1]) head.pop();
  }
  if (!head.length) { sh.getRange(1, 1, 1, cols.length).setValues([cols]); head = cols.slice(); }
  const missing = cols.filter(c => head.indexOf(c) < 0);
  if (missing.length) {
    if (sh.getMaxColumns() < head.length + missing.length) sh.insertColumnsAfter(sh.getMaxColumns(), head.length + missing.length - sh.getMaxColumns());
    sh.getRange(1, head.length + 1, sh.getMaxRows(), missing.length).setNumberFormat('@');
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
    head = head.concat(missing);
  }
  const t = { name: name, sh: sh, head: head };
  TBL_CACHE[name] = t;
  return t;
}
function cell_(v) {
  if (v instanceof Date) return isNaN(v) ? '' : v.toISOString();
  return v == null ? '' : String(v);
}
function rows_(name) {
  const t = tbl_(name);
  const n = t.sh.getLastRow();
  if (n < 2) return [];
  const vals = t.sh.getRange(2, 1, n - 1, t.head.length).getValues();
  const out = [];
  vals.forEach((r, i) => {
    const o = { _r: i + 2 };
    t.head.forEach((h, j) => { if (h) o[h] = cell_(r[j]); });
    if (r.some(v => v !== '' && v != null)) out.push(o);
  });
  return out;
}
function rowArr_(t, o) { return t.head.map(h => (o[h] == null ? '' : String(o[h]))); }
function insert_(name, o) {
  const t = tbl_(name);
  const r = t.sh.getLastRow() + 1;
  t.sh.getRange(r, 1, 1, t.head.length).setNumberFormat('@').setValues([rowArr_(t, o)]);
  o._r = r;
  return o;
}
function update_(name, o) {
  const t = tbl_(name);
  t.sh.getRange(o._r, 1, 1, t.head.length).setNumberFormat('@').setValues([rowArr_(t, o)]);
  return o;
}
function deleteRows_(name, list) {
  const t = tbl_(name);
  list.map(o => o._r).sort((a, b) => b - a).forEach(r => t.sh.deleteRow(r));
}

/* ============================================================
 * 認証
 * ============================================================ */
function secret_() {
  const s = prop_('TOKEN_SECRET');
  if (!s) err_('CONFIG', 'TOKEN_SECRET が未設定です。setup を実行してください');
  return s;
}
function pepper_() { return prop_('PEPPER'); }
function b64u_(s) { return Utilities.base64EncodeWebSafe(s).replace(/=+$/, ''); }
function sign_(s) { return b64u_(Utilities.computeHmacSha256Signature(s, secret_())); }
function makeToken_(u) {
  const payload = b64u_(JSON.stringify({ u: u.userId, v: Number(u.tokenVersion || 0), e: Date.now() + 30 * 864e5 }));
  return payload + '.' + sign_(payload);
}
function auth_(token) {
  const bad = () => err_('AUTH', 'ログインの有効期限が切れました。もう一度ログインしてください');
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) bad();
  const [p, s] = token.split('.');
  if (sign_(p) !== s) bad();
  let o;
  try {
    let b = p.replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    o = JSON.parse(Utilities.newBlob(Utilities.base64Decode(b)).getDataAsString());
  } catch (e) { bad(); }
  if (!o || !o.u || Date.now() > o.e) bad();
  const u = rows_('Users').filter(x => x.userId === o.u)[0];
  if (!u || Number(u.tokenVersion || 0) !== Number(o.v)) bad();
  return u;
}
function userOut_(u) {
  return { userId: u.userId, email: u.email, displayName: u.displayName, mustChangePassword: u.mustChangePassword === 'TRUE', needsAgreement: needsAgreement_(u) };
}
function needsAgreement_(u) { return !u.agreedAt || u.termsVersion !== TERMS_VERSION; }

function hex_(bytes) { return bytes.map(b => ('0' + (b & 255).toString(16)).slice(-2)).join(''); }
function sha_(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8); }
function hashPw_(pw, salt) {
  let h = salt + pw + pepper_();
  for (let i = 0; i < 200; i++) h = hex_(sha_(h));
  return h;
}
/** 旧バージョンのハッシュ方式の候補も照合する（一致したら新方式に置き換え） */
function checkPw_(u, pw) {
  const salt = u.salt, pep = pepper_(), stored = String(u.passwordHash || '');
  if (!stored) return false;
  if (hashPw_(pw, salt) === stored) return 'current';
  const cands = [];
  let h = pw + pep; for (let i = 0; i < 200; i++) h = hex_(sha_(h + salt)); cands.push(h);
  h = salt + pw + pep; for (let i = 0; i < 200; i++) h = hex_(sha_(h + salt + pep)); cands.push(h);
  let b = sha_(salt + pw + pep); for (let i = 1; i < 200; i++) b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, b); cands.push(hex_(b), Utilities.base64Encode(b));
  h = salt + pw + pep; for (let i = 0; i < 200; i++) h = Utilities.base64Encode(sha_(h)); cands.push(h);
  h = salt + pw + pep; for (let i = 0; i < 200; i++) h = hex_(sha_(salt + h)); cands.push(h);
  return cands.indexOf(stored) >= 0 ? 'legacy' : false;
}
function validEmail_(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200; }
function tempPassword_() {
  const L = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', D = '23456789', A = L + D;
  let s = L[Math.floor(Math.random() * L.length)] + D[Math.floor(Math.random() * D.length)];
  for (let i = 0; i < 8; i++) s += A[Math.floor(Math.random() * A.length)];
  return s.split('').sort(() => Math.random() - .5).join('');
}
function checkNewPw_(pw) {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 100 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    err_('VALID', 'パスワードは8文字以上で、英字と数字を両方含めてください');
  }
}
function mailGuard_(email) {
  const c = CacheService.getScriptCache(), k = 'mail_' + Utilities.base64EncodeWebSafe(email);
  if (c.get(k)) err_('LIMIT', '仮パスワードを送ったばかりです。2分ほど待ってからもう一度お試しください');
  c.put(k, '1', 120);
}
function sendTempMail_(email, name, pw, isNew) {
  const url = appUrl_();
  const body = [
    name + ' さん',
    '',
    isNew ? 'わだちログへのご登録ありがとうございます。' : 'わだちログの仮パスワードを再発行しました。',
    '下記の仮パスワードでログインし、新しいパスワードを設定してください。',
    '',
    '仮パスワード：' + pw,
    'ログイン画面：' + url,
    '',
    'お心当たりのない場合は、このメールを破棄してください。',
    '—— わだちログ'
  ].join('\n');
  GmailApp.sendEmail(email, isNew ? '【わだちログ】仮パスワードのお知らせ' : '【わだちログ】仮パスワード再発行', body, { name: 'わだちログ' });
}

function register_(req) {
  const email = str_(req.email, 200).toLowerCase();
  const name = str_(req.displayName, 30);
  const ag = req.agreements || {};
  if (!validEmail_(email)) err_('VALID', 'メールアドレスの形式が正しくありません');
  if (!name) err_('VALID', '表示名を入力してください');
  if (!(ag.notice && ag.disclaimer && ag.selfResponsibility && ag.dispute)) err_('VALID', '注意事項・免責事項などのすべての項目に同意してください');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const ex = rows_('Users').filter(x => x.email === email)[0];
    if (ex && ex.lastLoginAt) err_('EXISTS', 'このメールアドレスは登録済みです。ログインするか、「パスワードを忘れた」から再発行してください');
    mailGuard_(email);
    const pw = tempPassword_(), now = nowIso_();
    if (ex) {
      ex.displayName = name; ex.salt = Utilities.getUuid(); ex.passwordHash = hashPw_(pw, ex.salt);
      ex.mustChangePassword = 'TRUE'; ex.tokenVersion = String(Number(ex.tokenVersion || 0) + 1);
      ex.failedCount = '0'; ex.lockedUntil = ''; ex.updatedAt = now; ex.agreedAt = now; ex.termsVersion = TERMS_VERSION;
      update_('Users', ex);
    } else {
      const salt = Utilities.getUuid();
      insert_('Users', { userId: newId_('u'), email: email, displayName: name, salt: salt, passwordHash: hashPw_(pw, salt), mustChangePassword: 'TRUE',
        tokenVersion: '0', failedCount: '0', lockedUntil: '', createdAt: now, updatedAt: now, lastLoginAt: '', agreedAt: now, termsVersion: TERMS_VERSION });
    }
    sendTempMail_(email, name, pw, true);
  } finally { lock.releaseLock(); }
  return { email: email, message: email + ' に仮パスワードを送りました。メールに記載の仮パスワードでログインしてください。' };
}

function login_(req) {
  const email = str_(req.email, 200).toLowerCase();
  const pw = String(req.password || '');
  if (!email || !pw) err_('VALID', 'メールアドレスとパスワードを入力してください');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const u = rows_('Users').filter(x => x.email === email)[0];
    const ng = 'メールアドレスまたはパスワードが違います';
    if (!u) err_('LOGIN', ng);
    if (u.lockedUntil && Date.parse(u.lockedUntil) > Date.now()) err_('LOCKED', 'ログインに続けて失敗したため、15分間ロックしています。時間をおくか、「パスワードを忘れた」から再発行してください');
    const r = checkPw_(u, pw);
    if (!r) {
      const n = Number(u.failedCount || 0) + 1;
      u.failedCount = String(n >= 5 ? 0 : n);
      u.lockedUntil = n >= 5 ? new Date(Date.now() + 15 * 60000).toISOString() : '';
      update_('Users', u);
      err_('LOGIN', n >= 5 ? 'ログインに5回失敗したため、15分間ロックしました' : ng + '（以前から登録している方でログインできない場合は「パスワードを忘れた」から再発行してください）');
    }
    if (r === 'legacy') { u.salt = Utilities.getUuid(); u.passwordHash = hashPw_(pw, u.salt); }
    u.failedCount = '0'; u.lockedUntil = ''; u.lastLoginAt = nowIso_();
    update_('Users', u);
    return { token: makeToken_(u), user: userOut_(u) };
  } finally { lock.releaseLock(); }
}

function forgotPassword_(req) {
  const email = str_(req.email, 200).toLowerCase();
  if (!validEmail_(email)) err_('VALID', 'メールアドレスの形式が正しくありません');
  const msg = { message: email + ' が登録済みの場合、仮パスワードを送りました。メールの仮パスワードでログインしてください。' };
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const u = rows_('Users').filter(x => x.email === email)[0];
    if (!u) return msg;
    mailGuard_(email);
    const pw = tempPassword_();
    u.salt = Utilities.getUuid(); u.passwordHash = hashPw_(pw, u.salt); u.mustChangePassword = 'TRUE';
    u.tokenVersion = String(Number(u.tokenVersion || 0) + 1); u.failedCount = '0'; u.lockedUntil = ''; u.updatedAt = nowIso_();
    update_('Users', u);
    sendTempMail_(email, u.displayName, pw, false);
  } finally { lock.releaseLock(); }
  return msg;
}

function changePassword_(req, u) {
  if (!checkPw_(u, String(req.currentPassword || ''))) err_('VALID', '現在のパスワード（仮パスワード）が違います');
  checkNewPw_(req.newPassword);
  if (req.newPassword === req.currentPassword) err_('VALID', '今と違うパスワードを設定してください');
  u.salt = Utilities.getUuid(); u.passwordHash = hashPw_(req.newPassword, u.salt); u.mustChangePassword = 'FALSE';
  u.tokenVersion = String(Number(u.tokenVersion || 0) + 1); u.updatedAt = nowIso_();
  update_('Users', u);
  return { token: makeToken_(u), user: userOut_(u) };
}
function updateProfile_(req, u) {
  const name = str_(req.displayName, 30);
  if (!name) err_('VALID', '表示名を入力してください');
  u.displayName = name; u.updatedAt = nowIso_();
  update_('Users', u);
  return { user: userOut_(u) };
}
function agreeTerms_(req, u) {
  const ag = req.agreements || {};
  if (!(ag.notice && ag.disclaimer && ag.selfResponsibility && ag.dispute)) err_('VALID', 'すべての項目に同意してください');
  u.agreedAt = nowIso_(); u.termsVersion = TERMS_VERSION; u.updatedAt = u.agreedAt;
  update_('Users', u);
  return { user: userOut_(u) };
}

/* ============================================================
 * トリップ
 * ============================================================ */
function userNames_() { const m = {}; rows_('Users').forEach(u => { m[u.userId] = u.displayName; }); return m; }
function countBy_(rows, key) { const m = {}; rows.forEach(r => { m[r[key]] = (m[r[key]] || 0) + 1; }); return m; }
function sharesOf_(tripId, shares) { return (shares || rows_('TripShares')).filter(s => s.tripId === tripId).map(s => s.userId); }
function canView_(t, uid, shares) {
  if (!t) return false;
  if (t.userId === uid) return true;
  const v = t.visibility || 'private';
  if (v === 'members') return true;
  if (v === 'selected') return (shares || rows_('TripShares')).some(s => s.tripId === t.tripId && s.userId === uid);
  return false;
}
function findTrip_(id) { return rows_('Trips').filter(t => t.tripId === id)[0]; }
function ownTrip_(id, u) {
  const t = findTrip_(String(id || ''));
  if (!t || t.userId !== u.userId) err_('FORBIDDEN', 'このトリップは編集できません');
  return t;
}
function viewTrip_(id, u, shares) {
  const t = findTrip_(String(id || ''));
  if (!canView_(t, u.userId, shares)) err_('NOT_FOUND', 'このトリップは見つからないか、あなたには公開されていません');
  return t;
}
function tripOut_(t, u, ctx) {
  ctx = ctx || {};
  const isOwner = t.userId === u.userId;
  const o = {
    tripId: t.tripId, title: t.title, tripType: t.tripType || 'other', description: t.description,
    startDate: t.startDate, endDate: t.endDate,
    distanceKm: num_(t.distanceKm) || 0, elevationGainM: num_(t.elevationGainM), durationSec: num_(t.durationSec) || 0,
    pointCount: num_(t.pointCount) || 0, routeName: t.routeName, hasRoute: !!t.routeFileId,
    visibility: VIS.indexOf(t.visibility) >= 0 ? t.visibility : 'private',
    isOwner: isOwner, ownerName: (ctx.names || {})[t.userId] || '',
    spotCount: ctx.spotCount != null ? ctx.spotCount : ((ctx.spots || {})[t.tripId] || 0),
    likeCount: (ctx.likes || {})[t.tripId] || 0, commentCount: (ctx.comments || {})[t.tripId] || 0,
    aiSummary: t.aiSummary, aiHighlights: t.aiHighlights, aiSns: t.aiSns,
    createdAt: t.createdAt, updatedAt: t.updatedAt
  };
  if (isOwner && ctx.shares) { o.shareIds = sharesOf_(t.tripId, ctx.shares); o.shareCount = o.shareIds.length; }
  return o;
}
function listCtx_(withShares) {
  return {
    names: userNames_(),
    spots: countBy_(rows_('Waypoints_Media'), 'tripId'),
    likes: countBy_(rows_('Likes'), 'tripId'),
    comments: countBy_(rows_('Comments'), 'tripId'),
    shares: withShares ? rows_('TripShares') : null
  };
}
function sortTrips_(list) {
  return list.sort((a, b) => String(b.startDate || b.createdAt).localeCompare(String(a.startDate || a.createdAt)) || String(b.createdAt).localeCompare(String(a.createdAt)));
}
function listTrips_(u) {
  const ctx = listCtx_(true);
  return { trips: sortTrips_(rows_('Trips').filter(t => t.userId === u.userId)).map(t => tripOut_(t, u, ctx)) };
}
function listPublicTrips_(u) {
  const ctx = listCtx_(false);
  return { trips: sortTrips_(rows_('Trips').filter(t => t.visibility === 'members')).map(t => tripOut_(t, u, ctx)) };
}
function listSharedTrips_(u) {
  const shares = rows_('TripShares');
  const ids = {}; shares.forEach(s => { if (s.userId === u.userId) ids[s.tripId] = true; });
  const ctx = listCtx_(false);
  return { trips: sortTrips_(rows_('Trips').filter(t => ids[t.tripId] && t.visibility === 'selected' && t.userId !== u.userId)).map(t => tripOut_(t, u, ctx)) };
}

function spotOut_(s) {
  let media = [];
  try { media = JSON.parse(s.mediaJson || '[]') || []; } catch (e) { media = []; }
  return { spotId: s.spotId, tripId: s.tripId, lat: Number(s.lat), lng: Number(s.lng), title: s.title, memo: s.memo, takenAt: s.takenAt, source: s.source, media: media, createdAt: s.createdAt, updatedAt: s.updatedAt };
}
function commentOut_(c, u, trip, names) {
  return { commentId: c.commentId, tripId: c.tripId, authorName: names[c.userId] || '退会した会員', isMine: c.userId === u.userId,
    canDelete: c.userId === u.userId || (trip && trip.userId === u.userId), body: c.body, createdAt: c.createdAt, edited: !!c.updatedAt && c.updatedAt !== c.createdAt };
}
function readRoute_(fileId) {
  if (!fileId) return null;
  try { return JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString()); } catch (e) { return null; }
}

function getTrip_(req, u) {
  const shares = rows_('TripShares');
  const t = viewTrip_(req.tripId, u, shares);
  const names = userNames_();
  const spots = rows_('Waypoints_Media').filter(s => s.tripId === t.tripId).map(spotOut_);
  const comments = rows_('Comments').filter(c => c.tripId === t.tripId).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map(c => commentOut_(c, u, t, names));
  const likes = rows_('Likes').filter(l => l.tripId === t.tripId);
  const trip = tripOut_(t, u, { names: names, spotCount: spots.length, likes: { [t.tripId]: likes.length }, comments: { [t.tripId]: comments.length }, shares: shares });
  if (trip.isOwner) {
    const cn = contactsOut_(u.userId);
    trip.shareNames = trip.shareIds.map(id => { const c = cn.filter(x => x.contactId === id)[0]; return c ? (c.label || c.displayName) : (names[id] || ''); });
  }
  const route = readRoute_(t.routeFileId);
  return { trip: trip, spots: spots, route: route ? { name: route.name || t.routeName, points: route.points || [] } : null,
    comments: comments, liked: likes.some(l => l.userId === u.userId), likeCount: likes.length };
}

function getRoutes_(req, u) {
  const ids = (req.tripIds || []).slice(0, 50).map(String);
  const shares = rows_('TripShares');
  const trips = rows_('Trips');
  const out = {};
  ids.forEach(id => {
    const t = trips.filter(x => x.tripId === id)[0];
    if (!canView_(t, u.userId, shares) || !t.routeFileId) { out[id] = []; return; }
    const r = readRoute_(t.routeFileId);
    const pts = (r && r.points) || [];
    const step = Math.max(1, Math.ceil(pts.length / 1500));
    const ll = [];
    for (let i = 0; i < pts.length; i += step) ll.push([Number(pts[i][0]), Number(pts[i][1])]);
    if (pts.length && (pts.length - 1) % step) ll.push([Number(pts[pts.length - 1][0]), Number(pts[pts.length - 1][1])]);
    out[id] = ll;
  });
  return { routes: out };
}

function applyTripFields_(t, src) {
  const title = str_(src.title, 80);
  if (!title) err_('VALID', 'タイトルを入力してください');
  t.title = title;
  t.tripType = TRIP_TYPES.indexOf(src.tripType) >= 0 ? src.tripType : 'other';
  t.description = str_(src.description, 2000);
  const d = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
  t.startDate = d(src.startDate); t.endDate = d(src.endDate);
  if (src.visibility !== undefined) t.visibility = VIS.indexOf(src.visibility) >= 0 ? src.visibility : 'private';
  if (!t.visibility) t.visibility = 'private';
}
function saveTrip_(req, u) {
  const src = req.trip || {};
  let t;
  const now = nowIso_();
  if (src.tripId) {
    t = ownTrip_(src.tripId, u);
    applyTripFields_(t, src);
    t.updatedAt = now;
    update_('Trips', t);
  } else {
    t = { tripId: newId_('t'), userId: u.userId, createdAt: now, updatedAt: now, visibility: 'private' };
    applyTripFields_(t, src);
    insert_('Trips', t);
  }
  if (Array.isArray(req.shareIds)) replaceShares_(t, u, req.shareIds);
  return { trip: tripOut_(t, u, Object.assign(listCtx_(true), req.spotCount != null ? { spotCount: Number(req.spotCount) || 0 } : {})) };
}

function thin_(pts) {
  if (pts.length <= MAX_POINTS) return pts;
  const out = [], step = (pts.length - 1) / (MAX_POINTS - 1);
  for (let i = 0; i < MAX_POINTS; i++) out.push(pts[Math.round(i * step)]);
  return out;
}
function cleanPoints_(pts) {
  return (Array.isArray(pts) ? pts : []).map(p => [Number(p[0]), Number(p[1]), num_(p[2]), num_(p[3])])
    .filter(p => isFinite(p[0]) && isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180)
    .map(p => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6, p[2] == null ? null : Math.round(p[2] * 10) / 10, p[3]]);
}
function writeRoute_(t, route) {
  const pts = thin_(cleanPoints_(route.points));
  if (pts.length < 2) err_('VALID', 'ルートの点が少なすぎます（2点以上必要です）');
  const name = str_(route.name, 120);
  const content = JSON.stringify({ name: name, points: pts });
  let saved = false;
  if (t.routeFileId) {
    try { DriveApp.getFileById(t.routeFileId).setContent(content); saved = true; } catch (e) { saved = false; }
  }
  if (!saved) {
    const f = subFolder_('routes').createFile(t.tripId + '.json', content, 'application/json');
    t.routeFileId = f.getId();
  }
  const st = route.stats || {};
  t.routeName = name;
  t.pointCount = String(pts.length);
  t.distanceKm = st.distanceKm != null ? String(Math.round(Number(st.distanceKm) * 1000) / 1000) : '';
  t.elevationGainM = st.elevationGainM != null && isFinite(Number(st.elevationGainM)) ? String(Math.round(Number(st.elevationGainM))) : '';
  t.durationSec = st.durationSec != null && isFinite(Number(st.durationSec)) ? String(Math.round(Number(st.durationSec))) : '';
  t.updatedAt = nowIso_();
}
function saveRoute_(req, u) {
  const t = ownTrip_(req.tripId, u);
  writeRoute_(t, req.route || {});
  update_('Trips', t);
  return { trip: tripOut_(t, u, Object.assign(listCtx_(true), req.spotCount != null ? { spotCount: Number(req.spotCount) || 0 } : {})) };
}
function importTrip_(req, u) {
  const now = nowIso_();
  const t = { tripId: newId_('t'), userId: u.userId, createdAt: now, updatedAt: now, visibility: 'private' };
  applyTripFields_(t, req.trip || {});
  writeRoute_(t, req.route || {});
  insert_('Trips', t);
  return { trip: tripOut_(t, u, Object.assign(listCtx_(true), { spotCount: 0 })) };
}
function trashFile_(id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* 既に無い */ } }
function deleteTrip_(req, u) {
  const t = ownTrip_(req.tripId, u);
  const spots = rows_('Waypoints_Media').filter(s => s.tripId === t.tripId);
  if (t.routeFileId) trashFile_(t.routeFileId);
  try {
    const it = subFolder_('media').getFoldersByName(t.tripId);
    while (it.hasNext()) it.next().setTrashed(true);
  } catch (e) { /* なし */ }
  deleteRows_('Waypoints_Media', spots);
  deleteRows_('Comments', rows_('Comments').filter(c => c.tripId === t.tripId));
  deleteRows_('Likes', rows_('Likes').filter(c => c.tripId === t.tripId));
  deleteRows_('TripShares', rows_('TripShares').filter(c => c.tripId === t.tripId));
  deleteRows_('Trips', [t]);
  return { deleted: t.tripId };
}

/* ============================================================
 * 写真・動画・スポット
 * ============================================================ */
function uploadMedia_(req, u) {
  const t = ownTrip_(req.tripId, u);
  const mime = String(req.mimeType || '');
  if (!/^(image|video)\//.test(mime)) err_('VALID', '写真か動画を選んでください');
  if (!req.data) err_('VALID', 'ファイルが空です');
  const bytes = Utilities.base64Decode(String(req.data));
  if (bytes.length > 30 * 1048576) err_('VALID', 'ファイルが大きすぎます');
  const name = str_(req.fileName, 120).replace(/[\\/]/g, '_') || ('media_' + Date.now());
  const folder = subFolder_(t.tripId, subFolder_('media'));
  const f = folder.createFile(Utilities.newBlob(bytes, mime, name));
  let warning = '';
  try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
  catch (e) { warning = 'Googleドライブの共有設定を変更できなかったため、写真が表示されない可能性があります（組織アカウントの制限）'; }
  return { media: { fileId: f.getId(), mimeType: mime, name: name }, warning: warning };
}
function cleanMedia_(list) {
  return (Array.isArray(list) ? list : []).filter(m => m && m.fileId && /^[\w-]+$/.test(String(m.fileId)))
    .slice(0, MAX_MEDIA).map(m => ({ fileId: String(m.fileId), mimeType: str_(m.mimeType, 80), name: str_(m.name, 120) }));
}
function saveSpot_(req, u) {
  const src = req.spot || {};
  const t = ownTrip_(src.tripId, u);
  const lat = Number(src.lat), lng = Number(src.lng);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) err_('VALID', '位置が正しくありません');
  if (Array.isArray(src.media) && src.media.length > MAX_MEDIA) err_('VALID', '1つのスポットに登録できる写真・動画は' + MAX_MEDIA + '件までです');
  const media = cleanMedia_(src.media);
  const now = nowIso_();
  let s;
  if (src.spotId) {
    s = rows_('Waypoints_Media').filter(x => x.spotId === src.spotId && x.tripId === t.tripId)[0];
    if (!s) err_('NOT_FOUND', 'スポットが見つかりません');
    const keep = {}; media.forEach(m => { keep[m.fileId] = true; });
    spotOut_(s).media.forEach(m => { if (!keep[m.fileId]) trashFile_(m.fileId); });
  } else {
    s = { spotId: newId_('s'), tripId: t.tripId, userId: u.userId, createdAt: now };
  }
  s.lat = lat.toFixed(6); s.lng = lng.toFixed(6);
  s.title = str_(src.title, 80); s.memo = str_(src.memo, 4000);
  s.takenAt = src.takenAt && !isNaN(Date.parse(src.takenAt)) ? new Date(src.takenAt).toISOString() : '';
  s.source = src.source === 'exif' ? 'exif' : 'map';
  s.mediaJson = JSON.stringify(media);
  s.updatedAt = now;
  if (src.spotId) update_('Waypoints_Media', s); else insert_('Waypoints_Media', s);
  t.updatedAt = now; update_('Trips', t);
  return { spot: spotOut_(s) };
}
function deleteSpot_(req, u) {
  const s = rows_('Waypoints_Media').filter(x => x.spotId === String(req.spotId || ''))[0];
  if (!s) err_('NOT_FOUND', 'スポットが見つかりません');
  ownTrip_(s.tripId, u);
  spotOut_(s).media.forEach(m => trashFile_(m.fileId));
  deleteRows_('Waypoints_Media', [s]);
  return { deleted: s.spotId };
}

/* ============================================================
 * コメント・いいね
 * ============================================================ */
function addComment_(req, u) {
  const t = viewTrip_(req.tripId, u);
  const body = str_(req.body, 1000);
  if (!body) err_('VALID', 'コメントを入力してください');
  const now = nowIso_();
  const c = insert_('Comments', { commentId: newId_('c'), tripId: t.tripId, userId: u.userId, body: body, createdAt: now, updatedAt: now });
  return { comment: commentOut_(c, u, t, userNames_()) };
}
function updateComment_(req, u) {
  const c = rows_('Comments').filter(x => x.commentId === String(req.commentId || ''))[0];
  if (!c || c.userId !== u.userId) err_('FORBIDDEN', 'このコメントは修正できません');
  const t = viewTrip_(c.tripId, u);
  const body = str_(req.body, 1000);
  if (!body) err_('VALID', 'コメントを入力してください');
  c.body = body; c.updatedAt = nowIso_();
  update_('Comments', c);
  return { comment: commentOut_(c, u, t, userNames_()) };
}
function deleteComment_(req, u) {
  const c = rows_('Comments').filter(x => x.commentId === String(req.commentId || ''))[0];
  if (!c) err_('NOT_FOUND', 'コメントが見つかりません');
  const t = findTrip_(c.tripId);
  if (c.userId !== u.userId && !(t && t.userId === u.userId)) err_('FORBIDDEN', 'このコメントは削除できません');
  deleteRows_('Comments', [c]);
  return { deleted: c.commentId };
}
function toggleLike_(req, u) {
  const t = viewTrip_(req.tripId, u);
  const all = rows_('Likes').filter(l => l.tripId === t.tripId);
  const mine = all.filter(l => l.userId === u.userId);
  if (mine.length) { deleteRows_('Likes', mine); return { liked: false, likeCount: all.length - mine.length }; }
  insert_('Likes', { tripId: t.tripId, userId: u.userId, createdAt: nowIso_() });
  return { liked: true, likeCount: all.length + 1 };
}

/* ============================================================
 * 共有相手（家族・友人）と、指定会員への公開
 * ============================================================ */
function contactsOut_(ownerId) {
  const users = {}; rows_('Users').forEach(x => { users[x.userId] = x; });
  return rows_('Contacts').filter(c => c.ownerId === ownerId && users[c.contactId])
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .map(c => ({ contactId: c.contactId, displayName: users[c.contactId].displayName, email: users[c.contactId].email, label: c.label, createdAt: c.createdAt }));
}
function addContact_(req, u) {
  const email = str_(req.email, 200).toLowerCase();
  const label = str_(req.label, 20);
  if (!validEmail_(email)) err_('VALID', 'メールアドレスの形式が正しくありません');
  if (email === u.email) err_('VALID', '自分自身は追加できません');
  const target = rows_('Users').filter(x => x.email === email)[0];
  if (!target || !target.lastLoginAt) err_('NOT_MEMBER', 'このメールアドレスの会員は見つかりませんでした。相手に会員登録（初回ログインまで）をしてもらってから追加してください');
  const mine = rows_('Contacts').filter(c => c.ownerId === u.userId);
  if (mine.some(c => c.contactId === target.userId)) err_('EXISTS', 'すでに共有相手に登録されています');
  if (mine.length >= MAX_CONTACTS) err_('LIMIT', '共有相手は' + MAX_CONTACTS + '人までです');
  insert_('Contacts', { ownerId: u.userId, contactId: target.userId, label: label, createdAt: nowIso_() });
  return { contacts: contactsOut_(u.userId), added: target.userId };
}
function updateContact_(req, u) {
  const c = rows_('Contacts').filter(x => x.ownerId === u.userId && x.contactId === String(req.contactId || ''))[0];
  if (!c) err_('NOT_FOUND', '共有相手が見つかりません');
  c.label = str_(req.label, 20);
  update_('Contacts', c);
  return { contacts: contactsOut_(u.userId) };
}
function removeContact_(req, u) {
  const id = String(req.contactId || '');
  const c = rows_('Contacts').filter(x => x.ownerId === u.userId && x.contactId === id);
  if (!c.length) err_('NOT_FOUND', '共有相手が見つかりません');
  deleteRows_('TripShares', rows_('TripShares').filter(s => s.ownerId === u.userId && s.userId === id));
  deleteRows_('Contacts', c);
  return { contacts: contactsOut_(u.userId) };
}
function replaceShares_(t, u, ids) {
  const allowed = {}; rows_('Contacts').forEach(c => { if (c.ownerId === u.userId) allowed[c.contactId] = true; });
  const want = []; (ids || []).forEach(id => { id = String(id); if (allowed[id] && want.indexOf(id) < 0) want.push(id); });
  const cur = rows_('TripShares').filter(s => s.tripId === t.tripId);
  const curIds = cur.map(s => s.userId);
  deleteRows_('TripShares', cur.filter(s => want.indexOf(s.userId) < 0));
  const now = nowIso_();
  want.filter(id => curIds.indexOf(id) < 0).forEach(id => insert_('TripShares', { tripId: t.tripId, ownerId: u.userId, userId: id, createdAt: now }));
}
function setTripSharing_(req, u) {
  const t = ownTrip_(req.tripId, u);
  if (req.visibility !== undefined) {
    if (VIS.indexOf(req.visibility) < 0) err_('VALID', '公開範囲が正しくありません');
    t.visibility = req.visibility;
  }
  if (Array.isArray(req.shareIds)) replaceShares_(t, u, req.shareIds);
  t.updatedAt = nowIso_();
  update_('Trips', t);
  const out = tripOut_(t, u, listCtx_(true));
  const cn = contactsOut_(u.userId);
  out.shareNames = out.shareIds.map(id => { const c = cn.filter(x => x.contactId === id)[0]; return c ? (c.label || c.displayName) : ''; });
  return { trip: out };
}
function getShareOverview_(u) {
  const shares = rows_('TripShares');
  const trips = sortTrips_(rows_('Trips').filter(t => t.userId === u.userId)).map(t => ({
    tripId: t.tripId, title: t.title, tripType: t.tripType, startDate: t.startDate,
    visibility: VIS.indexOf(t.visibility) >= 0 ? t.visibility : 'private', shareIds: sharesOf_(t.tripId, shares)
  }));
  return { trips: trips, contacts: contactsOut_(u.userId) };
}

/* ============================================================
 * Gemini
 * ============================================================ */
function gemini_(parts, opt) {
  opt = opt || {};
  const key = prop_('GEMINI_API_KEY');
  if (!key) err_('CONFIG', 'GEMINI_API_KEY が未設定です（GASのスクリプトプロパティに追加してください）');
  const model = prop_('GEMINI_MODEL') || 'gemini-2.5-flash';
  const body = { contents: [{ role: 'user', parts: parts }], generationConfig: { temperature: opt.temperature != null ? opt.temperature : 0.7 } };
  if (opt.json) body.generationConfig.responseMimeType = 'application/json';
  if (opt.system) body.systemInstruction = { parts: [{ text: opt.system }] };
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key }, payload: JSON.stringify(body), muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code === 429) err_('AI_LIMIT', 'AIの利用回数の上限に達しました。しばらく時間をおいてからお試しください');
  if (code >= 400) err_('AI', 'AIの呼び出しに失敗しました（' + code + '）：' + res.getContentText().slice(0, 200));
  const j = JSON.parse(res.getContentText());
  const c = j.candidates && j.candidates[0];
  const text = c && c.content && c.content.parts ? c.content.parts.map(p => p.text || '').join('') : '';
  if (!text) err_('AI', 'AIから回答を得られませんでした。もう一度お試しください');
  return text;
}

/** 前置き・指示文（「〜で読み上げてください」など）を取り除く */
function cleanAiText_(s) {
  let lines = String(s || '').replace(/\r\n?/g, '\n').split('\n');
  const meta = /(読み上げ|朗読|ナレーション|音読|話して|声で|口調で|トーンで).{0,20}(ください|下さい|します|しましょう)|^(以下|下記)(は|に|が).{0,40}(です|ます|します)[。:：]?$|^(はい|承知|かしこまり|了解)/;
  while (lines.length && (!lines[0].trim() || meta.test(lines[0].trim()))) lines.shift();
  while (lines.length && (!lines[lines.length - 1].trim() || /^(いかがでしょうか|ご参考|必要に応じて).{0,40}$/.test(lines[lines.length - 1].trim()))) lines.pop();
  return lines.join('\n')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*[\*\-]\s+/gm, '・')
    .replace(/[（(][^）)]{0,30}(読み上げ|ナレーション|朗読)[^）)]{0,30}[）)]/g, '')
    .trim();
}

const AI_SYSTEM = [
  'あなたはサイクリング・ドライブの旅の記録を文章にまとめる編集者です。',
  '出力は完成した本文だけにしてください。',
  '前置き・あいさつ・「以下は〜です」「承知しました」などの説明、',
  '「〜で読み上げてください」「〜の口調で」などの読み方の指示やト書き、',
  'Markdown記号（#、*、**）は一切書かないでください。',
  '与えられた記録にない事実（店名・出来事・数値）は作らず、写真から分かることは控えめに表現してください。'
].join('\n');

function generateAi_(req, u) {
  const t = ownTrip_(req.tripId, u);
  const mode = ['summary', 'highlights', 'sns'].indexOf(req.mode) >= 0 ? req.mode : 'summary';
  const spots = rows_('Waypoints_Media').filter(s => s.tripId === t.tripId).map(spotOut_)
    .sort((a, b) => (Date.parse(a.takenAt) || 9e15) - (Date.parse(b.takenAt) || 9e15));
  const typeName = { cycling: 'サイクリング', drive: 'ドライブ', other: 'おでかけ' }[t.tripType] || 'おでかけ';
  const fmtDT = iso => { const d = new Date(iso); return isNaN(d) ? '' : Utilities.formatDate(d, 'Asia/Tokyo', 'M/d HH:mm'); };
  const lines = [
    '【トリップ】' + t.title, '種類：' + typeName,
    '日付：' + (t.startDate || '不明') + (t.endDate && t.endDate !== t.startDate ? ' 〜 ' + t.endDate : ''),
    t.routeFileId ? '距離：約' + (Math.round((num_(t.distanceKm) || 0) * 10) / 10) + 'km' : 'ルート：なし',
    num_(t.elevationGainM) != null && t.elevationGainM !== '' ? '獲得標高：約' + t.elevationGainM + 'm' : '',
    num_(t.durationSec) ? '所要時間：約' + Math.floor(t.durationSec / 3600) + '時間' + Math.round(t.durationSec % 3600 / 60) + '分' : '',
    t.routeName ? 'ルート名：' + t.routeName : '',
    t.description ? 'メモ：' + t.description : '',
    '', '【立ち寄りスポット（時系列）】'
  ].filter(x => x !== '');
  if (!spots.length) lines.push('（登録なし）');
  spots.forEach((s, i) => {
    lines.push((i + 1) + '. ' + (s.title || '名称なし') + (s.takenAt ? '（' + fmtDT(s.takenAt) + '）' : '') + ' 緯度経度 ' + s.lat.toFixed(4) + ',' + s.lng.toFixed(4)
      + (s.memo ? ' ／ メモ：' + s.memo.replace(/\n/g, ' ') : '') + (s.media.length ? ' ／ 写真・動画' + s.media.length + '件' : ''));
  });
  const task = {
    summary: '上の記録をもとに、旅の日誌を書いてください。出発から帰着まで時系列で、道のりと立ち寄り先の様子を、日記らしい文体（〜した。〜だった。）で400〜700字。段落は2〜4つ。',
    highlights: 'このルートの見どころ解説を書いてください。最初にルート全体の特徴（距離・アップダウン・道の雰囲気。分からない点は推測と分かる書き方）を2〜3文、次にスポットごとの見どころを「・スポット名：説明」の形で、最後にこれから走る（行く）人へのアドバイスを2〜3文。です・ます調。',
    sns: '次の2つを書いてください。\n【SNS投稿】140字前後の投稿文と、最後にハッシュタグ3〜6個。\n【ブログ導入】ブログ記事の導入文を200〜300字。\n見出しは【SNS投稿】【ブログ導入】の2つだけを使うこと。'
  }[mode];
  const parts = [{ text: lines.join('\n') + '\n\n【依頼】\n' + task }];
  if (req.usePhotos) {
    const imgs = [];
    spots.forEach((s, i) => s.media.forEach(m => { if (/^image\//.test(m.mimeType)) imgs.push({ m: m, no: i + 1, title: s.title }); }));
    const pick = [];
    const n = Math.min(6, imgs.length);
    for (let k = 0; k < n; k++) pick.push(imgs[Math.floor(k * imgs.length / n)]);
    pick.forEach(p => {
      try {
        const b = DriveApp.getFileById(p.m.fileId).getBlob();
        if (b.getBytes().length > 4 * 1048576) return;
        parts.push({ text: 'スポット' + p.no + '（' + (p.title || '名称なし') + '）の写真：' });
        parts.push({ inline_data: { mime_type: b.getContentType() || 'image/jpeg', data: Utilities.base64Encode(b.getBytes()) } });
      } catch (e) { /* 読めない写真は飛ばす */ }
    });
  }
  const text = cleanAiText_(gemini_(parts, { system: AI_SYSTEM, temperature: 0.7 }));
  const field = { summary: 'aiSummary', highlights: 'aiHighlights', sns: 'aiSns' }[mode];
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const cur = findTrip_(t.tripId);
    cur[field] = text.slice(0, 20000); cur.updatedAt = nowIso_();
    update_('Trips', cur);
  } finally { lock.releaseLock(); }
  return { text: text };
}

/* ============================================================
 * 画像（アクティビティマップのスクリーンショット）から経路
 * ============================================================ */
const R2D = 180 / Math.PI;
function merc_(lat, lng) { return [lng, R2D * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))]; }
function unmerc_(x, y) { return [360 / Math.PI * Math.atan(Math.exp(y / R2D)) - 90, x]; }
function hav_(a, b) {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
function pathKm_(pts) { let d = 0; for (let i = 1; i < pts.length; i++) d += hav_(pts[i - 1], pts[i]); return d; }
function solve3_(A, b) {
  const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  if (Math.abs(D) < 1e-9) return null;
  return [0, 1, 2].map(k => det(A.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)))) / D);
}
/** 画像座標(px,py) → メルカトル座標 のアフィン変換を最小二乗で求める（3点以上） */
function fitAffine_(src, dst) {
  const n = src.length;
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0;
  const bx = [0, 0, 0], by = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const [x, y] = src[i], [X, Y] = dst[i];
    sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y;
    bx[0] += x * X; bx[1] += y * X; bx[2] += X;
    by[0] += x * Y; by[1] += y * Y; by[2] += Y;
  }
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const a = solve3_(A, bx), b = solve3_(A, by);
  if (!a || !b) return null;
  // 画像は下向きy、地図は北向きYなので、正しい向きなら行列式は負
  if (a[0] * b[1] - a[1] * b[0] >= 0) return null;
  return p => [a[0] * p[0] + a[1] * p[1] + a[2], b[0] * p[0] + b[1] * p[1] + b[2]];
}
/** 2点からの相似変換（回転・拡大・平行移動） */
function fitSimilar_(src, dst) {
  const z1 = [src[0][0], -src[0][1]], z2 = [src[1][0], -src[1][1]];
  const dz = [z2[0] - z1[0], z2[1] - z1[1]], dw = [dst[1][0] - dst[0][0], dst[1][1] - dst[0][1]];
  const den = dz[0] * dz[0] + dz[1] * dz[1];
  if (den < 1e-9) return null;
  const a = [(dw[0] * dz[0] + dw[1] * dz[1]) / den, (dw[1] * dz[0] - dw[0] * dz[1]) / den];
  return p => {
    const z = [p[0] - src[0][0], -(p[1] - src[0][1])];
    return [dst[0][0] + a[0] * z[0] - a[1] * z[1], dst[0][1] + a[0] * z[1] + a[1] * z[0]];
  };
}
function snapOsrm_(pts, tripType) {
  try {
    const host = tripType === 'cycling' ? 'routed-bike' : 'routed-car';
    const n = Math.min(25, pts.length);
    const samp = [];
    for (let i = 0; i < n; i++) samp.push(pts[Math.round(i * (pts.length - 1) / (n - 1))]);
    const coords = samp.map(p => p[1].toFixed(6) + ',' + p[0].toFixed(6)).join(';');
    const res = UrlFetchApp.fetch('https://routing.openstreetmap.de/' + host + '/route/v1/driving/' + coords + '?overview=full&geometries=geojson&continue_straight=false',
      { muteHttpExceptions: true, headers: { 'User-Agent': 'wadachi-log/' + SERVER_VERSION } });
    if (res.getResponseCode() !== 200) return null;
    const j = JSON.parse(res.getContentText());
    if (j.code !== 'Ok' || !j.routes || !j.routes[0]) return null;
    const out = j.routes[0].geometry.coordinates.map(c => [Math.round(c[1] * 1e6) / 1e6, Math.round(c[0] * 1e6) / 1e6, null, null]);
    if (out.length < 2) return null;
    const raw = pathKm_(pts), sn = pathKm_(out);
    if (raw > 0 && sn > raw * 2.5) return null; // 大回りしすぎるものは採用しない
    return { points: out };
  } catch (e) { return null; }
}
function routeFromImage_(req, u) {
  if (!req.data) err_('VALID', '画像がありません');
  const mime = /^image\//.test(String(req.mimeType || '')) ? req.mimeType : 'image/jpeg';
  const W = Number(req.width) || 1000, H = Number(req.height) || 1000;
  const prompt = [
    'この画像は、サイクリングやドライブの記録アプリのアクティビティマップ（経路の線が描かれた地図）のスクリーンショットです。',
    '画像を読み取り、次のJSONだけを返してください。',
    '{',
    ' "name": "経路の名前（地名から短く。例：多摩川サイクリング）",',
    ' "directionKnown": スタートとゴールが画像から判別できれば true、できなければ false,',
    ' "landmarks": [ {"name":"地図上に文字で書かれた地名・駅名・山名など", "lat":緯度, "lng":経度, "x":画像上の横位置, "y":画像上の縦位置} ],',
    ' "line": [[x,y],[x,y], ...],',
    ' "waypoints": ["線が通る順の主な地名"]',
    '}',
    '・x, y は画像の左上を(0,0)、右下を(1000,1000)とした整数。',
    '・landmarks は地図に印刷されている地名のうち、位置が正確に分かるものを3〜8個。緯度経度はあなたの知識による実在の位置。地名の文字の中心ではなく、その地点（駅・交差点・山頂など）の位置を x, y にする。',
    '・line は経路の線を、スタートからゴールの順に60〜150点でなぞる。往復や周回もそのまま。分からなければスタートらしい端から。',
    '・地名が読めない場合は landmarks を空配列に。'
  ].join('\n');
  const txt = gemini_([{ text: prompt }, { inline_data: { mime_type: mime, data: String(req.data) } }], { json: true, temperature: 0.2 });
  let j;
  try { j = JSON.parse(txt.replace(/```json|```/g, '').trim()); } catch (e) { err_('AI', '画像の読み取り結果を解釈できませんでした。別の画像でお試しください'); }
  const lm = (j.landmarks || []).filter(l => isFinite(+l.lat) && isFinite(+l.lng) && isFinite(+l.x) && isFinite(+l.y) && Math.abs(+l.lat) <= 90 && Math.abs(+l.lng) <= 180)
    .map(l => ({ name: str_(l.name, 40), lat: +l.lat, lng: +l.lng, px: +l.x * W / 1000, py: +l.y * H / 1000 }));
  const line = (j.line || []).filter(p => Array.isArray(p) && isFinite(+p[0]) && isFinite(+p[1])).map(p => [+p[0] * W / 1000, +p[1] * H / 1000]);
  const waypoints = (j.waypoints || []).map(w => str_(w, 40)).filter(Boolean).slice(0, 20);
  let points = null, method = 'line';

  if (lm.length >= 2 && line.length >= 2) {
    let use = lm.slice();
    let tf = null;
    if (use.length >= 3) {
      tf = fitAffine_(use.map(l => [l.px, l.py]), use.map(l => merc_(l.lat, l.lng)));
      // 外れ値を除いて当てはめ直す
      for (let k = 0; tf && use.length > 3 && k < 3; k++) {
        const errs = use.map(l => { const p = tf([l.px, l.py]); const ll = unmerc_(p[0], p[1]); return hav_(ll, [l.lat, l.lng]); });
        const med = errs.slice().sort((a, b) => a - b)[Math.floor(errs.length / 2)];
        const worst = errs.indexOf(Math.max.apply(null, errs));
        if (errs[worst] <= Math.max(1, med * 3)) break;
        use.splice(worst, 1);
        tf = fitAffine_(use.map(l => [l.px, l.py]), use.map(l => merc_(l.lat, l.lng)));
      }
    }
    if (!tf) {
      let best = null, bd = -1;
      for (let i = 0; i < lm.length; i++) for (let k = i + 1; k < lm.length; k++) {
        const d = Math.hypot(lm[i].px - lm[k].px, lm[i].py - lm[k].py);
        if (d > bd) { bd = d; best = [lm[i], lm[k]]; }
      }
      if (best) tf = fitSimilar_(best.map(l => [l.px, l.py]), best.map(l => merc_(l.lat, l.lng)));
    }
    if (tf) {
      points = line.map(p => { const m = tf(p); const ll = unmerc_(m[0], m[1]); return [Math.round(ll[0] * 1e6) / 1e6, Math.round(ll[1] * 1e6) / 1e6, null, null]; });
      const km = pathKm_(points);
      if (!(km > 0.05 && km < 3000) || points.some(p => !isFinite(p[0]) || !isFinite(p[1]))) points = null;
    }
  }
  if (!points) {
    method = 'waypoints';
    let seq = [];
    if (waypoints.length >= 2) {
      waypoints.forEach(w => { const l = lm.filter(x => x.name === w)[0]; if (l) seq.push(l); });
    }
    if (seq.length < 2) seq = lm.slice().sort((a, b) => {
      const ia = line.length ? nearestIdx_(line, a) : 0, ib = line.length ? nearestIdx_(line, b) : 0;
      return ia - ib;
    });
    if (seq.length < 2) err_('AI', '画像から地名や経路を十分に読み取れませんでした。地名がいくつか写っている画像でお試しください');
    points = seq.map(l => [l.lat, l.lng, null, null]);
  }
  const snapped = snapOsrm_(points, req.tripType);
  return { name: str_(j.name, 80) || '画像から読み取った経路', method: method, waypoints: waypoints.length ? waypoints : lm.map(l => l.name),
    directionKnown: !!j.directionKnown, points: points, snapped: snapped };
}
function nearestIdx_(line, l) {
  let bi = 0, bd = Infinity;
  line.forEach((p, i) => { const d = Math.hypot(p[0] - l.px, p[1] - l.py); if (d < bd) { bd = d; bi = i; } });
  return bi;
}

/* ============================================================
 * 外部URLのルートファイル取得（ブラウザから読めない場合の代理）
 * ============================================================ */
function fetchRemote_(req) {
  const url = String(req.url || '').trim();
  if (!/^https?:\/\/[^\s]+$/i.test(url)) err_('VALID', 'http(s) で始まるURLを入力してください');
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'wadachi-log/' + SERVER_VERSION } });
  if (res.getResponseCode() >= 400) err_('FETCH', 'URLを読み込めませんでした（' + res.getResponseCode() + '）');
  const blob = res.getBlob();
  if (blob.getBytes().length > 15 * 1048576) err_('FETCH', 'ファイルが大きすぎます（15MBまで）');
  return { text: blob.getDataAsString('UTF-8') };
}
