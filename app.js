const socket = io();
const $ = id => document.getElementById(id);
let room = null, isHost = false, myRole = "player", myId = null, questionCount = 0;
let identity = null;
let roomInviteUrl = "";
const invitedRoomCode = new URLSearchParams(location.search).get("room");
try { identity = JSON.parse(sessionStorage.getItem("pk_identity") || "null"); } catch { identity = null; }
const statNames = { money:"MONEY", happiness:"HAPPINESS", goodness:"GOODNESS", energy:"ENERGY", trust:"TRUST" };
const STAT_KEYS = ["money","happiness","goodness","energy","trust"];
function token() {
  if (window.crypto?.randomUUID) return crypto.randomUUID() + crypto.randomUUID();
  return Array.from({length:48},()=>Math.floor(Math.random()*16).toString(16)).join("");
}
function saveIdentity(value) { identity=value; sessionStorage.setItem("pk_identity",JSON.stringify(value)); }
function clearIdentity() { identity=null; sessionStorage.removeItem("pk_identity"); }
function toast(msg) { $("toast").textContent=msg; $("toast").classList.remove("hidden"); setTimeout(()=>$("toast").classList.add("hidden"),3200); }
function show(id) { const target=$("screen-"+id); if(target.classList.contains("active")) return; document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active")); target.classList.add("active"); }
function esc(s) { return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

function addQuestion(data={}) {
  questionCount++;
  const n=questionCount, card=document.createElement("div");
  card.className="question-card";
  card.innerHTML=`<div class="qtop"><span>QUESTION ${n}</span><button class="back remove-q" type="button">REMOVE ×</button></div><input class="q-text" maxlength="500" placeholder="Write your question..." value="${esc(data.text||"")}"><div class="option-grid">${[0,1,2,3].map(i=>`<div class="option-line"><input type="radio" name="correct-${n}" value="${i}" ${data.correctIndex===i?"checked":i===0&&data.correctIndex==null?"checked":""}><input class="q-option" maxlength="160" placeholder="Answer ${String.fromCharCode(65+i)}" value="${esc(data.options?.[i]||"")}"></div>`).join("")}</div>`;
  card.querySelector(".remove-q").onclick=()=>{card.remove();renumber();};
  $("questions").append(card); renumber();
}
function renumber() {
  [...$("questions").children].forEach((c,i)=>c.querySelector(".qtop span").textContent=`QUESTION ${i+1}`);
  $("q-count").textContent=`${$("questions").children.length} QUESTION${$("questions").children.length===1?"":"S"}`;
}
$("create-open").onclick=()=>{show("create");if(!$("questions").children.length)addQuestion();};
$("join-open").onclick=()=>show("join");
if(invitedRoomCode && /^[A-Z0-9]{6}$/i.test(invitedRoomCode)) {
  $("join-code").value=invitedRoomCode.toUpperCase();
  show("join");
}
document.querySelectorAll("[data-home]").forEach(b=>b.onclick=()=>show("home"));
$("add-question").onclick=()=>addQuestion();

$("create-submit").onclick=()=>{
  const questions=[...$("questions").children].map(c=>({
    text:c.querySelector(".q-text").value.trim(),
    options:[...c.querySelectorAll(".q-option")].map(x=>x.value.trim()),
    correctIndex:Number(c.querySelector('input[type=radio]:checked')?.value??0)
  }));
  const hostToken=token();
  socket.emit("room:create",{name:$("host-name").value.trim(),questions,questionSeconds:$("question-time").value,eventSeconds:$("event-time").value,hostToken},res=>{
    if(!res?.ok)return toast(res?.error||"Could not create the room.");
    isHost=true;myRole="spectator";myId=null;
    saveIdentity({kind:"host",roomCode:res.code,token:hostToken});
    toast("Room created: "+res.code);show("lobby");updateRoomInvite(res.code);if(room)renderRoom();
  });
};
async function updateRoomInvite(code) {
  roomInviteUrl = `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`;
  $("room-link").value = roomInviteUrl;
  $("share-room-code").textContent = code;
  $("room-qr").classList.add("hidden");
  $("qr-loading").classList.remove("hidden");
  try {
    const response = await fetch(`/api/qr?data=${encodeURIComponent(roomInviteUrl)}`);
    const result = await response.json();
    if (!response.ok || !result.dataUrl) throw new Error(result.error || "QR generation failed");
    $("room-qr").src = result.dataUrl;
    $("room-qr").classList.remove("hidden");
    $("qr-loading").classList.add("hidden");
    $("share-status").innerHTML = `ROOM CODE: <b>${esc(code)}</b> · READY TO SCAN`;
  } catch (error) {
    $("qr-loading").textContent = "QR CODE UNAVAILABLE · SHARE THE LINK BELOW";
    toast("Could not generate QR code. You can still copy the room link.");
  }
}
$("copy-room-link").onclick=async()=>{
  if(!roomInviteUrl)return;
  try { await navigator.clipboard.writeText(roomInviteUrl); toast("Room link copied!"); }
  catch { $("room-link").select(); document.execCommand("copy"); toast("Room link copied!"); }
};

$("join-submit").onclick=()=>{
  const playerToken=token();
  socket.emit("room:join",{name:$("join-name").value.trim(),code:$("join-code").value.trim(),role:"player",playerToken},res=>{
    if(!res?.ok)return toast(res?.error||"Could not join the room.");
    isHost=false;myRole=res.role;myId=playerToken;
    saveIdentity({kind:"player",roomCode:$("join-code").value.trim().toUpperCase(),token:playerToken});
    show("lobby");
  });
};
$("join-code").addEventListener("input",e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,""));
$("role-player").onclick=()=>setRole("player");
$("role-spectator").onclick=()=>setRole("spectator");
function setRole(role){if(isHost)return;myRole=role;socket.emit("player:role",{role});renderRole();}
function renderRole(){
  $("role-player").classList.toggle("selected",myRole==="player");
  $("role-spectator").classList.toggle("selected",myRole==="spectator");
  $("role-player").disabled=isHost;$("role-spectator").disabled=isHost;
}
$("start-game").onclick=()=>socket.emit("host:start");
$("host-next").onclick=()=>socket.emit("host:next");
$("result-next").onclick=()=>socket.emit("host:next");
$("gameover-next").onclick=()=>socket.emit("host:show-results");

socket.on("connect",()=>{
  if(identity) socket.emit("room:resume",identity,res=>{
    if(!res?.ok){clearIdentity();room=null;isHost=false;myId=null;toast(res?.error||"Session expired. Please join again.");show("home");return;}
    isHost=!!res.isHost;myRole=res.role;myId=res.isHost?null:res.token;
    if(room)renderRoom();
    toast("Reconnected to your room.");
  });
});
socket.on("disconnect",()=>{if(identity)toast("Connection lost. Reconnecting...");});
socket.on("connect_error",()=>toast("Unable to connect. Check your internet connection."));
socket.on("room:update",r=>{room=r;renderRoom();});
socket.on("room:closed",()=>{toast("The room is no longer available.");clearIdentity();room=null;show("home");});

function renderRoom(){
  if(!room)return;
  $("lobby-code").textContent=room.code;$("game-code").textContent=room.code;
  $("host-controls").classList.toggle("hidden",!isHost);
  $("player-count").textContent=room.players.filter(p=>p.role==="player").length+" PLAYERS";
  $("roster").innerHTML=room.players.map(p=>`<div class="roster-item"><span>${esc(p.name)} ${p.id===myId?"(YOU)":""} ${p.online?"":"· OFFLINE"}</span><small>${p.role.toUpperCase()}</small></div>`).join("")||'<div class="empty">Waiting for players to join...</div>';
  $("host-online-label").textContent=room.hostOnline?"HOST ONLINE":"HOST RECONNECTING";
  renderRole();
  if(room.status==="lobby"){show("lobby");if(isHost && (!roomInviteUrl || !roomInviteUrl.includes(encodeURIComponent(room.code)))) updateRoomInvite(room.code);return;}
  if(["playing","event_selection","answer_feedback"].includes(room.status)){show("game");renderGame();return;}
  if(room.status==="game_over"){show("gameover");renderGameOver();return;}
  if(room.status==="results"){show("results");renderResults();}
}
function me(){return room?.players.find(p=>p.id===myId);}
function renderStats(){
  const p=me();
  $("stats").innerHTML=STAT_KEYS.map(k=>`<div class="stat"><span>${statNames[k]}</span><div class="bar"><i style="width:${Math.min(100,p?.stats[k]||0)}%"></i></div><b>${p?.stats[k]??"—"}</b></div>`).join("");
}
function timeLeft(){
  if(!room?.phaseEndsAt)return null;
  return Math.max(0,Math.ceil((room.phaseEndsAt-Date.now())/1000));
}
function renderTimer(){
  const left=timeLeft();
  $("phase-timer").classList.toggle("hidden",left===null);
  if(left!==null)$("phase-timer").textContent=`${left}s`;
}
setInterval(renderTimer,250);

function renderGame(){
  renderStats();
  $("host-bar").classList.toggle("hidden",!isHost);
  $("host-next").classList.add("hidden");
  renderTimer();
  $("game-phase").textContent=`ROUND ${room.round} / ${room.totalRounds}`;
  $("game-title").textContent=room.status==="event_selection"?"YOUR ANSWER & CITY EVENT":room.status==="answer_feedback"?"ANSWER RESULTS":"A QUESTION FOR YOUR KINGDOM";
  $("host-next").textContent="NEXT ROUND →";
  $("host-next").classList.add("hidden");
  const answered=room.answered.includes(myId);
  const correct=room.correctPlayers.includes(myId);
  const eventDone=room.eventSelections.includes(myId);
  const feedback=room.answerFeedback?.[myId];
  const options=room.question?.options||[];
  const answerSummary=feedback?`<div class="answer-feedback ${feedback.correct?"is-correct":"is-wrong"}">
    <div class="feedback-heading">${feedback.timedOut?"TIME'S UP":feedback.correct?"✓ CORRECT!":"✕ INCORRECT!"}</div>
    <div class="feedback-line"><span>Your answer</span><b>${feedback.selectedIndex===null?"No answer":esc(options[feedback.selectedIndex]||"—")}</b></div>
    <div class="feedback-line"><span>Correct answer</span><b>${esc(options[feedback.correctIndex]||"—")}</b></div>
    ${feedback.penaltyStat?`<div class="penalty-note"><strong>PENALTY</strong><span>${statNames[feedback.penaltyStat]} −${feedback.penaltyAmount}</span><small>Your kingdom lost 10 points in one random status category.</small></div>`:""}
  </div>`:"";
  const eventChoicesMarkup=()=>{
    const choices=room.eventChoices[myId]||[];
    if(eventDone)return `<p class="muted event-wait">✓ Event selected. Waiting for the other players...</p>`;
    return `<div class="inline-events"><p class="eyebrow">CHOOSE ONE RANDOM EVENT · ${timeLeft()??0}s LEFT</p><h3>SHAPE YOUR KINGDOM</h3><div class="event-options">${choices.map(e=>`<button class="event-choice" data-event="${e.id}"><b>${esc(e.title)}</b><div class="delta">${Object.entries(e.delta).map(([k,v])=>`<div class="${v<0?"negative":""}">${statNames[k]} ${v>0?"+":""}${v}</div>`).join("")}</div></button>`).join("")}</div></div>`;
  };

  if(isHost){
    $("question-area").innerHTML=`<p class="eyebrow">HOST OBSERVER VIEW</p><div class="question-text">${esc(room.question?.text||"")}</div><p class="muted">Answers received: ${room.answered.length} / ${room.players.filter(p=>p.role==="player").length}</p><p class="muted">${room.status==="event_selection"?"Event selection time remaining: "+(timeLeft()??0)+" seconds.":room.status==="answer_feedback"?"Showing answer results...":"Question time remaining: "+(timeLeft()??0)+" seconds."}</p>`;
  } else if(myRole==="spectator"){
    $("question-area").innerHTML=`<p class="eyebrow">SPECTATOR VIEW</p><div class="question-text">${esc(room.question?.text||"")}</div><p class="muted">You are watching this match. You cannot answer after the game has started.</p>`;
  } else if(room.status==="playing" && !answered){
    $("question-area").innerHTML=`<p class="eyebrow">CHOOSE THE CORRECT ANSWER</p><div class="question-text">${esc(room.question?.text||"")}</div><div class="answer-grid">${options.map((o,i)=>`<button class="answer-btn" data-answer="${i}">${String.fromCharCode(65+i)}. ${esc(o)}</button>`).join("")}</div>`;
    document.querySelectorAll("[data-answer]").forEach(b=>b.onclick=()=>{
      document.querySelectorAll("[data-answer]").forEach(x=>x.disabled=true);
      socket.emit("player:answer",{index:Number(b.dataset.answer)});
    });
  } else if(answered || room.status==="event_selection" || room.status==="answer_feedback"){
    const timedOut=!feedback;
    const header=feedback?answerSummary:`<div class="answer-feedback is-wrong"><div class="feedback-heading">TIME'S UP</div><p class="muted">You did not submit an answer in time.</p></div>`;
    const canChoose=room.status==="event_selection" && correct && !isHost && myRole==="player";
    const eventSection=canChoose?eventChoicesMarkup():room.status==="event_selection" && correct && eventDone?eventChoicesMarkup():"";
    const waiting=room.status==="event_selection" && !correct?`<p class="muted event-wait">No event selection for this answer. Waiting for the next round...</p>`:"";
    $("question-area").innerHTML=`<p class="eyebrow">QUESTION ${room.round} RESULT</p><div class="question-text">${esc(room.question?.text||"")}</div>${header}${eventSection}${waiting}${room.status==="answer_feedback"?`<p class="muted event-wait">Moving to the next question...</p>`:""}`;
    $("question-area").querySelectorAll("[data-event]").forEach(b=>b.onclick=()=>{
      $("question-area").querySelectorAll("[data-event]").forEach(x=>x.disabled=true);
      socket.emit("player:event",{eventId:Number(b.dataset.event)});
    });
  } else {
    $("question-area").innerHTML=`<p class="eyebrow">WAITING</p><div class="question-text">Waiting for the next question...</div>`;
  }
  // The answer result and event choices intentionally share the question panel.
  $("event-area").classList.add("hidden");
  $("host-status").textContent=room.status==="event_selection"
    ? `EVENT PHASE · ${room.eventSelections.length} / ${room.correctPlayers.length} EVENTS CHOSEN`
    : room.status==="answer_feedback"?"SHOWING ANSWER RESULTS":`${room.answered.length} / ${room.players.filter(p=>p.role==="player").length} PLAYERS ANSWERED`;
}
function renderGameOver(){
  $("gameover-next").classList.toggle("hidden",!isHost);
  $("gameover-message").textContent=isHost
    ? "The final round is complete. Reveal the kingdom rankings when you are ready."
    : "The final round is complete. Please wait for the host to reveal the results.";
}

function renderResults(){
  $("host-bar").classList.toggle("hidden",!isHost);
  $("host-next").classList.remove("hidden");
  const idx=room.resultIndex,cats=room.results.categories;
  $("result-content").classList.remove("reveal-content");
  void $("result-content").offsetWidth;
  $("result-content").classList.add("reveal-content");
  $("result-next").disabled=!isHost;
  if(idx<cats.length){
    const c=cats[idx];
    $("results-title").textContent=statNames[c.key]+" RANKING";
    $("results-sub").textContent="Top 5 cities · Host controls the next reveal";
    $("result-content").innerHTML=c.rows.filter((r,i)=>i<5 || r.value===c.rows[4]?.value).map((r,i)=>`<div class="rank-row" style="--reveal-order:${i}"><span class="rank-num">#${i+1}</span><span class="rank-name">${esc(r.name)}</span><span class="rank-value">${r.value} · ${r.points} PTS</span></div>`).join("")||'<p class="empty">No player results.</p>';
    $("result-host-status").textContent=`CATEGORY ${idx+1} OF 6`;
    $("result-next").textContent="NEXT CATEGORY →";
  } else if(idx===cats.length){
    $("results-title").textContent="TOTAL KINGDOM SCORE";
    $("results-sub").textContent="All five category scores combined";
    $("result-content").innerHTML=room.results.total.map((r,i)=>`<div class="rank-row" style="--reveal-order:${i}"><span class="rank-num">#${r.rank}</span><span class="rank-name">${esc(r.name)}</span><span class="rank-value">${r.score} PTS</span></div>`).join("");
    $("result-host-status").textContent="FINAL RESULTS";
    $("result-next").textContent="FINISH";
  } else {
    $("results-title").textContent="THANK YOU, RULERS!";
    $("results-sub").textContent="The kingdom challenge is complete.";
    $("result-content").innerHTML='<div class="question-text" style="text-align:center">Well played, everyone.</div>';
    $("result-next").disabled=true;
    $("result-host-status").textContent="GAME COMPLETE";
  }
}
