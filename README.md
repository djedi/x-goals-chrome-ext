# X Goals Chrome Ext

Chrome extension that polls [x.com/i/account_analytics](https://x.com/i/account_analytics) and puts counters on the toolbar:

- **Replies today** — goal **60**
- **Posts to timeline today** — goal **3**
- **Verified followers** — goal **500**

For example: **289 verified followers** and **123 replies in the 7D window**.

## Load it

1. Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → this folder
4. Stay logged in to X in that Chrome profile
5. Click the toolbar icon → **Refresh** (or wait for the 5-minute poll)

The badge is today's reply count. The icon and popup show replies, timeline posts, **and** verified followers.

## How the numbers are read

Every poll the extension opens (or reuses) `https://x.com/i/account_analytics/overview` in a background tab, waits for the SPA, then scrapes:

| Number | Source |
| --- | --- |
| Verified followers | "Verified followers" card |
| Replies you posted | **Posts / Replies** chart (green Replies series) or `ReplyCreate` in `accountOverviewDailyQuery`. This is outbound. |
| Posts to timeline | **Posts / Replies** chart (Posts series) or `TweetCreate` + `QuoteCreate` in `accountOverviewDailyQuery`. Original posts you published today. |
| Replies received | The bottom **Replies** card — shown only as a note, never on the badge |

The overview **Replies** card is inbound engagement on your posts. It is not the 60/day goal.

Optional: leave analytics open on **today** via the calendar. The content script will ping the extension every minute while that tab is open.

## Settings

In the popup: reply goal, post goal, verified goal, poll interval (1–120 minutes). Stored locally only. Nothing is uploaded.

## Files

- `manifest.json` — MV3
- `background.js` — alarms, tab, badge/icon
- `scrape.js` — in-page scraper (MAIN world)
- `page-hook.js` — captures analytics/graphql JSON if the SPA fetches it
- `parse.js` — HTML/number helpers + tests

```sh
npm test
```
