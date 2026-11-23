const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");
const QRCode = require("qrcode");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ["GET", "POST"] },
  pingInterval: 25000,
  pingTimeout: 20000
});
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true, service: "pixel-kingdoms" }));
app.get("/api/qr", async (req, res) => {
  const value = String(req.query.data || "");
  if (value.length > 2048) return res.status(400).json({ error: "QR data is too long." });
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Invalid protocol");
    const dataUrl = await QRCode.toDataURL(value, { errorCorrectionLevel: "M", margin: 2, width: 320 });
    res.json({ dataUrl });
  } catch {
    res.status(400).json({ error: "A valid game URL is required." });
  }
});

const rooms = new Map();
const ROOM_CAP = 50;
const HOST_RECONNECT_GRACE_MS = 120000;
const PLAYER_RECONNECT_GRACE_MS = 90000;
const STAT_KEYS = ["money", "happiness", "goodness", "energy", "trust"];
const EVENT_POOL = [
  ["A successful trade fair", {money:18,happiness:5}],
  ["A new public park", {happiness:16,goodness:5}],
  ["A volunteer clean-up day", {goodness:16,trust:5}],
  ["A new solar station", {energy:16,goodness:5}],
  ["A town hall meeting", {trust:16,happiness:5}],
  ["Busy market season", {money:14,energy:5}],
  ["A festival of kindness", {goodness:14,happiness:5}],
  ["A reliable power upgrade", {energy:14,trust:5}],
  ["A popular street-food market", {happiness:14,money:5}],
  ["A community garden", {goodness:14,trust:5}],
  ["A clever tax plan", {money:25,trust:-7}],
  ["A fast road expansion", {energy:25,goodness:-7}],
  ["A strict city policy", {trust:25,happiness:-7}],
  ["A luxury shopping district", {money:25,goodness:-7}],
  ["A large construction project", {energy:25,money:-7}],
  ["A free education program", {goodness:25,money:-7}],
  ["A late-night festival", {happiness:25,energy:-7}],
  ["A new factory contract", {money:22,happiness:-6}],
  ["A water-saving campaign", {energy:12,goodness:12}],
  ["A neighborhood celebration", {happiness:12,trust:12}],
  ["A fair-wage agreement", {goodness:12,money:12}],
  ["A public transport pass", {energy:12,happiness:12}],
  ["A transparent budget report", {trust:12,goodness:12}],
  ["A tourism partnership", {money:12,trust:12}],
  ["A library renovation", {goodness:12,happiness:12}],
  ["A city-wide sports day", {happiness:12,energy:12}],
  ["A helpful trade alliance", {money:12,goodness:12}],
  ["A neighborhood safety plan", {trust:12,energy:12}],
  ["A green building project", {goodness:12,energy:12}],
  ["A local business grant", {money:12,happiness:12}],
  ["A sudden supply shortage", {money:-8,energy:-5}],
  ["A rainy festival weekend", {happiness:-8,money:-5}],
  ["A confusing new rule", {trust:-8,goodness:-5}],
  ["A power-use warning", {energy:-8,happiness:-5}],
  ["A damaged town square", {goodness:-8,trust:-5}],
  ["A generous visitor donation", {money:20}],
  ["A cheerful music show", {happiness:20}],
  ["A charity project", {goodness:20}],
  ["A new battery reserve", {energy:20}],
  ["A citizens' trust award", {trust:20}]
];

const clamp = n => Math.max(0, Math.min(999, n));
const shuffle = list => [...list].sort(() => Math.random() - 0.5);
const safeName = value => String(value || "").trim().replace(/[<>]/g, "").slice(0, 20);
const reply = (cb, payload) => { if (typeof cb === "function") cb(payload); };

