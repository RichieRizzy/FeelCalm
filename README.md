# FeelCalm

Smart delivery tracking with live GPS, real-time chat and fixed prices. One app for the customer, the receiver and the rider. Black and one blue (`#2347FF`), built phone first.

This is a real, self-hosted web app: your own server and database, real phone GPS, and Paystack payments. It installs on a phone's home screen like an app.

## Run it

You need Node.js 22.5 or newer. There is nothing to install.

```bash
git clone https://github.com/RichieRizzy/FeelCalm.git
cd FeelCalm
npm start
```

Open http://localhost:3000. Payments run in **test mode** until you add Paystack keys, so no real money moves.

Phones only share GPS on **HTTPS** (or `localhost`). To try it on a real phone, deploy it (below) or tunnel it with a tool such as Cloudflare Tunnel or ngrok.

## Put it online

The server is one Node process plus a SQLite file, so any host works. It needs HTTPS, WebSocket support and a persistent disk for `DATA_DIR`.

- **Render:** use the included `render.yaml` (Blueprint). It builds the `Dockerfile`, mounts a disk at `/data` and generates `JWT_SECRET`. Disks need a paid instance.
- **Docker anywhere (VPS, Fly.io, Railway):** `docker build -t feelcalm .` then `docker run -p 3000:3000 -v feelcalm-data:/data feelcalm`. Put Caddy or nginx in front for HTTPS.

Then set `PUBLIC_URL` to your https address and share the link. People create an account on the first visit.

## Real payments (Paystack)

1. Create a Paystack account and copy your **secret** and **public** keys.
2. Set `PAYSTACK_SECRET_KEY` and `PAYSTACK_PUBLIC_KEY`, plus `PUBLIC_URL`.
3. In the Paystack dashboard set the webhook URL to `https://YOUR-DOMAIN/api/paystack/webhook`.

Card and bank-transfer parcels are paid before a rider can see them. Cash-to-rider parcels go straight out. Cancelling a paid parcel before pickup triggers a refund through Paystack. Prices are decided on the server, and the amount Paystack confirms must match the quote.

## Prices (fixed, no surge)

| Distance | Standard | Express |
|---|---|---|
| Nearby, up to 5 km | ₦1,800 | ₦2,800 |
| Across town, 5 to 15 km | ₦3,000 | ₦4,600 |
| Far, 15 to 30 km | ₦4,800 | ₦7,200 |

Package size adds ₦0 (envelope, up to 1 kg), ₦600 (small box, up to 5 kg) or ₦1,600 (large box, up to 15 kg). Every order has a ₦250 service fee. Parcel protection (cover up to ₦50,000) is +₦500. Riders keep 80% of delivery plus size, and all of any tip.

The distance band is worked out from the two addresses, so customers cannot pick a cheaper band. Change prices in `server/lib/pricing.js`. The full price matrix and feature list is in `docs/FeelCalm_pricing_and_features.xlsx`.

## What it does

**Customer and receiver**
- Create an account, send a parcel with address search (OpenStreetMap), a live price breakdown and optional protection
- Live map with the rider's real position, route, ETA and distance left
- 4-digit delivery PIN, checked by the server, with a lockout after wrong tries
- Chat with the rider with typing indicators, quick replies and unread dots
- A receiver who has an account is linked automatically by phone number; anyone else can follow with the tracking ID or a shared link
- Share trip, safety sheet, cancel before pickup, location sharing on or off, rating and tip, history and receipts

**Rider**
- Own sign-up with call number, vehicle and plate
- Online switch, requests with the payout shown first and distance from you, first rider to accept wins
- Pickup and drop-off can only be confirmed when the rider's GPS is within 400 m
- Earnings, trips and rating, cash-job reminder

**Both:** light and dark mode, calm mode (only key alerts), home-screen install, offline banner, works on small phones.

## How it is built

| Part | Choice |
|---|---|
| Server | Node.js, no dependencies: HTTP API, a small WebSocket server, SQLite (`node:sqlite`) |
| Real time | WebSocket for chat, typing, shipment updates and GPS |
| App | Plain JavaScript, one CSS file, a small tile map written for this project |
| Maps | OpenStreetMap data through CARTO tiles; Nominatim for addresses; OSRM for routes |
| Accounts | Email and password (scrypt), signed 30-day login tokens |
| Payments | Paystack |

```
server/        API, WebSocket, database, pricing, payments, geocoding
public/        the app (index.html, js/app.js, js/map.js, css/app.css, service worker, icons)
test/          end-to-end tests: npm test
prototype/     the original single-file prototype
docs/          pricing and features spreadsheet
```

Run the tests with `npm test`.

## Settings

Copy `.env.example` to `.env`, or set the same names in your host.

| Name | What it does |
|---|---|
| `PUBLIC_URL` | Your https address. Needed for Paystack to return people to the app |
| `DATA_DIR` | Where the database lives. Use a persistent disk |
| `JWT_SECRET` | Signs logins. Generated and stored if empty |
| `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY` | Turn on real payments |
| `COUNTRY_CODE` | Limits address search to one country (default `ng`) |
| `GEOFENCE_M` | How close a rider must be to confirm a step. `0` turns it off |
| `TILE_URL`, `TILE_URL_DARK`, `TILE_ATTRIBUTION` | Use another map tile provider |

## Honest limits

- **Public map services have usage rules.** The free CARTO tiles, Nominatim and the OSRM demo server are fine for a pilot. For real traffic, use a paid tile, geocoding and routing provider (set `TILE_URL`, and swap the calls in `server/lib/geo.js`).
- **One server, one SQLite file.** That comfortably handles a pilot. To run several servers you would move to Postgres and a shared message bus.
- **Alerts only while the app is open.** There is no push when the app is closed and no SMS yet.
- **Not built yet:** password reset, email or phone verification, rider identity checks, an admin dashboard, rider payouts, and dispute handling. Add these before launching to the public.
- Parcel protection is a price line and a promise in the app. It is not an insurance policy until you arrange one.
