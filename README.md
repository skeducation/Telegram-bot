# Telegram File/Link Share Bot (Vercel)

## Environment Variables (Vercel -> Settings -> Environment Variables)
| Name | Value |
|---|---|
| BOT_TOKEN | BotFather wala token |
| ADMIN_1 | Pehle admin ki numeric Telegram ID |
| ADMIN_2 | Dusre admin ki numeric Telegram ID |
| FIREBASE_URL | https://YOUR-PROJECT-default-rtdb.firebaseio.com |
| FIREBASE_SECRET | Firebase Database secret (Project settings -> Service accounts -> Database secrets) |
| WEBHOOK_SECRET | koi bhi random string (security ke liye) |

## Deploy
1. Ye folder GitHub par daalo ya `vercel --prod` chalao.
2. Env variables set karke redeploy karo.
3. Browser me kholo: `https://YOUR-APP.vercel.app/api/setup` -> webhook set ho jayega.
4. Bot ko har force-join channel me **Admin** banao.
5. Bot me `/start` dabao (admin panel dikhega).

## Admin flow
/newlink -> original file/link bhejo -> channel links bhejo -> /done -> naya share link.
Private channel: invite link bhejo, phir channel ka koi message forward karo.
/broadcast -> message bhejo -> sab users ko jayega.
