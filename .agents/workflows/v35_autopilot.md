---
description: V35.0-AUTO-PILOT master workflow — sync, scrape, deploy
---

# V35.0-AUTO-PILOT Master Workflow

Runs the full pipeline: sync match data → scrape streams → deploy to Firebase.

// turbo-all

## Step 1: Run the main sync script (purge + ESPN data + player names)
```
node sync_script.js
```
Wait for it to print `✅ [V35.0-AUTO-PILOT] Purge + Sync Complete!` before continuing.

## Step 2: Run the stream scraper (saves HLS links to match_links/{matchId})
```
node stream_scraper.js
```
Wait for it to print `✅ [SCRAPER V35.0] Done!` before continuing.

## Step 3: Deploy to Firebase Hosting
```shell
cd football_live_score_web && firebase deploy --only hosting
```
Wait for `✅ Deploy complete!` and the Hosting URL to be printed.

## Step 4 (Optional): Start the Telegram Goal Bot (background process)
Set your env vars first:
- `TELEGRAM_BOT_TOKEN` — from @BotFather
- `TELEGRAM_CHAT_ID`   — your channel ID (e.g. -1001234567890)

Then run:
```
node social_bot.js
```
The bot will stay running and post goal alerts to Telegram in real-time.

## Notes
- The sync + scraper should be run via a cron job every 5 minutes during live matches.
- The social bot (`social_bot.js`) is a long-running daemon — run it in a separate terminal or with `pm2`.
- If you have `pm2` installed: `pm2 start social_bot.js --name korra-bot`
