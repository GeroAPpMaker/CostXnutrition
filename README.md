# CostPlate

A real-time classroom web app supporting a 60-minute seminar on food cost control and culinary nutrition. Up to 60 students join on their phones — no install, no login.

---

## Quick Start (local)

```bash
git clone <repo>
cd costplate
npm install
cp .env.example .env   # edit PORT and PUBLIC_URL if needed
npm start
# → http://localhost:3000
```

Open:
- `http://localhost:3000/` — home
- `http://localhost:3000/facilitator.html` — facilitator dashboard
- `http://localhost:3000/projector.html?code=XXXXXX` — projector (after session is created)
- `http://localhost:3000/student.html?code=XXXXXX` — student join

---

## Deploy to Railway (free tier, ~5 min)

1. Create a free account at https://railway.app
2. Click **New Project → Deploy from GitHub repo** (or use the Railway CLI)
3. Railway auto-detects Node.js and runs `npm start`
4. Set the environment variable `PUBLIC_URL` to your Railway public URL (e.g. `https://costplate-production.up.railway.app`) — this is used in QR codes
5. Railway assigns a public HTTPS URL. Share it with students.

**No sleep:** Railway free tier keeps the process alive. If you use Render instead, add a keep-alive ping or the process sleeps after 15 min of inactivity.

---

## How to run locally (development)

```bash
npm run dev   # uses node --watch, restarts on file changes
```

Run unit tests:
```bash
npm test
```

Run load test (server must be running):
```bash
node tests/load-test.js
```

---

## How to edit ingredient data

All prices and nutrition values are in **`config/dishes.js`**. Each ingredient entry looks like:

```js
chicken_breast: {
  label:   'Chicken breast',
  unit:    'g',
  step:    10,        // stepper increment in the builder
  price:   23.00,     // ₱ per 100g — change this line to update price
  kcal:    165,
  protein: 31,
  fat:     3.6,
  sodium:  74,
},
```

Change any value and restart the server. No code changes needed.

### Adding a new dish

Add a new key to the `DISHES` object in `config/dishes.js`:

```js
'chicken-adobo': {
  name: 'Chicken Adobo',
  portions: 4,
  sellingPrice: 180,
  targets: { costPerPortion: 54, calories: 600, sodium: 800, protein: 28 },
  viability: { ... },
  sauceBaseIngredients: ['soy_sauce', 'vinegar'],
  versionA: { ... },
  versionB: { ... },
  ingredients: { ... },
},
```

Also add the same data to `client/js/config.js` (the browser-safe copy). No other code changes required.

---

## Facilitator Quick-Start (5 steps)

1. **Before class:** Open `https://your-app.railway.app/facilitator.html`. Choose "Create a new session", set a PIN (4+ digits). Copy the session code and join URL.
2. **Open projector view:** In a second browser tab/window, go to `https://your-app.railway.app/projector.html?code=XXXXXX` (use your session code). Maximise and display on the projector.
3. **Students join:** Show the QR code or share the join URL. Students open it on their phones, enter their nickname and team name.
4. **Run the session:** Use the control buttons (Next, Back, timer, Price Shock, Hard Mode, Reveal) in the facilitator dashboard. The projector and student views update live.
5. **End of session:** Click "Download CSV" to save results, then click "End session".

---

## Pre-Class Checklist

- [ ] Server is running (Railway dashboard shows green)
- [ ] You can open the facilitator dashboard and see the session code
- [ ] Projector view loads and shows the QR code
- [ ] You have created a session and tested join from your phone
- [ ] CSV download works (test with a dummy student)
- [ ] `plan-b.html` is printed (one copy per student, just in case)
- [ ] Wi-Fi SSID and password are displayed or announced
- [ ] If using Railway, log in to Railway dashboard to monitor if needed

---

## What happens if the server restarts mid-session

**All in-memory session data is lost.** Students will see "Session not found" and need to rejoin.

To avoid this:
- Use Railway (restarts are rare on free tier)
- Download the CSV before ending the session
- Consider upgrading to a paid tier or adding Redis (see `server/storage/README`) for persistence

---

## Architecture notes

- **Server** (Node.js / Fastify): single process, in-memory session state
- **Real-time**: raw WebSocket (`ws` library); timer runs server-side
- **Reconnection**: student stores `clientId` in `sessionStorage`; sends `REJOIN` on reconnect; server sends `FULL_STATE`
- **Storage abstraction**: all state access via `server/storage/index.js` — swap `memory.js` for Redis without touching other files
- **Session expiry**: `setTimeout` deletes session 24 hours after creation (Philippine Data Privacy Act compliance)
- **No cookies, no analytics, no tracking**: verified — `Set-Cookie` header is never sent

---

## Known limitations

- **Single-server only**: session state is in one Node process. For multi-server deployments, add Redis and use `@fastify/websocket` with pub/sub.
- **No persistence across restarts**: in-memory only. See above.
- **No authentication for students**: intentional (no install, no login). The session code is the access control.
- **Facilitator PIN is a session-scoped secret**, not a production auth system. Do not reuse it as a real password.
- **QR code size on projector**: the SVG scales well, but verify readability from the back of your classroom before class.
- **Plan B page requires printing**: no offline PWA cache is implemented.

---

## Running tests

```bash
# Unit tests (§7 expected values)
npm test

# Load test (60 simulated students — server must be running)
node tests/load-test.js

# Custom number of students
N=30 node tests/load-test.js
```

---

## Built with

Node.js 20, Fastify 4, `ws`, `qrcode`, `bcryptjs`. Vanilla HTML/CSS/JS on the client. No framework, no bundler in production.
