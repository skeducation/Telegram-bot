# Telegram File & Link Sharing Bot (Vercel)

## Environment Variables
Set these in Vercel → Project → Settings → Environment Variables:

| Name | Value |
|---|---|
| `BOT_TOKEN` | Token from BotFather |
| `ADMIN_1` | First admin's numeric Telegram ID |
| `ADMIN_2` | Second admin's numeric Telegram ID |
| `FIREBASE_URL` | Firebase Realtime Database URL, e.g. `https://PROJECT-default-rtdb.firebaseio.com` |
| `FIREBASE_SECRET` | Firebase credential used by this existing project |
| `WEBHOOK_SECRET` | Same webhook secret configured for Telegram |

## Deploy / connect webhook
1. Upload these files to the Vercel project and set the environment variables.
2. Redeploy.
3. Open `https://YOUR-APP.vercel.app/api/setup` once to register the webhook. This registers `message`, `callback_query`, and `channel_post` updates.
4. Add the bot as an administrator in any channel you want it to detect/manage. To auto-detect a channel, post in that channel after the webhook is registered, or forward a channel post to the bot in private chat.
5. Start the bot with `/start`.

## Admin commands
- `/newlink` — start a multi-item share pack.
- Send one or more text links/files/photos/videos/audio/documents/voice notes, then `/donefiles`.
- Enter a title, description, optional custom code, optional expiry in hours, and optional maximum views. Use `/skip` for optional fields.
- Add extra force-join channels by sending a public channel link or forwarding a channel post. `/done` creates the share link.
- `/addchannel` — add a channel to the global default channel list; forward its post or send its public link.
- `/channels` — list saved global channels.
- `/removechannel CHANNEL_ID` — remove a global channel.
- `/links` — list share links and their view counts.
- `/search WORD` — search link titles, descriptions, and codes.
- `/disablelink CODE` / `/enablelink CODE` — pause or resume a link.
- `/dellink CODE` — delete a share link.
- `/stats` — user, link, open, and channel statistics.
- `/broadcast` — immediately broadcast a text or media message.
- `/schedule` — schedule a text or media broadcast using `YYYY-MM-DD HH:mm` in India time.
- `/cancel` — cancel the current admin flow.

## User commands / menu
- `/menu` — open menu.
- `/search WORD` — find active share links.
- `/recent` — recently opened links.
- `/favorites` — saved favorite links.
- `/language hi` or `/language en` — choose the menu/welcome language.

## Notes
- Multi-file packs store Telegram `file_id` values and re-send those items to users; they do not upload copies to Vercel storage.
- Global channels are preselected as force-join channels for newly created links. Each link retains its own channel list after creation.
- Scheduled broadcasts depend on Vercel Cron invoking `/api/cron`. The included schedule is once per minute; confirm that the Vercel plan for this project supports the desired cron frequency. Scheduled jobs are stored in Firebase under `scheduled_broadcasts`.
- The feature changes do not include a separate security-hardening pass, as requested.
