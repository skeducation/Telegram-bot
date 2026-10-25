const BOT = process.env.BOT_TOKEN;
const DB = (process.env.FIREBASE_URL || '').replace(/\/$/, '');
const AUTH = process.env.FIREBASE_SECRET ? `?auth=${process.env.FIREBASE_SECRET}` : '';

const ADMINS = [process.env.ADMIN_1, process.env.ADMIN_2]
  .filter(Boolean)
  .map((x) => String(x).trim());

async function tg(method, params = {}) {
  const r = await fetch(`https://api.telegram.org/bot${BOT}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return r.json();
}

async function dbGet(path) {
  const r = await fetch(`${DB}/${path}.json${AUTH}`);
  return r.json();
}
async function dbSet(path, value) {
  await fetch(`${DB}/${path}.json${AUTH}`, { method: 'PUT', body: JSON.stringify(value) });
}
async function dbDel(path) {
  await fetch(`${DB}/${path}.json${AUTH}`, { method: 'DELETE' });
}

const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { tg, dbGet, dbSet, dbDel, ADMINS, esc, sleep };
