# Closet Stylist

A local app: upload a Pinterest inspiration photo, and Claude compares it against
photos of clothes you actually own (that you've tagged yourself) to suggest outfits
you could recreate.

Everything runs on your machine. Photos and tags live in `data/` as plain files —
nothing is uploaded anywhere except a single API call per match, sent directly to
Anthropic for processing (not posted publicly, not stored by this app anywhere else).

## About cost — read this first

This app calls the **Anthropic API**, which is billed separately from a Claude.ai
or Claude Code subscription — it's pay-as-you-go based on usage, not included in
any monthly plan.

1. Create an API key at [console.anthropic.com](https://console.anthropic.com/settings/keys)
2. Add billing details there and optionally set a monthly spend limit
   (Settings → Limits) so you can't be surprised by usage.

To keep costs low:
- Matching defaults to **Haiku 4.5**, a fast/cheap model (change `MODEL_NAME` in
  `.env` if you want to try Sonnet for better reasoning — it costs more per call).
- Every photo is auto-resized before it's sent or stored, so you're never paying
  to process a huge original image.
- The "Find a Match" tab lets you filter which closet categories to include, so a
  match only sends the relevant subset of your closet, not everything.
- The app shows a rough cost estimate before each match.

Realistically, a match against ~15-20 filtered items with Haiku should cost a
few cents at most. Check real usage/rates any time at
[console.anthropic.com/settings/cost](https://console.anthropic.com/settings/cost).

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` and paste in your API key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Then run:

```bash
npm start
```

Open [http://localhost:3131](http://localhost:3131).

## How to use it

1. **My Closet** — add photos of clothes you own, one at a time, with a name,
   category, and a few tags (color, style, season, etc.). You choose exactly
   which photos to add; nothing is scanned automatically.
2. **Find a Match** — upload a Pinterest screenshot, optionally narrow the
   category filter and add context, then hit "Find matches." Claude suggests
   up to 3 outfit combos from your closet with reasoning.
3. **History** — past matches are saved locally so you can revisit them.

## Data & privacy

- Closet photos: `data/photos/`
- Closet item metadata (name, tags, category): `data/items.json`
- Inspiration photos + match results: `data/inspiration/` and `data/history.json`

All of this is plain files on your disk — back it up, inspect it, or delete it
any time. Nothing is synced anywhere. Deleting the `data/` folder wipes the app's
memory completely.

## Notes / future ideas

- If your closet grows large, matching against everything gets slower and pricier
  — the category filter helps, but you could also add sub-tag filtering (e.g. by
  color) later.
- Right now tagging is manual. Once you have a decent number of items tagged, you
  could try asking Claude to auto-suggest tags from a photo as a starting point
  (still requires your review before saving).