function publicRoom(r) {
  return {
    code: r.code, hostName: r.hostName, hostOnline: r.hostOnline,
    status: r.status, round: r.round, totalRounds: r.questions.length,
    questionSeconds: r.questionSeconds, eventSeconds: r.eventSeconds, phaseEndsAt: r.phaseEndsAt,
    players: [...r.players.values()].map(p => ({
      id: p.token, name: p.name, role: p.role, online: p.online, stats: p.stats
    })),
    question: r.currentQuestion ? {
      text: r.currentQuestion.text, options: r.currentQuestion.options
    } : null,
    answerFeedback: Object.fromEntries([...r.answers.entries()].map(([id, answer]) => [id, {
      correct: !!answer.correct,
      selectedIndex: Number.isInteger(answer.selectedIndex) ? answer.selectedIndex : null,
      correctIndex: r.currentQuestion?.correctIndex ?? null,
      timedOut: !!answer.timedOut,
      penaltyStat: answer.penaltyStat || null,
      penaltyAmount: answer.penaltyAmount || 0
    }])),
    answered: [...r.answers.keys()],
    correctPlayers: [...r.answers.entries()].filter(([, a]) => a.correct).map(([id]) => id),
    eventChoices: r.eventChoices,
    eventSelections: [...r.eventSelections.keys()],
    results: r.results, resultIndex: r.resultIndex
  };
}
function emitRoom(r) { io.to(r.code).emit("room:update", publicRoom(r)); }
function clearRoomTimer(r) {
  if (r.timer) clearTimeout(r.timer);
  r.timer = null;
}
function scheduleRoomTimer(r, callback, delay) {
  clearRoomTimer(r);
  r.timer = setTimeout(() => {
    r.timer = null;
    callback();
  }, Math.max(0, delay));
}
function activePlayers(r) {
  return [...r.players.values()].filter(p => p.role === "player");
}
function makeResults(r) {
  const players = activePlayers(r);
  const categories = STAT_KEYS.map(key => {
    const sorted = [...players].sort((a, b) => b.stats[key] - a.stats[key]);
    let previous = null, points = 0;
    const rows = sorted.map((p, index) => {
      if (previous === null || p.stats[key] !== previous) points = Math.max(0, 100 - index * 10);
      previous = p.stats[key];
      return { id: p.token, name: p.name, value: p.stats[key], points };
    });
    return { key, rows };
  });
  const totals = players.map(p => ({
    id: p.token, name: p.name,
    score: categories.reduce((sum, category) =>
      sum + (category.rows.find(row => row.id === p.token)?.points ?? 0), 0)
  })).sort((a, b) => b.score - a.score);
  let lastScore = null, lastRank = 0;
  totals.forEach((row, index) => {
    if (lastScore === null || row.score !== lastScore) lastRank = index + 1;
    row.rank = lastRank;
    lastScore = row.score;
  });
  return { categories, total: totals };
}
function finishGame(r) {
  clearRoomTimer(r);
  r.status = "game_over";
  r.phaseEndsAt = null;
  r.results = makeResults(r);
  r.resultIndex = 0;
  emitRoom(r);
}
function nextAfterEvents(r) {
  clearRoomTimer(r);
  if (r.round >= r.questions.length) return finishGame(r);
  nextQuestion(r);
}
function finishQuestion(r) {
  if (r.status !== "playing") return;
  for (const p of activePlayers(r)) {
    if (!r.answers.has(p.token)) r.answers.set(p.token, { correct: false, timedOut: true });
  }
  emitRoom(r);
  beginEventSelection(r);
}
function finishEventSelection(r) {
  if (r.status !== "event_selection") return;
  for (const token of r.correctPlayers) {
    if (!r.eventSelections.has(token)) r.eventSelections.set(token, "timed-out");
  }
  nextAfterEvents(r);
}
function beginEventSelection(r) {
  if (r.status !== "playing") return;
  const players = activePlayers(r);
  if (!players.every(p => r.answers.has(p.token))) return;
  clearRoomTimer(r);
  r.correctPlayers = players.filter(p => r.answers.get(p.token)?.correct).map(p => p.token);
  if (!r.correctPlayers.length) {
    r.status = "answer_feedback";
    r.phaseEndsAt = Date.now() + 3500;
    emitRoom(r);
    scheduleRoomTimer(r, () => nextAfterEvents(r), 3500);
    return;
  }
  r.status = "event_selection";
  r.phaseEndsAt = Date.now() + r.eventSeconds * 1000;
  emitRoom(r);
  scheduleRoomTimer(r, () => finishEventSelection(r), r.eventSeconds * 1000);
}
function checkEventSelectionComplete(r) {
  if (r.status !== "event_selection") return;
  if (r.correctPlayers.every(token => r.eventSelections.has(token))) nextAfterEvents(r);
}
function nextQuestion(r) {
  clearRoomTimer(r);
  if (r.round >= r.questions.length) return finishGame(r);
  r.round += 1;
  const q = r.questions[r.round - 1];
  r.currentQuestion = { text: q.text, options: q.options, correctIndex: q.correctIndex };
  r.answers.clear();
  r.eventSelections.clear();
  r.eventChoices = {};
  r.correctPlayers = [];
  r.status = "playing";
  r.phaseEndsAt = Date.now() + r.questionSeconds * 1000;
  emitRoom(r);
  scheduleRoomTimer(r, () => finishQuestion(r), r.questionSeconds * 1000);
}
function roomFor(socket) { return rooms.get(socket.data.roomCode); }
function attachHost(socket, r) {
  r.hostSocketId = socket.id;
  r.hostOnline = true;
  if (r.hostDisconnectTimer) clearTimeout(r.hostDisconnectTimer);
  r.hostDisconnectTimer = null;
  socket.data.roomCode = r.code;
  socket.data.hostToken = r.hostToken;
  socket.join(r.code);
  emitRoom(r);
}
function attachPlayer(socket, r, p) {
  if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
  p.disconnectTimer = null;
  p.online = true;
  p.socketId = socket.id;
  socket.data.roomCode = r.code;
  socket.data.playerToken = p.token;
  socket.join(r.code);
  emitRoom(r);
}
function disconnectPlayer(r, p) {
  p.online = false;
  p.socketId = null;
  if (r.status === "playing" && !r.answers.has(p.token)) {
    r.answers.set(p.token, { correct: false, disconnected: true });
    beginEventSelection(r);
  } else if (r.status === "event_selection" && r.correctPlayers.includes(p.token) && !r.eventSelections.has(p.token)) {
    r.eventSelections.set(p.token, "disconnected");
    checkEventSelectionComplete(r);
  }
  emitRoom(r);
  p.disconnectTimer = setTimeout(() => {
    const current = rooms.get(r.code);
    if (current && current.players.get(p.token) === p && !p.online && current.status === "lobby") {
      current.players.delete(p.token);
      emitRoom(current);
    }
  }, PLAYER_RECONNECT_GRACE_MS);
}

