const { tg, dbGet, dbSet, dbDel, ADMINS, esc, sleep } = require('./_lib');

const isAdmin = (id) => ADMINS.includes(String(id));
let BOT_USERNAME = null;
const ADMIN_HELP =
  '👑 <b>Admin Panel</b>\n\n' +
  '/newlink - multi-file share link banao\n' +
  '/donefiles - files collection finish karo\n' +
  '/done - channels ke baad link generate karo\n' +
  '/addchannel - channel add karo (forward post ya link)\n' +
  '/channels - saved channels dekho\n' +
  '/removechannel - saved channel remove karo\n' +
  '/links - share links dekho\n' +
  '/search WORD - links search karo\n' +
  '/dellink CODE - link delete\n' +
  '/broadcast - abhi broadcast bhejo\n' +
  '/schedule - future broadcast schedule karo\n' +
  '/stats - detailed statistics\n' +
  '/cancel - current process cancel';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('Bot is running');
  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) return res.status(401).end();
  try {
    const u = req.body || {};
    if (u.message) await onMessage(u.message);
    else if (u.channel_post) await onChannelPost(u.channel_post);
    else if (u.callback_query) await onCallback(u.callback_query);
  } catch (e) { console.error('Webhook error:', e); }
  return res.status(200).send('ok');
};

