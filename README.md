# HotPot

A standalone recreation of Palia's Hotpot card minigame.

- **Solo:** you plus three computer opponents, all in the browser.
- **Online:** one person creates a table and shares an invite link. Up to 4 people join; empty seats are filled by computer players. The server runs the game, so hands stay private.

## Layout

| Path | What it is |
| --- | --- |
| `public/index.html` | The whole game client (solo and online) |
| `src/rules.js` | Rules, scoring, computer-player brain, pure game engine |
| `src/room.js` | One table's lobby, turns and timers (platform independent) |
| `src/worker.js` | Cloudflare Worker + Durable Object wrapper |
| `test/` | `npm test` runs rules and room tests with no network |

## Run locally

```
npm install
npm run dev      # wrangler dev, open the printed URL
```

## Deploy (Cloudflare free plan)

Workers Free supports SQLite-backed Durable Objects and static assets.
Either run `npx wrangler login && npm run deploy`, or add the repo secrets
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` and run the **Deploy to Cloudflare**
workflow by hand. Nothing deploys automatically.

## Rules in one breath

96 cards (8 colors x 3 foods x 4). Hold 8, draw 1 (pot or another player's top discard), discard 1.
Three sets of three wins, and the ninth card must be drawn. Three of a kind is 120, a color set is 60.
