const { tg, dbGet, dbSet, dbDel, ADMINS, esc, sleep } = require('./_lib');

const isAdmin = (id) => ADMINS.includes(String(id));
let BOT_USERNAME = null;

const ADMIN_HELP =
  '👑 <b>Admin Panel</b>\n\n' +
  '/newlink - naya share link banao\n' +
  '/done - channels add karne ke baad link generate karo\n' +
  '/cancel - current process cancel\n' +
  '/links - saare links dekho\n' +
  '/dellink CODE - link delete\n' +
  '/broadcast - sabhi users ko message bhejo\n' +
  '/stats - total users';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('Bot is running');
  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).end();
  }
  try {
    const u = req.body || {};
    if (u.message) await onMessage(u.message);
    else if (u.callback_query) await onCallback(u.callback_query);
  } catch (e) {
    console.error(e);
  }
  res.status(200).send('ok');
};

async function botName() {
  if (!BOT_USERNAME) {
    const r = await tg('getMe');
    BOT_USERNAME = r.result.username;
  }
  return BOT_USERNAME;
}

const say = (chat_id, text, extra = {}) =>
  tg('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });

/* ---------- content helpers ---------- */
function extract(m) {
  const caption = m.caption || '';
  if (m.document) return { type: 'document', file_id: m.document.file_id, caption };
  if (m.video) return { type: 'video', file_id: m.video.file_id, caption };
  if (m.audio) return { type: 'audio', file_id: m.audio.file_id, caption };
  if (m.photo) return { type: 'photo', file_id: m.photo[m.photo.length - 1].file_id, caption };
  if (m.text) return { type: 'text', text: m.text };
  return null;
}

function sendContent(chat_id, c) {
  const caption = c.caption || undefined;
  switch (c.type) {
    case 'text': return tg('sendMessage', { chat_id, text: c.text });
    case 'document': return tg('sendDocument', { chat_id, document: c.file_id, caption });
    case 'video': return tg('sendVideo', { chat_id, video: c.file_id, caption });
    case 'audio': return tg('sendAudio', { chat_id, audio: c.file_id, caption });
    case 'photo': return tg('sendPhoto', { chat_id, photo: c.file_id, caption });
  }
}

/* ---------- force-join check ---------- */
async function missing(uid, link) {
  const chans = link.channels || [];
  const results = await Promise.all(
    chans.map(async (ch) => {
      const r = await tg('getChatMember', { chat_id: ch.id, user_id: Number(uid) });
      const s = r.ok && r.result.status;
      const ok = ['member', 'administrator', 'creator'].includes(s) ||
        (s === 'restricted' && r.result.is_member);
      return ok ? null : ch;
    })
  );
  return results.filter(Boolean);
}

async function deliver(chatId, uid, code) {
  const link = await dbGet('links/' + code);
  if (!link) return say(chatId, '❌ Ye link invalid hai ya delete ho chuka hai.');
  const miss = await missing(uid, link);
  if (miss.length) {
    const kb = miss.map((ch) => [{ text: '📢 Join ' + ch.title, url: ch.link }]);
    kb.push([{ text: '✅ Maine Join Kar Liya', callback_data: 'chk:' + code }]);
    return say(chatId, '⚠️ Content paane ke liye pahle neeche ke channel join karo, phir <b>Maine Join Kar Liya</b> dabao.', {
      reply_markup: { inline_keyboard: kb },
    });
  }
  await sendContent(chatId, link.content);
  await dbSet('links/' + code + '/views', (link.views || 0) + 1);
}

async function onCallback(q) {
  const data = q.data || '';
  if (!data.startsWith('chk:')) return tg('answerCallbackQuery', { callback_query_id: q.id });
  const code = data.slice(4);
  const uid = q.from.id;
  const chatId = q.message.chat.id;
  const link = await dbGet('links/' + code);
  if (!link) return tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Link invalid hai', show_alert: true });
  const miss = await missing(uid, link);
  if (miss.length) {
    return tg('answerCallbackQuery', {
      callback_query_id: q.id,
      text: '❌ Abhi bhi ' + miss.length + ' channel join karna baaki hai.',
      show_alert: true,
    });
  }
  await tg('answerCallbackQuery', { callback_query_id: q.id });
  await tg('deleteMessage', { chat_id: chatId, message_id: q.message.message_id });
  await sendContent(chatId, link.content);
  await dbSet('links/' + code + '/views', (link.views || 0) + 1);
}

/* ---------- messages ---------- */
async function onMessage(m) {
  if (m.chat.type !== 'private') return;
  const uid = String(m.from.id);
  const chatId = m.chat.id;
  const text = (m.text || '').trim();

  if (text.startsWith('/start')) {
    await dbSet('users/' + uid, { name: m.from.first_name || '', t: Date.now() });
    const p = text.split(/\s+/)[1];
    if (p) return deliver(chatId, uid, p);
    return say(chatId, isAdmin(uid) ? ADMIN_HELP : '👋 Welcome! Kisi share link se aao to content mil jayega.');
  }

  if (!isAdmin(uid)) return;

  const parts = text.split(/\s+/);
  const cmd = parts[0].split('@')[0].toLowerCase();
  const arg = parts[1];

  if (cmd === '/cancel') { await dbDel('state/' + uid); return say(chatId, '✖️ Cancel ho gaya.'); }
  if (cmd === '/help') return say(chatId, ADMIN_HELP);

  if (cmd === '/newlink') {
    await dbSet('state/' + uid, { step: 'content' });
    return say(chatId, '📎 <b>Original file ya link</b> bhejo (document / video / photo / audio / text link).');
  }

  if (cmd === '/stats') {
    const users = (await dbGet('users')) || {};
    return say(chatId, '👥 Total users: <b>' + Object.keys(users).length + '</b>');
  }

  if (cmd === '/links') {
    const links = (await dbGet('links')) || {};
    const bot = await botName();
    const keys = Object.keys(links);
    if (!keys.length) return say(chatId, 'Abhi koi link nahi hai.');
    const out = keys.slice(-30).map((k) =>
      `• https://t.me/${bot}?start=${k}\n  channels: ${(links[k].channels || []).length} | views: ${links[k].views || 0}`
    ).join('\n');
    return say(chatId, out);
  }

  if (cmd === '/dellink') {
    if (!arg) return say(chatId, 'Use: /dellink CODE');
    await dbDel('links/' + arg);
    return say(chatId, '🗑 Delete ho gaya.');
  }

  if (cmd === '/broadcast') {
    await dbSet('state/' + uid, { step: 'broadcast' });
    return say(chatId, '📣 Ab wo message bhejo jo sabhi users ko bhejna hai (text / file / photo kuch bhi). Cancel ke liye /cancel.');
  }

  if (cmd === '/done') {
    const st = await dbGet('state/' + uid);
    if (!st || st.step !== 'channels') return say(chatId, 'Pahle /newlink se shuru karo.');
    const code = Math.random().toString(36).slice(2, 10);
    await dbSet('links/' + code, {
      content: st.content,
      channels: st.channels || [],
      created: Date.now(),
      by: uid,
      views: 0,
    });
    await dbDel('state/' + uid);
    const bot = await botName();
    const note = (st.channels || []).length ? '' : '\n⚠️ Koi channel add nahi kiya, isliye link seedha khulega.';
    return say(chatId, '✅ <b>Link ready:</b>\nhttps://t.me/' + bot + '?start=' + code + note);
  }

  /* ----- state based steps ----- */
  const st = await dbGet('state/' + uid);
  if (!st) return say(chatId, ADMIN_HELP);

  if (st.step === 'content') {
    const c = extract(m);
    if (!c) return say(chatId, '❌ Ye type supported nahi hai. File ya text link bhejo.');
    await dbSet('state/' + uid, { step: 'channels', content: c, channels: [] });
    return say(chatId, '✅ Original content save.\n\nAb <b>channel link</b> ek-ek karke bhejo (public: t.me/username, private: invite link bhejo phir us channel ka koi message forward karo).\n\nBot ko har channel me <b>admin</b> banana zaruri hai.\nSab ho jaye to /done dabao.');
  }

  if (st.step === 'broadcast') {
    await dbDel('state/' + uid);
    return broadcast(chatId, m.message_id);
  }

  if (st.step === 'channels') {
    const chans = st.channels || [];

    // forwarded message from a channel (private channel case)
    const fwd = (m.forward_origin && m.forward_origin.chat) || m.forward_from_chat;
    if (fwd) {
      return addChannel(chatId, uid, st, chans, fwd.id, st.pendingInvite || null);
    }

    const tm = text.match(/(?:https?:\/\/)?t\.me\/(\+[\w-]+|joinchat\/[\w-]+|[A-Za-z0-9_]{4,})/i) ||
      text.match(/^@([A-Za-z0-9_]{4,})$/);
    if (!tm) return say(chatId, '❌ Channel link samajh nahi aaya. t.me/username ya invite link bhejo.');

    const part = tm[1];
    if (part.startsWith('+') || part.startsWith('joinchat')) {
      await dbSet('state/' + uid, { ...st, channels: chans, pendingInvite: 'https://t.me/' + part });
      return say(chatId, '🔒 Private channel hai. Ab us channel ka <b>koi bhi message forward</b> karo taki main ID nikal sakun.');
    }
    return addChannel(chatId, uid, st, chans, '@' + part, 'https://t.me/' + part);
  }
}

async function addChannel(chatId, uid, st, chans, chatRef, inviteLink) {
  const info = await tg('getChat', { chat_id: chatRef });
  if (!info.ok) return say(chatId, '❌ Channel nahi mila. Bot ko channel me admin banao aur dubara bhejo.');
  const chat = info.result;
  // check bot has access
  const me = await tg('getMe');
  const mem = await tg('getChatMember', { chat_id: chat.id, user_id: me.result.id });
  if (!mem.ok || !['administrator', 'creator'].includes(mem.result.status)) {
    return say(chatId, '❌ Bot is channel me admin nahi hai. Pahle admin banao, phir dubara bhejo.');
  }
  let link = inviteLink;
  if (!link) {
    if (chat.username) link = 'https://t.me/' + chat.username;
    else {
      const ex = await tg('exportChatInviteLink', { chat_id: chat.id });
      if (!ex.ok) return say(chatId, '❌ Invite link nahi ban paya. Bot ko "Invite users" permission do.');
      link = ex.result;
    }
  }
  if (chans.some((c) => String(c.id) === String(chat.id))) {
    return say(chatId, 'ℹ️ Ye channel pahle se add hai.');
  }
  chans.push({ id: chat.id, title: chat.title || 'Channel', link });
  await dbSet('state/' + uid, { step: 'channels', content: st.content, channels: chans });
  return say(chatId, '➕ Added: <b>' + esc(chat.title) + '</b> (total ' + chans.length + ')\n\nAur channel bhejo ya /done dabao.');
}

async function broadcast(adminChat, messageId) {
  const users = (await dbGet('users')) || {};
  const ids = Object.keys(users);
  await say(adminChat, '📤 Broadcast shuru: ' + ids.length + ' users...');
  let ok = 0, fail = 0;
  for (let i = 0; i < ids.length; i += 25) {
    const batch = ids.slice(i, i + 25);
    const rs = await Promise.all(
      batch.map((id) => tg('copyMessage', { chat_id: Number(id), from_chat_id: adminChat, message_id: messageId }))
    );
    rs.forEach((r) => (r.ok ? ok++ : fail++));
    await sleep(1000);
  }
  return say(adminChat, '✅ Broadcast complete\nSent: <b>' + ok + '</b>\nFailed (blocked/left): <b>' + fail + '</b>');
}