async function botName() {
  if (!BOT_USERNAME) { const r = await tg('getMe'); BOT_USERNAME = r.result.username; }
  return BOT_USERNAME;
}
const say = (chat_id, text, extra = {}) => tg('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
const userMenu = (admin = false, lang = 'hi') => ({ reply_markup: { inline_keyboard: [
  [{ text: lang === 'en' ? '🔎 Search Links' : '🔎 लिंक खोजें', callback_data: 'menu:search' }, { text: lang === 'en' ? '🕘 Recent' : '🕘 हाल के', callback_data: 'menu:recent' }],
  [{ text: lang === 'en' ? '⭐ Favorites' : '⭐ पसंदीदा', callback_data: 'menu:favs' }, { text: lang === 'en' ? '❓ Help' : '❓ मदद', callback_data: 'menu:help' }],
  [{ text: lang === 'en' ? '🌐 Language' : '🌐 भाषा', callback_data: 'menu:language' }],
  ...(admin ? [[{ text: '👑 Admin Panel', callback_data: 'menu:admin' }]] : [])
] } });

function extract(m) {
  const caption = m.caption || '';
  if (m.document) return { type: 'document', file_id: m.document.file_id, caption, name: m.document.file_name || '' };
  if (m.video) return { type: 'video', file_id: m.video.file_id, caption, name: m.video.file_name || '' };
  if (m.animation) return { type: 'animation', file_id: m.animation.file_id, caption, name: m.animation.file_name || '' };
  if (m.audio) return { type: 'audio', file_id: m.audio.file_id, caption, name: m.audio.file_name || '' };
  if (m.voice) return { type: 'voice', file_id: m.voice.file_id, caption };
  if (m.video_note) return { type: 'video_note', file_id: m.video_note.file_id };
  if (m.photo) return { type: 'photo', file_id: m.photo[m.photo.length - 1].file_id, caption };
  if (m.text && !m.text.startsWith('/')) return { type: 'text', text: m.text };
  return null;
}
async function sendContent(chat_id, c) {
  const caption = c.caption || undefined;
  switch (c.type) {
    case 'text': return tg('sendMessage', { chat_id, text: c.text, disable_web_page_preview: false });
    case 'document': return tg('sendDocument', { chat_id, document: c.file_id, caption });
    case 'video': return tg('sendVideo', { chat_id, video: c.file_id, caption });
    case 'animation': return tg('sendAnimation', { chat_id, animation: c.file_id, caption });
    case 'audio': return tg('sendAudio', { chat_id, audio: c.file_id, caption });
    case 'voice': return tg('sendVoice', { chat_id, voice: c.file_id, caption });
    case 'video_note': return tg('sendVideoNote', { chat_id, video_note: c.file_id });
    case 'photo': return tg('sendPhoto', { chat_id, photo: c.file_id, caption });
    default: return { ok: false, description: 'Unsupported content type' };
  }
}
function contentList(link) { return Array.isArray(link.contents) ? link.contents : (link.content ? [link.content] : []); }
function dayKey() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
async function recordOpen(code, uid) {
  const link = await dbGet('links/' + code); if (!link) return;
  await dbSet('links/' + code + '/views', (link.views || 0) + 1);
  const d = dayKey();
  const daily = (await dbGet('analytics/days/' + d)) || { opens: 0, links: {} };
  daily.opens = (daily.opens || 0) + 1; daily.links = daily.links || {};
  daily.links[code] = (daily.links[code] || 0) + 1;
  await dbSet('analytics/days/' + d, daily);
  const user = (await dbGet('users/' + uid)) || {};
  const recent = Array.isArray(user.recent) ? user.recent.filter(x => x !== code) : [];
  recent.unshift(code); user.recent = recent.slice(0, 15); user.lastSeen = Date.now();
  await dbSet('users/' + uid, user);
}
async function missing(uid, link) {
  const chans = link.channels || [];
  const results = await Promise.all(chans.map(async ch => {
    const r = await tg('getChatMember', { chat_id: ch.id, user_id: Number(uid) });
    const s = r.ok && r.result.status;
    const ok = ['member', 'administrator', 'creator'].includes(s) || (s === 'restricted' && r.result.is_member);
    return ok ? null : ch;
  }));
  return results.filter(Boolean);
}
async function deliver(chatId, uid, code) {
  const link = await dbGet('links/' + code);
  if (!link) return say(chatId, '❌ Ye link invalid hai ya delete ho chuka hai.');
  if (link.disabled) return say(chatId, '⛔ Ye share link abhi disabled hai.');
  if (link.expiresAt && Date.now() > link.expiresAt) return say(chatId, '⌛ Is link ki expiry ho chuki hai.');
  if (link.maxViews && (link.views || 0) >= link.maxViews) return say(chatId, '⛔ Is link ki usage limit poori ho chuki hai.');
  const miss = await missing(uid, link);
  if (miss.length) {
    const kb = miss.map(ch => [{ text: '📢 Join ' + (ch.title || 'Channel'), url: ch.link }]);
    kb.push([{ text: '✅ Maine Join Kar Liya', callback_data: 'chk:' + code }]);
    return say(chatId, '⚠️ Content paane ke liye pahle neeche ke channel join karo, phir <b>Maine Join Kar Liya</b> dabao.', { reply_markup: { inline_keyboard: kb } });
  }
  if (link.title || link.description) await say(chatId, `📦 <b>${esc(link.title || 'Shared content')}</b>${link.description ? '\n' + esc(link.description) : ''}`);
  const contents = contentList(link);
  for (const c of contents) await sendContent(chatId, c);
  await recordOpen(code, uid);
  await say(chatId, '🔗 Link options:', { reply_markup: { inline_keyboard: [[{ text: '⭐ Add to Favorites', callback_data: 'fav:' + code }]] } });
}
async function onCallback(q) {
  const data = q.data || ''; const uid = String(q.from.id); const chatId = q.message && q.message.chat.id;
  if (data.startsWith('chk:')) {
    const code = data.slice(4); const link = await dbGet('links/' + code);
    if (!link) return tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Link invalid hai', show_alert: true });
    const miss = await missing(uid, link);
    if (miss.length) return tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Abhi bhi ' + miss.length + ' channel join karna baaki hai.', show_alert: true });
    await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Membership verified' });
    await tg('deleteMessage', { chat_id: chatId, message_id: q.message.message_id });
    return deliver(chatId, uid, code);
  }
  if (data.startsWith('fav:')) {
    const code = data.slice(4); const favs = (await dbGet('users/' + uid + '/favorites')) || [];
    const has = favs.includes(code); const next = has ? favs.filter(x => x !== code) : [...favs, code];
    await dbSet('users/' + uid + '/favorites', next);
    return tg('answerCallbackQuery', { callback_query_id: q.id, text: has ? 'Favorites se hata diya' : '⭐ Favorites mein add ho gaya' });
  }
  if (data.startsWith('open:')) { await tg('answerCallbackQuery', { callback_query_id: q.id }); return deliver(chatId, uid, data.slice(5)); }
  if (data.startsWith('adminlink:') && isAdmin(uid)) {
    const code = data.slice(10); const link = await dbGet('links/' + code);
    if (!link) return tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Link nahi mila', show_alert: true });
    await tg('answerCallbackQuery', { callback_query_id: q.id });
    return say(chatId, `📦 <b>${esc(link.title || code)}</b>\nCode: <code>${esc(code)}</code>\nViews: ${link.views || 0}\nStatus: ${link.disabled ? 'Disabled' : 'Active'}\n/disablelink ${code} ya /enablelink ${code}`);
  }
  if (data.startsWith('menu:')) {
    await tg('answerCallbackQuery', { callback_query_id: q.id });
    const action = data.slice(5);
    if (action === 'search') return say(chatId, '🔎 Search ke liye /search WORD likho.');
    if (action === 'language') return say(chatId, '🌐 Language choose karo:\n/language hi — Hindi/Hinglish\n/language en — English');
    if (action === 'recent') return showUserLinks(chatId, uid, 'recent');
    if (action === 'favs') return showUserLinks(chatId, uid, 'favorites');
    if (action === 'admin' && isAdmin(uid)) return say(chatId, ADMIN_HELP);
    if (action === 'help') return say(chatId, '👋 Share link se files paao. /menu se options kholo.');
  }
  return tg('answerCallbackQuery', { callback_query_id: q.id });
}
async function showUserLinks(chatId, uid, type) {
  const user = (await dbGet('users/' + uid)) || {};
  const codes = type === 'recent' ? (user.recent || []) : (user.favorites || []);
  if (!codes.length) return say(chatId, type === 'recent' ? 'Abhi recent links nahi hain.' : 'Favorites khali hain.');
  const rows = [];
  for (const code of codes.slice(0, 15)) {
    const l = await dbGet('links/' + code);
    if (l && !l.disabled) rows.push([{ text: (type === 'recent' ? '🕘 ' : '⭐ ') + (l.title || code).slice(0, 55), callback_data: 'open:' + code }]);
  }
  return say(chatId, type === 'recent' ? '🕘 <b>Recent links</b>' : '⭐ <b>Favorites</b>', { reply_markup: { inline_keyboard: rows.length ? rows : [[{ text: 'No active links', callback_data: 'menu:help' }]] } });
}
async function onChannelPost(m) {
  if (!m.chat || !['channel', 'supergroup'].includes(m.chat.type)) return;
  await registerChannel(m.chat, null, false);
}
async function registerChannel(chat, adminChat, announce = true, suppliedInvite = null) {
  const channels = (await dbGet('global_channels')) || {};
  const id = String(chat.id);
  if (channels[id]) return channels[id];
  let link = suppliedInvite || (chat.username ? 'https://t.me/' + chat.username : '');
  if (!link) {
    const ex = await tg('exportChatInviteLink', { chat_id: chat.id });
    if (ex.ok) link = ex.result;
  }
  const entry = { id: chat.id, title: chat.title || 'Channel', link, username: chat.username || '', addedAt: Date.now() };
  channels[id] = entry; await dbSet('global_channels', channels);
  if (announce && adminChat) await say(adminChat, `✅ Channel auto-detect ho gaya: <b>${esc(entry.title)}</b>\nLink: ${esc(entry.link || 'Invite link unavailable')}\nAb /newlink mein default channel ke roop mein use hoga.`);
  return entry;
}
async function addChannel(chatId, uid, st, chans, chatRef, inviteLink) {
  const info = await tg('getChat', { chat_id: chatRef });
  if (!info.ok) return say(chatId, '❌ Channel nahi mila. Bot ko channel mein admin banao aur channel ka post forward karo ya public link bhejo.');
  const chat = info.result;
  const me = await tg('getMe');
  const mem = await tg('getChatMember', { chat_id: chat.id, user_id: me.result.id });
  if (!mem.ok || !['administrator', 'creator'].includes(mem.result.status)) return say(chatId, '❌ Bot is channel mein admin nahi hai. Pahle admin banao.');
  let link = inviteLink || st.pendingInvite || (chat.username ? 'https://t.me/' + chat.username : '');
  if (!link) { const ex = await tg('exportChatInviteLink', { chat_id: chat.id }); if (ex.ok) link = ex.result; }
  const ch = { id: chat.id, title: chat.title || 'Channel', link };
  if (st.step === 'addchannel') {
    await registerChannel(chat, chatId, false, st.pendingInvite || link);
    return say(chatId, `➕ Global channel add ho gaya: <b>${esc(ch.title)}</b>\nLink: ${esc(link || 'Invite link unavailable')}\nAb ye naye share links ke liye default hoga.`);
  }
  if (chans.some(c => String(c.id) === String(chat.id))) return say(chatId, 'ℹ️ Ye channel pahle se add hai.');
  chans.push(ch); await dbSet('state/' + uid, { ...st, step: 'channels', channels: chans });
  return say(chatId, `➕ Added: <b>${esc(ch.title)}</b> (total ${chans.length})\n\nAur channel bhejo ya /done dabao.`);
}
function getForwardedChat(m) {
  return (m.forward_origin && m.forward_origin.chat) || m.forward_from_chat || null;
}
async function onMessage(m) {
  if (m.chat.type !== 'private') return;
  const uid = String(m.from.id); const chatId = m.chat.id; const text = (m.text || '').trim();
  if (text.startsWith('/start')) {
    const old = (await dbGet('users/' + uid)) || {};
    await dbSet('users/' + uid, { ...old, name: m.from.first_name || '', username: m.from.username || '', t: old.t || Date.now(), lastSeen: Date.now() });
    const p = text.split(/\s+/)[1]; if (p) return deliver(chatId, uid, p);
    const en = old.lang === 'en';
    return say(chatId, isAdmin(uid) ? '👋 Welcome Admin! Neeche menu hai.\n\n' + ADMIN_HELP : (en ? '👋 Welcome! Open a share link to receive files. Use the menu for recent links and favorites.' : '👋 Welcome! Share link se files paao. Menu se recent links aur favorites bhi dekh sakte ho.'), userMenu(isAdmin(uid), old.lang || 'hi'));
  }
  if (text === '/menu') return say(chatId, '📋 <b>Main Menu</b>', userMenu(isAdmin(uid)));
  if (text === '/recent') return showUserLinks(chatId, uid, 'recent');
  if (text === '/favorites') return showUserLinks(chatId, uid, 'favorites');
  if (text.startsWith('/search')) return searchLinks(chatId, text.split(/\s+/).slice(1).join(' '), isAdmin(uid));
  if (text.startsWith('/language')) {
    const lang = (text.split(/\s+/)[1] || '').toLowerCase();
    if (!['hi', 'en'].includes(lang)) return say(chatId, 'Language choose karo: /language hi ya /language en');
    const user = (await dbGet('users/' + uid)) || {}; user.lang = lang; await dbSet('users/' + uid, user);
    return say(chatId, lang === 'hi' ? 'भाषा हिंदी/हिंग्लिश पर सेट हो गई।' : 'Language set to English.', userMenu(isAdmin(uid), lang));
  }
  if (!isAdmin(uid)) return say(chatId, 'Commands ke liye /menu use karo.');
  const parts = text.split(/\s+/); const cmd = (parts[0] || '').split('@')[0].toLowerCase(); const arg = parts.slice(1).join(' ');
  if (cmd === '/cancel') { await dbDel('state/' + uid); return say(chatId, '✖️ Cancel ho gaya.'); }
  if (cmd === '/help') return say(chatId, ADMIN_HELP);
  if (cmd === '/newlink') {
    const global = (await dbGet('global_channels')) || {};
    await dbSet('state/' + uid, { step: 'collect', contents: [], channels: Object.values(global).map(c => ({ id: c.id, title: c.title, link: c.link })) });
    return say(chatId, '📎 <b>Files / links bhejo</b> — ek ya multiple items. Har item add hota jayega.\n\nFinish karne ke liye /donefiles bhejo. Cancel: /cancel');
  }
  if (cmd === '/donefiles') {
    const st = await dbGet('state/' + uid); if (!st || st.step !== 'collect' || !(st.contents || []).length) return say(chatId, 'Pahle /newlink se shuru karke kam se kam ek file/text bhejo.');
    await dbSet('state/' + uid, { ...st, step: 'title' });
    return say(chatId, `✅ ${st.contents.length} item(s) add hue.\nAb link ka title bhejo, ya /skip.`);
  }
  if (cmd === '/stats') {
    const users = (await dbGet('users')) || {}; const links = (await dbGet('links')) || {}; const days = (await dbGet('analytics/days')) || {};
    const totalViews = Object.values(links).reduce((n, l) => n + (l.views || 0), 0);
    const today = days[dayKey()] || { opens: 0 };
    return say(chatId, `📊 <b>Bot Statistics</b>\nUsers: <b>${Object.keys(users).length}</b>\nShare links: <b>${Object.keys(links).length}</b>\nTotal opens: <b>${totalViews}</b>\nToday's opens: <b>${today.opens || 0}</b>\nSaved channels: <b>${Object.keys((await dbGet('global_channels')) || {}).length}</b>`);
  }
  if (cmd === '/done') {
    const st = await dbGet('state/' + uid);
    if (!st || st.step !== 'channels') return say(chatId, 'Pahle /newlink se shuru karo aur files ke baad /donefiles dabao.');
    let code = st.customCode || Math.random().toString(36).slice(2, 10);
    if (await dbGet('links/' + code)) return say(chatId, 'Ye custom code pehle se use hai. /cancel karke naya link banao.');
    const link = { title: st.title || 'Shared content', description: st.description || '', contents: st.contents || (st.content ? [st.content] : []), channels: st.channels || [], created: Date.now(), by: uid, views: 0, disabled: false };
    if (st.expiryHours) link.expiresAt = Date.now() + st.expiryHours * 3600000;
    if (st.maxViews) link.maxViews = st.maxViews;
    await dbSet('links/' + code, link); await dbDel('state/' + uid);
    const bot = await botName();
    return say(chatId, `✅ <b>Share link ready!</b>\n📦 ${esc(link.title)}\nhttps://t.me/${bot}?start=${code}\nItems: ${link.contents.length} | Channels: ${link.channels.length}${link.expiresAt ? '\nExpiry: ' + new Date(link.expiresAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : ''}${link.maxViews ? '\nMax opens: ' + link.maxViews : ''}`);
  }
  if (cmd === '/removechannel') {
    if (!arg) { await dbSet('state/' + uid, { step: 'removechannel' }); return say(chatId, 'Remove karne ke liye channel ID bhejo. /cancel se ruk sakte ho.'); }
    const ch = (await dbGet('global_channels')) || {}; delete ch[arg.trim()]; await dbSet('global_channels', ch); return say(chatId, '🗑 Channel global list se remove ho gaya. Purane links par channel setting alag rahegi.');
  }
  if (cmd === '/links') {
    const links = (await dbGet('links')) || {}; const bot = await botName(); const keys = Object.keys(links).slice(-30);
    if (!keys.length) return say(chatId, 'Abhi koi link nahi hai.');
    return say(chatId, keys.map(k => `${links[k].disabled ? '⛔' : '🔗'} <b>${esc(links[k].title || k)}</b> — ${links[k].views || 0} views\nhttps://t.me/${bot}?start=${k}\nCode: <code>${esc(k)}</code>`).join('\n\n'));
  }
  if (cmd === '/dellink') { if (!arg) return say(chatId, 'Use: /dellink CODE'); await dbDel('links/' + arg.trim()); return say(chatId, '🗑 Link delete kar diya.'); }
  if (cmd === '/disablelink' || cmd === '/enablelink') {
    const code = arg.trim(); const link = await dbGet('links/' + code); if (!link) return say(chatId, 'Link nahi mila.');
    await dbSet('links/' + code + '/disabled', cmd === '/disablelink'); return say(chatId, cmd === '/disablelink' ? '⛔ Link disabled.' : '✅ Link enabled.');
  }
  if (cmd === '/addchannel') { await dbSet('state/' + uid, { step: 'addchannel' }); return say(chatId, '➕ Channel ka koi post forward karo, ya public channel link/@username bhejo. Bot us channel mein admin hona chahiye.'); }
  if (cmd === '/channels') {
    const channels = (await dbGet('global_channels')) || {}; const vals = Object.values(channels);
    if (!vals.length) return say(chatId, 'Saved channels nahi hain. /addchannel se add karo.');
    return say(chatId, '📢 <b>Saved channels</b>\n\n' + vals.map(c => `• ${esc(c.title)}\n${esc(c.link || 'Invite link unavailable')}\nID: <code>${c.id}</code>`).join('\n\n') + '\n\nRemove ke liye /removechannel CHANNEL_ID');
  }
  if (cmd === '/broadcast') { await dbSet('state/' + uid, { step: 'broadcast' }); return say(chatId, '📣 Ab broadcast message bhejo (text/photo/video/document). Cancel: /cancel'); }
  if (cmd === '/schedule') { await dbSet('state/' + uid, { step: 'schedule_content' }); return say(chatId, '🗓 Schedule ke liye message (text/photo/video/document) bhejo. Uske baad date/time Asia/Kolkata mein YYYY-MM-DD HH:mm format mein dena.'); }
  if (cmd === '/search') return searchLinks(chatId, arg, true);

  const st = await dbGet('state/' + uid); if (!st) return say(chatId, ADMIN_HELP);
  const forwarded = getForwardedChat(m);
  if (st.step === 'addchannel') {
    if (forwarded) return addChannel(chatId, uid, st, [], forwarded.id, null);
    const ref = parseChannelRef(text); if (!ref) return say(chatId, 'Channel post forward karo ya public t.me/username bhejo.');
    if (ref.private) { await dbSet('state/' + uid, { step: 'addchannel', pendingInvite: ref.link }); return say(chatId, 'Private channel ka post forward karo, taki channel ID mil sake.'); }
    return addChannel(chatId, uid, st, [], ref.ref, ref.link);
  }
  if (st.step === 'collect') {
    const c = extract(m); if (!c) return say(chatId, 'Ye item supported nahi. Photo, video, audio, voice, document ya text bhejo. Finish: /donefiles');
    const contents = [...(st.contents || []), c]; await dbSet('state/' + uid, { ...st, contents });
    return say(chatId, `✅ Item ${contents.length} add hua. Aur bhejo ya /donefiles dabao.`);
  }
  if (st.step === 'title') {
    const title = text === '/skip' ? 'Shared content' : text;
    if (!title || title.startsWith('/')) return say(chatId, 'Title bhejo ya /skip likho.');
    await dbSet('state/' + uid, { ...st, title: title.slice(0, 100), step: 'description' }); return say(chatId, 'Description bhejo, ya /skip.');
  }
  if (st.step === 'description') {
    const description = text === '/skip' ? '' : text.slice(0, 500);
    await dbSet('state/' + uid, { ...st, description, step: 'customcode' });
    return say(chatId, 'Custom link code chahiye to bhejo (letters/numbers/_/-), warna /skip.');
  }
  if (st.step === 'customcode') {
    const customCode = text === '/skip' ? '' : text.toLowerCase();
    if (customCode && !/^[a-z0-9_-]{3,32}$/.test(customCode)) return say(chatId, 'Code 3-32 characters ka ho: letters, numbers, _ ya -. Ya /skip.');
    if (customCode && await dbGet('links/' + customCode)) return say(chatId, 'Ye code pehle se use hai. Dusra code bhejo ya /skip.');
    await dbSet('state/' + uid, { ...st, customCode, step: 'expiry' });
    return say(chatId, 'Link expiry hours mein bhejo (jaise 24), ya kabhi expire na ho to /skip.');
  }
  if (st.step === 'expiry') {
    const hours = text === '/skip' ? 0 : Number(text);
    if (text !== '/skip' && (!Number.isFinite(hours) || hours < 1 || hours > 8760)) return say(chatId, '1 se 8760 hours tak number bhejo, ya /skip.');
    await dbSet('state/' + uid, { ...st, expiryHours: hours, step: 'maxviews' });
    return say(chatId, 'Optional maximum opens/views number bhejo (jaise 100), unlimited ke liye /skip.');
  }
  if (st.step === 'maxviews') {
    const maxViews = text === '/skip' ? 0 : Number(text);
    if (text !== '/skip' && (!Number.isInteger(maxViews) || maxViews < 1 || maxViews > 10000000)) return say(chatId, 'Positive whole number bhejo ya /skip.');
    await dbSet('state/' + uid, { ...st, maxViews, step: 'channels' });
    const list = (st.channels || []).map(c => c.title).join(', ');
    return say(chatId, `📝 Details save.\nDefault channels: ${list ? esc(list) : 'none'}\n\nAur channel add karne ke liye public link bhejo ya private channel post forward karo. Link ready karne ke liye /done.`);
  }

  if (st.step === 'channels') {
    const chans = st.channels || [];
    if (forwarded) return addChannel(chatId, uid, st, chans, forwarded.id, null);
    const ref = parseChannelRef(text);
    if (!ref) return say(chatId, 'Channel link (@username ya t.me/username) bhejo, channel post forward karo, ya /done.');
    if (ref.private) { await dbSet('state/' + uid, { ...st, pendingInvite: ref.link }); return say(chatId, '🔒 Private channel ke liye ab us channel ka koi post forward karo.'); }
    return addChannel(chatId, uid, st, chans, ref.ref, ref.link);
  }
  if (st.step === 'broadcast') { await dbDel('state/' + uid); return broadcast(chatId, chatId, m.message_id); }
  if (st.step === 'schedule_content') {
    const c = extract(m); if (!c) return say(chatId, 'Text, photo, video ya document bhejo.');
    await dbSet('state/' + uid, { step: 'schedule_time', messageId: m.message_id, adminChat: chatId, preview: c });
    return say(chatId, '🕒 Send time: YYYY-MM-DD HH:mm (India time). Example: 2026-12-31 18:30');
  }
  if (st.step === 'schedule_time') {
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
    if (!match) return say(chatId, 'Format galat hai. YYYY-MM-DD HH:mm bhejo, jaise 2026-12-31 18:30.');
    const [, y, mo, d, h, mi] = match; const at = new Date(`${y}-${mo}-${d}T${h}:${mi}:00+05:30`).getTime();
    if (!Number.isFinite(at) || at < Date.now() + 60000) return say(chatId, 'Time kam se kam 1 minute future ka hona chahiye.');
    const id = 'b' + Date.now().toString(36); await dbSet('scheduled_broadcasts/' + id, { id, at, adminChat: st.adminChat, messageId: st.messageId, createdBy: uid, createdAt: Date.now(), status: 'pending' });
    await dbDel('state/' + uid); return say(chatId, `🗓 Broadcast schedule ho gaya.\nID: <code>${id}</code>\nTime: ${esc(text)} IST\nVercel Cron har minute due jobs check karega.`);
  }
  if (st.step === 'removechannel') { const ch = (await dbGet('global_channels')) || {}; delete ch[text.trim()]; await dbSet('global_channels', ch); await dbDel('state/' + uid); return say(chatId, 'Channel remove kar diya.'); }
  return say(chatId, ADMIN_HELP);
}
function parseChannelRef(text) {
  if (!text) return null;
  const m = text.match(/(?:https?:\/\/)?t\.me\/(\+[\w-]+|joinchat\/[\w-]+|[A-Za-z0-9_]{4,})/i);
  if (m) { const part = m[1]; if (part.startsWith('+') || part.startsWith('joinchat')) return { private: true, link: 'https://t.me/' + part }; return { ref: '@' + part, link: 'https://t.me/' + part }; }
  const at = text.match(/^@([A-Za-z0-9_]{4,})$/); if (at) return { ref: '@' + at[1], link: 'https://t.me/' + at[1] };
  return null;
}
async function searchLinks(chatId, query, admin) {
  const q = (query || '').trim().toLowerCase(); if (!q) return say(chatId, '🔎 Search ke liye /search WORD likho.');
  const links = (await dbGet('links')) || {};
  const found = Object.entries(links).filter(([code, l]) => !l.disabled && [code, l.title, l.description].some(v => String(v || '').toLowerCase().includes(q)));
  if (!found.length) return say(chatId, 'Koi matching link nahi mila.');
  const rows = found.slice(0, 20).map(([code, l]) => [{ text: `${l.title || code} · ${l.views || 0} views`.slice(0, 60), callback_data: (admin ? 'adminlink:' : 'open:') + code }]);
  return say(chatId, `🔎 <b>Search results:</b> ${found.length}\n${admin ? 'Result select karke link details dekho.' : 'Result select karke link open karo.'}`, { reply_markup: { inline_keyboard: rows } });
}
async function broadcast(adminChat, fromChat, messageId) {
  const users = (await dbGet('users')) || {}; const ids = Object.keys(users);
  await say(adminChat, '📤 Broadcast shuru: ' + ids.length + ' users...');
  let ok = 0, fail = 0;
  for (let i = 0; i < ids.length; i += 20) {
    const batch = ids.slice(i, i + 20);
    const rs = await Promise.all(batch.map(id => tg('copyMessage', { chat_id: Number(id), from_chat_id: fromChat, message_id: messageId })));
    rs.forEach(r => r && r.ok ? ok++ : fail++); await sleep(1100);
  }
  return say(adminChat, `✅ <b>Broadcast complete</b>\nSent: <b>${ok}</b>\nFailed: <b>${fail}</b>`);
}
module.exports.broadcast = broadcast;