io.on("connection", socket => {
  socket.on("room:create", ({ name, questions, questionSeconds, eventSeconds, hostToken } = {}, cb) => {
    const hostName = safeName(name);
    if (!hostName) return reply(cb, { error: "Enter a host name." });
    if (!Array.isArray(questions) || questions.length < 1 || questions.length > 100)
      return reply(cb, { error: "Add between 1 and 100 questions." });
    if (questions.some(q => !q || typeof q.text !== "string" || !q.text.trim() ||
      !Array.isArray(q.options) || q.options.length !== 4 ||
      q.options.some(x => typeof x !== "string" || !x.trim()) ||
      !Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3))
      return reply(cb, { error: "Each question needs text, four answers, and one correct answer." });
    const token = String(hostToken || "");
    if (token.length < 12 || token.length > 100) return reply(cb, { error: "Could not create a secure host session. Refresh and try again." });
    let code;
    do { code = crypto.randomBytes(3).toString("hex").toUpperCase(); } while (rooms.has(code));
    const r = {
      code, hostId: socket.id, hostSocketId: socket.id, hostToken: token,
      hostName, hostOnline: true, hostDisconnectTimer: null,
      players: new Map(), questions: shuffle(questions.map(q => ({
        text: q.text.trim().slice(0, 500),
        options: q.options.map(x => x.trim().slice(0, 160)),
        correctIndex: q.correctIndex
      }))),
      round: 0, status: "lobby",
      questionSeconds: Math.max(5, Math.min(300, Number(questionSeconds) || 30)),
      eventSeconds: Math.max(5, Math.min(120, Number(eventSeconds) || 20)),
      phaseEndsAt: null, timer: null, currentQuestion: null,
      answers: new Map(), correctPlayers: [], eventSelections: new Map(),
      eventChoices: {}, results: null, resultIndex: 0
    };
    rooms.set(code, r);
    attachHost(socket, r);
    reply(cb, { ok: true, code, hostToken: token });
  });

  socket.on("room:join", ({ code, name, role, playerToken } = {}, cb) => {
    const r = rooms.get(String(code || "").toUpperCase());
    if (!r) return reply(cb, { error: "Room not found. Check the code and try again." });
    if (r.status !== "lobby") return reply(cb, { error: "This game has already started." });
    if (r.players.size >= ROOM_CAP) return reply(cb, { error: `This room is full (maximum ${ROOM_CAP} players and spectators).` });
    const playerName = safeName(name);
    const token = String(playerToken || "");
    if (!playerName) return reply(cb, { error: "Enter a display name." });
    if (token.length < 12 || token.length > 100) return reply(cb, { error: "Could not create a secure player session. Refresh and try again." });
    if (r.players.has(token)) return reply(cb, { error: "This player session is already in the room. Try refreshing." });
    const p = {
      token, name: playerName, role: role === "spectator" ? "spectator" : "player",
      online: true, socketId: socket.id, disconnectTimer: null,
      stats: { money: 50, happiness: 50, goodness: 50, energy: 50, trust: 50 }
    };
    r.players.set(token, p);
    socket.data.roomCode = r.code;
    socket.data.playerToken = token;
    socket.join(r.code);
    reply(cb, { ok: true, role: p.role, playerToken: token });
    emitRoom(r);
  });

  socket.on("room:resume", ({ roomCode, token, kind } = {}, cb) => {
    const r = rooms.get(String(roomCode || "").toUpperCase());
    if (!r || !token) return reply(cb, { error: "This room session is no longer available." });
    if (kind === "host" && r.hostToken === token) {
      attachHost(socket, r);
      return reply(cb, { ok: true, isHost: true, role: "spectator", token });
    }
    const p = r.players.get(token);
    if (!p) return reply(cb, { error: "Your player session could not be found in this room." });
    attachPlayer(socket, r, p);
    reply(cb, { ok: true, isHost: false, role: p.role, token });
  });

  socket.on("player:role", ({ role } = {}) => {
    const r = roomFor(socket), p = r?.players.get(socket.data.playerToken);
    if (!r || !p || r.status !== "lobby") return;
    p.role = role === "spectator" ? "spectator" : "player";
    emitRoom(r);
  });

  socket.on("host:start", () => {
    const r = roomFor(socket);
    if (!r || r.hostSocketId !== socket.id || r.status !== "lobby" || !activePlayers(r).length) return;
    nextQuestion(r);
  });

  socket.on("player:answer", ({ index } = {}) => {
    const r = roomFor(socket), p = r?.players.get(socket.data.playerToken);
    if (!r || !p || !p.online || p.role !== "player" || r.status !== "playing" ||
        r.answers.has(p.token) || !Number.isInteger(index) || index < 0 || index > 3) return;
    const correct = index === r.currentQuestion.correctIndex;
    const answer = { correct, selectedIndex: index };
    if (!correct) {
      const penaltyStat = STAT_KEYS[Math.floor(Math.random() * STAT_KEYS.length)];
      const penaltyAmount = 10;
      p.stats[penaltyStat] = clamp(p.stats[penaltyStat] - penaltyAmount);
      answer.penaltyStat = penaltyStat;
      answer.penaltyAmount = penaltyAmount;
    }
    r.answers.set(p.token, answer);
    if (correct) r.eventChoices[p.token] = shuffle(EVENT_POOL).slice(0, 3).map(([title, delta], i) => ({ id: i, title, delta }));
    emitRoom(r);
    beginEventSelection(r);
  });

  socket.on("player:event", ({ eventId } = {}) => {
    const r = roomFor(socket), p = r?.players.get(socket.data.playerToken);
    if (!r || !p || !p.online || p.role !== "player" || r.status !== "event_selection" ||
        !r.correctPlayers.includes(p.token) || r.eventSelections.has(p.token)) return;
    const event = r.eventChoices[p.token]?.find(e => e.id === eventId);
    if (!event) return;
    for (const [key, value] of Object.entries(event.delta)) {
      if (STAT_KEYS.includes(key) && Number.isFinite(value)) p.stats[key] = clamp(p.stats[key] + value);
    }
    r.eventSelections.set(p.token, eventId);
    emitRoom(r);
    checkEventSelectionComplete(r);
  });

  socket.on("host:show-results", () => {
    const r = roomFor(socket);
    if (!r || r.hostSocketId !== socket.id || r.status !== "game_over") return;
    r.status = "results";
    r.resultIndex = 0;
    emitRoom(r);
  });

  socket.on("host:next", () => {
    const r = roomFor(socket);
    if (!r || r.hostSocketId !== socket.id) return;
    if (r.status === "results" && r.resultIndex < r.results.categories.length + 1) {
      r.resultIndex += 1;
      emitRoom(r);
    }
  });

  socket.on("disconnect", () => {
    const r = roomFor(socket);
    if (!r) return;
    if (r.hostSocketId === socket.id && socket.data.hostToken === r.hostToken) {
      r.hostOnline = false;
      r.hostSocketId = null;
      emitRoom(r);
      if (r.hostDisconnectTimer) clearTimeout(r.hostDisconnectTimer);
      r.hostDisconnectTimer = setTimeout(() => {
        if (!r.hostOnline) {
          clearRoomTimer(r);
          rooms.delete(r.code);
          io.to(r.code).emit("room:closed");
        }
      }, HOST_RECONNECT_GRACE_MS);
      return;
    }
    const p = r.players.get(socket.data.playerToken);
    if (p && p.socketId === socket.id) disconnectPlayer(r, p);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`Pixel Kingdoms running on port ${PORT}`));
