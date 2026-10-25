const { tg } = require('./_lib');

module.exports = async (req, res) => {
  const url = `https://${req.headers.host}/api/webhook`;
  const params = { url, allowed_updates: ['message', 'callback_query'] };
  if (process.env.WEBHOOK_SECRET) params.secret_token = process.env.WEBHOOK_SECRET;
  const r = await tg('setWebhook', params);
  res.status(200).json({ webhook: url, result: r });
};
