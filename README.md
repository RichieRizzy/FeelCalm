# FeelCalm

A delivery tracking app with a customer side and a rider side. Black and one blue, built phone first.

## What is in this repository

| Path | What it is |
|---|---|
| `app/FeelCalm.html` | The whole app in one file: screens, logic and styles. |
| `docs/FeelCalm_pricing_and_features.xlsx` | Rate card, price calculator, full price matrix and feature list. Edit the blue cells on the Rate card sheet and the other sheets update. |

## Features

**Customer**
- Sign-up with name, phone and address
- Send a parcel: item, pickup, delivery address, receiver name and phone, distance, size, speed, payment method, note for the rider
- Fixed prices with a full breakdown before booking, no surge
- Optional parcel protection
- Live map with the rider, the receiver and the pickup point, ETA and distance left
- 4-digit delivery PIN for the handover
- Chat with the rider, with a typing indicator
- Call button with the number shown
- Track a parcel by tracking ID (for a receiver)
- Share trip, safety sheet, cancel before pickup, location sharing on or off
- Rating and tip, history and receipts, calm mode

**Rider**
- Sign-up with name, call number, vehicle and plate
- Online or offline switch
- Request cards that show the payout before accepting; the first rider to accept gets the job
- Route, calls to the sender and the receiver, chat
- PIN check to complete a delivery
- Earnings and trip list

## Pricing (placeholder rates in Naira)

| Distance | Standard | Express |
|---|---|---|
| Nearby, up to 5 km | 1,800 | 2,800 |
| Across town, 5 to 15 km | 3,000 | 4,600 |
| Far, 15 to 30 km | 4,800 | 7,200 |

Package size adds 0 (envelope), 600 (small box) or 1,600 (large box). A service fee of 250 applies to every delivery, and optional protection costs 500. The rider keeps 80% of the delivery price plus the size charge. These rates are placeholders for Lagos; replace them with your own in `app/FeelCalm.html` (the `CAT` object near the top of the script) and in the spreadsheet.

## How it runs today

`app/FeelCalm.html` is written for the Claude Artifacts platform. It uses three services that platform provides to a published page:

- `db`, a shared document store for profiles, shipments and chat messages
- `user`, the signed-in person's id
- `room`, live presence, used for the rider's position, the receiver's pin and the typing indicator

If you open the file straight from your computer or a normal web host, none of these exist, and the page shows a message saying it needs the storage service. It does not work as a standalone website without the changes below.

## Known limits

- **Positions are not GPS.** The rider's position moves along a fixed demo route and the receiver places a pin by tapping the map. Pages on that platform cannot read a phone's location.
- **Accounts are Claude accounts.** Everyone who uses the published app must be signed in to Claude and be a Contributor.
- **Payments are not real.** The payment choice is recorded and nothing is charged.
- **Security is prototype level.** Any Contributor can read all deliveries, and the delivery PIN is checked in the browser against a hash.
- **No installable app and no push alerts.** Alerts are in-app toasts only.

## Taking it to production

1. Replace the three platform services with your own backend: a database, sign-in, and a realtime channel (for example WebSockets or a managed realtime service).
2. Read the phone's real location with the browser Geolocation API, or build the mobile apps with a location library, and send it to the backend.
3. Add a payment provider, server-side PIN checks, and rules so people only read their own deliveries.
4. Wrap it as a Progressive Web App for installing on a home screen, or rebuild the screens in a mobile framework for the app stores.

The data shapes are in the script: `profile` documents at `data/users/<id>/profile`, `shipments/<id>` for each parcel, and `shipments/<id>/messages/<id>` for chat.
