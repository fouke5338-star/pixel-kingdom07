# Pixel Kingdoms — Multiplayer Web Edition

A browser-based, real-time classroom quiz and city-management game. The host creates an English question bank and observes; players manage separate cities; spectators watch.

## Requirements

- Node.js 18 or newer
- npm
- Internet connection for online deployment

## 1. Run it on your computer first

1. Download and extract the ZIP.
2. Open a terminal in the extracted `pixel_kingdoms_web` folder.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:3000`.
6. To test multiple people on one computer, open the address in multiple browser tabs. To test on other devices on the same Wi-Fi, open `http://YOUR-COMPUTER-LAN-IP:3000` on those devices. The computer firewall may need to allow Node.js.

The health check is at `http://localhost:3000/health` and should return `{"ok":true,"service":"pixel-kingdoms"}`.

## 2. Deploy it online with Render + GitHub

This project needs a **Node Web Service**, not a static site, because Socket.IO requires a live server connection.

### A. Put the project on GitHub

1. Sign in to GitHub.
2. Create a new repository named `pixel-kingdoms-web`.
3. Choose Public if you are comfortable with the source code being visible; otherwise choose Private and make sure Render is authorized to access it.
4. Do not add a second README if you are uploading the complete project folder.
5. Upload the contents of this project folder. Keep the folder structure exactly like this:

   ```
   pixel-kingdoms-web/
   ├── package.json
   ├── server.js
   ├── README.md
   ├── .gitignore
   └── public/
       ├── index.html
       ├── app.js
       └── style.css
   ```

6. Commit the uploaded files to the repository's `main` branch.

### B. Create the website on Render

1. Sign in to Render.
2. Choose **New → Web Service**.
3. Connect GitHub if Render asks, then select `pixel-kingdoms-web`.
4. Configure these settings:

   - Name: `pixel-kingdoms` (or another available name)
   - Language / Runtime: `Node`
   - Branch: `main`
   - Root Directory: leave blank
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: Free for initial classroom testing, if available

5. Click **Create Web Service** and wait for the deploy to finish.
6. Open the `onrender.com` URL shown on the service page.
7. Check that the page loads, then open `/health` on the same domain and confirm it returns an OK response.

### C. Test the real multiplayer website

1. Open the website in one browser as the host.
2. Create a room and add several questions.
3. Open the website on a second device or a private/incognito browser as a player.
4. Enter the room code and choose Player.
5. Open another browser as a spectator and join the same code.
6. Start the match from the host browser.
7. Test a correct answer, event selection, the countdown, an incorrect answer, and all result screens.
8. Refresh one player tab during a match to test session reconnection.

Share only the public website URL and room code with classmates. Do not share your hosting or GitHub account password.

## 3. Important hosting limitations

- Render Free web services can spin down after 15 minutes without inbound traffic. The next visit or WebSocket connection may take about a minute to wake the service.
- Free instances may restart. This prototype stores rooms in server memory, so a restart or redeploy clears every active room and game.
- Use one server instance for this version. Do not scale it to multiple instances: the room state is currently held in one process.
- Keep the host tab connected. If the host loses connection, they have up to two minutes to reconnect before the room is closed.
- Player sessions can reconnect during the match. A disconnected player is treated as having missed that round's answer/event; reconnecting does not restore an expired choice.
- The game is designed for small classroom sessions (up to 50 joined players/spectators per room in this prototype).
- This is a classroom prototype, not a production service. It does not yet have a database, accounts, permanent match history, moderation tools, or advanced anti-cheat protections.

## 4. How the round timer works

The host sets **Event / Round Timer** in seconds (5–120 seconds).

- When all players have answered, players who answered correctly get the event-selection countdown.
- Incorrect answers do not get an event choice.
- If every correct player chooses early, the event phase ends immediately.
- When the event timer reaches zero, unselected events are skipped.
- The round-break timer then runs. The next question starts automatically at zero; the host can start it early with the host button.
- After the final question, results appear. The host reveals Money, Happiness, Goodness, Energy, Trust, and Total Score one screen at a time.

## 5. Troubleshooting

**The Render page says it cannot connect**
- Open the Render service's Logs tab and look for the first error.
- Confirm the Build Command is `npm install` and Start Command is `npm start`.
- Confirm the repository root contains `package.json` and `server.js`.

**The website opens but multiplayer does not work**
- Use the Render `https://...onrender.com` address, not a local `localhost` address.
- Confirm the service is a Web Service, not a Static Site.
- Reload both browser tabs after a new deploy.

**The first visit is slow**
- A free instance may be waking from idle. Wait for it to start, then reload once.

**A room disappeared**
- A server restart, redeploy, free-instance sleep/restart, or host reconnect timeout can clear an in-memory room. Create a new room.

## 6. Updating the live website

After changing files, upload/commit the new version to the same GitHub repository and branch. Render normally detects the commit and deploys the update automatically. Check the Deploys tab and wait for the deploy to finish before testing.

## 7. Suggested next production upgrades

1. Add a persistent database for rooms, question banks, and match history.
2. Add a Redis adapter if multiple server instances are ever needed.
3. Add private host controls, room moderation, and stronger validation.
4. Add automated tests for ties, disconnections, timer expiry, and simultaneous answers.
5. Add accessibility and device testing on current Android/iOS browsers.


## Version 0.6 updates
- The host lobby generates a QR code and a shareable direct room link automatically.
- Scanning the QR code opens the website with the room code pre-filled; the player only needs to enter a display name and join.
- Hosts can copy the invitation link. The room code remains visible as a fallback.
- QR images are generated by the Node server using the `qrcode` package.

## Version 0.5 updates
- Displays each player’s submitted answer and the correct answer after submission.
- Incorrect answers apply a random -10 penalty to one city stat (MONEY, HAPPINESS, GOODNESS, ENERGY, or TRUST).
- Correct players see their answer feedback and the three random city-event choices together in the same question panel.
- If no player answers correctly, the answer feedback remains visible briefly before the next question.
