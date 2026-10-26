const { tg, dbGet, dbSet, dbDel, sleep } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');
  try {
    const jobs = (await dbGet('scheduled_broadcasts')) || {};
    const now = Date.now(); let processed = 0;
    for (const [id, job] of Object.entries(jobs)) {
      if (job.status !== 'pending' || Number(job.at) > now) continue;
      await dbSet('scheduled_broadcasts/' + id + '/status', 'sending');
      const users = (await dbGet('users')) || {}; let sent = 0, failed = 0;
      for (const uid of Object.keys(users)) {
        const r = await tg('copyMessage', { chat_id: Number(uid), from_chat_id: job.adminChat, message_id: job.messageId });
        if (r && r.ok) sent++; else failed++;
        if ((sent + failed) % 20 === 0) await sleep(1100);
      }
      await dbSet('scheduled_broadcasts/' + id, { ...job, status: 'complete', sent, failed, finishedAt: Date.now() });
      await tg('sendMessage', { chat_id: job.adminChat, text: `🗓 Scheduled broadcast complete\nID: ${id}\nSent: ${sent}\nFailed: ${failed}` });
      processed++;
    }
    return res.status(200).json({ ok: true, processed });
  } catch (e) {
    console.error('Cron error:', e);
    return res.status(500).json({ ok: false, error: 'cron_failed' });
  }
};
