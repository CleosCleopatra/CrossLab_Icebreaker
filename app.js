import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import {
  getDatabase, ref, onValue, set, update, get, remove
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

/* ============================================================
   1. FIREBASE CONFIG
   Replace these values with your Firebase Web App config.
   ============================================================ */
const firebaseConfig = {
  apiKey: "AIzaSyC2mB6W7nxSUnGjdB2GEIfZyPNZNDeVpMc",
  authDomain: "croabfirst.firebaseapp.com",
  databaseURL: "https://croabfirst-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "croabfirst",
  storageBucket: "croabfirst.firebasestorage.app",
  messagingSenderId: "848355538465",
  appId: "1:848355538465:web:98ef4a1da7aa50a96e9560"
};

/* ============================================================
   2. GROUPS
   Rwa1 ↔ Swe1, Rwa2 ↔ Swe2, Rwa3 ↔ Swe3
   ============================================================ */
const GROUPS = ["Rwa1","Rwa2","Rwa3","Swe1","Swe2","Swe3"];
const PARTNER = {
  Rwa1:"Swe1", Rwa2:"Swe2", Rwa3:"Swe3",
  Swe1:"Rwa1", Swe2:"Rwa2", Swe3:"Rwa3"
};
const COUNTRY = g => g.startsWith("Rwa") ? "Rwanda" : "Sweden";

/* ============================================================
   3. QUESTIONS
   Types:
   - countryGuess: each active group can have its own target
     country. Both halves are displayed side-by-side.
   - single: only the listed groups answer; one half is shown.
   - cultural: two stages:
       own = answer for your own country
       other = guess what the other country answered
     Final reveal shows all four distributions.
   ============================================================ */
const QUESTIONS = [
  {
    id:"q1",
    type:"countryGuess",
    title:"How many people live in the average household?",
    options:["1","2","3","4","5","6+"],
    correct:{Sweden:"2", Rwanda:"4"},
    activeGroups:{
      Rwa1:"Sweden",
      Swe1:"Rwanda"
    }
  },
  {
    id:"q2",
    type:"countryGuess",
    title:"What time is dinner typically eaten?",
    options:["4–5 PM","5–6 PM","6–7 PM","7–8 PM","8–9 PM","9–10 PM"],
    correct:{Sweden:"6–7 PM", Rwanda:"8–9 PM"},
    activeGroups:{
      Rwa1:"Sweden",
      Swe1:"Rwanda"
    }
  },
  {
    id:"q3",
    type:"single",
    title:"How many national upper-secondary programmes does Sweden have?",
    options:["8","12","15","18","21","24"],
    correct:{Sweden:"18"},
    activeGroups:{
      Rwa1: "Rwanda",
      Rwa2:"Rwanda",
      Rwa3: "Rwanda"
    }
  },
  {
    id:"q4",
    type:"single",
    title:"What percentage of Rwandan households owned a mobile phone in 2024?",
    options:["35%","50%","65%","75%","85%","95%"],
    correct:{Rwanda:"85%"},
    activeGroups:{
      Swe1:"Sweden",
      Swe2:"Sweden",
      Swe3:"Sweden"
    }
  },
  {
    id:"q5",
    type:"cultural",
    title:"If you and a friend have decided to meet up at 18:01, when would you be there?",
    options:["before 17:30","17:30-18:00","18:00 - 18:15","18:15-18:30","18:30 - 19:00","after 19:00"]
  }
];

/* ============================================================
   APP STATE
   ============================================================ */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
let uid = null;
let selectedGroup = localStorage.getItem("crosslabGroup") || null;
let session = null;
let stopSessionListener = null;
let stopAnswersListener = null;

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
}[c]));

function getPairKey(group){
  const partner = PARTNER[group];
  return [group, partner].sort().join("-");
}

function dbSession(){ return ref(db,"crosslab/session"); }
function dbAnswers(qid){ return ref(db,`crosslab/answers/${qid}`); }

function activeForQuestion(q, group){
  if(q.type === "cultural") return true;
  return Object.prototype.hasOwnProperty.call(q.activeGroups || {}, group);
}

function targetFor(q, group){
  return q.activeGroups?.[group] || COUNTRY(group);
}

function currentQuestion(){
  if(!session || !selectedGroup) return QUESTIONS[0];
  const pairKey = getPairKey(selectedGroup);
  const pairSession = session.pairs?.[pairKey];
  return QUESTIONS.find(q => q.id === pairSession?.questionId) || QUESTIONS[0];
}

async function resetPartnerGroup(){
  if(!confirm(`Are you sure you want to reset the session for ${selectedGroup} and ${PARTNER[selectedGroup]}?\n\nOther groups will not be affected.`)){
    return;
  }

  const partnerGroup = PARTNER[selectedGroup];

  for (const q of QUESTIONS){
    const answers = window.currentAnswers || {};
    const entriesToDelete = Object.entries(answers).filter(([uid, answer]) => {
      return answer.group === selectedGroup || answer.group === partnerGroup;
    });

    for (const [uid, _] of entriesToDelete){
      await remove(ref(db, `crosslab/answers/${q.id}/${uid}`));
    }
  }

  alert(`Reset complete for ${selectedGroup} and @{PARTNER[selectedGroup]}`);
  render();
}

async function ensureAuth(){
  if(firebaseConfig.apiKey.startsWith("PASTE_")){
    renderError("Firebase is not configured yet. Open app.js and paste your Firebase Web App configuration.");
    return;
  }
  onAuthStateChanged(auth, async user => {
    if(user){
      uid = user.uid;
      render();
      subscribe();
    }
  });
  try { await signInAnonymously(auth); }
  catch(e){ renderError("Could not sign in anonymously: " + e.message); }
}

function subscribe(){
  if(stopSessionListener) stopSessionListener();
  stopSessionListener = onValue(dbSession(), snap => {
    session = snap.val();
    render();
    subscribeAnswers();
  });
}

function subscribeAnswers(){
  if(stopAnswersListener){
    stopAnswersListener();
    stopAnswersListener  = null;
  }

  if(!session || !selectedGroup) return;

  const pairKey = getPairKey(selectedGroup);
  const pairSession = session.pairs?.[pairKey];

  if(!pairSession?.questionId) return;

  const qid = pairSession.questionId;

  window.currentAnswers = {};

  stopAnswersListener = onValue(
    dbAnswers(qid), snap => {
    window.currentAnswers = snap.val() || {};
    render();
  });
}

function renderError(message){
  $("app").innerHTML = `<div class="screen center"><div class="card narrow">
    <h2>Setup needed</h2><p>${esc(message)}</p></div></div>`;
}

function render(){
  if(!uid) return;
  if(!selectedGroup){ renderGroupPicker(); return; }
  if(location.hash === "#host"){ renderHost(); return; }
  if(!session){ renderWaiting(); return; }
  renderStudent();
}

function renderGroupPicker(){
  $("app").innerHTML = `<div class="screen center"><div class="card narrow">
    <div class="logo">CrossLab</div>
    <h1>Choose your group</h1>
    <p class="muted">Choose the group you are working in. You can change this later by using the button at the bottom.</p>
    <div class="group-grid">
      <div class="group-row-label">Rwanda</div>
      ${["Rwa1","Rwa2","Rwa3"].map(g=>`<button class="group-btn" data-group="${g}">🇷🇼 ${g}</button>`).join("")}
      <div class="group-row-label">Sweden</div>
      ${["Swe1","Swe2","Swe3"].map(g=>`<button class="group-btn" data-group="${g}">🇸🇪 ${g}</button>`).join("")}
    </div>
  </div></div>`;
  document.querySelectorAll("[data-group]").forEach(b => b.onclick = () => {
    selectedGroup = b.dataset.group;
    localStorage.setItem("crosslabGroup",selectedGroup);
    render();
  });
}

function renderWaiting(){
  $("app").innerHTML = `<div class="screen center"><div class="card narrow center-actions">
    <div class="logo">CrossLab</div>
    <h1>You're in ${esc(selectedGroup)}</h1>
    <p class="muted">Waiting for the first question…</p>
    <button class="secondary" id="changeGroup">Change group</button>
  </div></div>`;
  $("changeGroup").onclick = () => {
    localStorage.removeItem("crosslabGroup"); selectedGroup=null; render();
  };
}

function renderStudent(){
  const q = currentQuestion();
  const active = activeForQuestion(q, selectedGroup);
  const answers = window.currentAnswers || {};
  const pairKey = getPairKey(selectedGroup);
  const pairSession = session?.pairs?.[pairKey] || {};
  const revealed = !!pairSession.revealed;
  const phase = pairSession.phase || "answer";

  if(q.type === "cultural"){
    renderCultural(q, answers, revealed, phase);
  } else {
    renderStandard(q, answers, revealed, active);
  }
}

function topbar(){
  const pairKey = getPairKey(selectedGroup);
  const pairSession = session?.pairs?.[pairKey] || {};

  return `<div class="topbar">
    <div>
      <span class="logo">CrossLab</span> · 
      ${esc(selectedGroup)} · 
      partner: ${esc(PARTNER[selectedGroup])}
      </div>
    <span class="status">
    ${pairSession?.revealed ? "Answers revealed" : "Live"}</span>
  </div>`;
}

function renderStandard(q, answers, revealed, active){
  const target = targetFor(q, selectedGroup);
  const isTwo = q.type === "countryGuess";
  const activeGroups = q.activeGroups || {};
  const answer = answers[uid]?.answer ?? null;
  const halves = isTwo ? ["Sweden","Rwanda"] : [target];
  const canTriggerReveal = !revealed && (q.type === "single" || active);

  $("app").innerHTML = `<div class="screen"><div class="question-layout">
    ${topbar()}
    <div class="phase-pill">${isTwo ? "Two countries · one guess" : "Group question"}</div>
    <h1 class="question-title">${esc(q.title)}</h1>
    <div class="halves">
      ${halves.map(country => {
        const enabled = isTwo ? target === country : active;
        return halfHtml(q,country,enabled,answer,revealed,answers);
      }).join("")}
    </div>

    <div class="next-row">
      ${!revealed && active ? `<button class="primary" id="submitBtn">${answer ? "Change answer" : "Submit answer"}</button>` : ""}
      ${canTriggerReveal ? `<button class="secondary" id="readyBtn">Everyone has answered</button>` : ""}
    </div>
    <div id="revealArea"></div>
    <div class="center-actions">
      <button class="secondary" id="changeGroup">Change group</button>
    </div>
  </div></div>`;

  document.querySelectorAll("[data-option]").forEach(b => b.onclick = () => {
    if(revealed || !active) return;
    document.querySelectorAll(".option").forEach(x=>x.classList.remove("selected"));
    b.classList.add("selected");
    window.pendingAnswer = b.dataset.option;
  });
  $("submitBtn")?.addEventListener("click", submitStandard);
  $("readyBtn")?.addEventListener("click", readyToReveal);
  $("changeGroup").onclick = () => {
    localStorage.removeItem("crosslabGroup"); selectedGroup=null; render();
  };

  if(revealed) renderReveal(q,answers);
}

function halfHtml(q,country,enabled,selected,revealed,answers){
  const countryFlag = country === "Sweden" ? "🇸🇪" : "🇷🇼";
  const counts = countAnswers(answers, country, q);
  return `<section class="half ${enabled ? "" : "disabled"}">
    <h3>${countryFlag} ${country}</h3>
    ${!enabled ? `<div class="notice">You are not answering this side.</div>` : ""}
    ${q.options.map(o => `<button class="option ${selected===o && enabled ? "selected":""}"
      data-option="${esc(o)}" ${(!enabled||revealed)?"disabled":""}>${esc(o)}</button>`).join("")}
  </section>`;
}

async function submitStandard(){
  const q=currentQuestion();
  const answer = window.pendingAnswer ?? window.currentAnswers?.[uid]?.answer;
  if(!answer){ alert("Choose an answer first."); return; }
  
  const answerData = {
    answer: answer,
    group: selectedGroup,
    country: COUNTRY(selectedGroup),
    target: targetFor(q, selectedGroup),
    submittedAt: Date.now()
  };
  try{
  await set(ref(db,`crosslab/answers/${q.id}/${uid}`),
    answerData);

    window.currentAnswers = {
      ...(window.currentAnswers || {}),
      [uid]: answerData
    };
    
    window.pendingAnswer=null;
    render();
} catch(e) {
  console.error("Failed to submit answer: ", e);
  alert("Could not save your answer: " + e.message)
}
}

async function readyToReveal(){
  const q=currentQuestion();
  const answers=window.currentAnswers||{};
  const pairKey = getPairKey(selectedGroup);

  const required = pairKey
    .split("-")
    .filter(g => activeForQuestion(q,g));
  
  const groupsPresent = required.every(g => Object.values(answers).some(a=>a.group===g));


  await update(ref(db, `crosslab/session/pairs/${pairKey}`), {revealed:true});
}

function requiredGroups(q){
  if(q.type==="single") return Object.keys(q.activeGroups||{});
  if(q.type==="countryGuess") return Object.keys(q.activeGroups||{});
  return GROUPS;
}

function countAnswers(answers,country,q){
  const counts={};
  q.options.forEach(o=>counts[o]=0);
  Object.values(answers||{}).forEach(a=>{
    if(a.target===country && q.type==="countryGuess") counts[a.answer]=(counts[a.answer]||0)+1;
  });
  return counts;
}

function renderReveal(q,answers){
  const area=$("revealArea");
  if(!area) return;
  if(q.type==="countryGuess"){
    area.innerHTML=`<div class="reveal"><h2>Reveal</h2>
      <div class="result-columns">
        ${["Sweden","Rwanda"].map(c=>resultBox(q,c,answers)).join("")}
      </div>
      <div class="next-row"><button class="primary" id="nextBtn">Next question</button></div>
    </div>`;
  }else{
    const target=targetFor(q,selectedGroup);
    area.innerHTML=`<div class="reveal"><h2>Reveal</h2>${resultBox(q,target,answers)}
      <div class="next-row"><button class="primary" id="nextBtn">Next question</button></div>
    </div>`;
  }
  $("nextBtn").onclick=nextQuestion;
}

function resultBox(q,country,answers){
  const counts = countAnswers(answers,country,q);
  const total=Object.values(counts).reduce((a,b)=>a+b,0);
  const correct=q.correct?.[country];
  return `<div class="result-box"><h3>${country==="Sweden"?"🇸🇪":"🇷🇼"} ${country}</h3>
    ${correct ? `<div class="correct">Correct answer: ${esc(correct)}</div>`:""}
    ${q.options.map(o=>{
      const n=counts[o]||0;
      const pct=total ? Math.round(n/total*100):0;
      return `<div class="bar-row"><span>${esc(o)}</span><div class="bar"><div class="fill" style="width:${pct}%"></div></div><strong>${n}</strong></div>`;
    }).join("")}
  </div>`;
}

function renderCultural(q,answers,revealed,phase){
  const myCountry=COUNTRY(selectedGroup);
  const other=myCountry==="Sweden"?"Rwanda":"Sweden";
  const own=answers[uid]?.own ?? null;
  const guess=answers[uid]?.guess ?? null;

  if(revealed){
    $("app").innerHTML=`<div class="screen"><div class="question-layout">
      ${topbar()}<div class="phase-pill">Cultural question · reveal</div>
      <h1 class="question-title">${esc(q.title)}</h1>
      <div class="result-columns">
        ${culturalBox(q,"Sweden",answers,"own")}
        ${culturalBox(q,"Rwanda",answers,"own")}
      </div>
      <h2 style="margin-top:30px">What the other country guessed</h2>
      <div class="result-columns">
        ${culturalGuessBox(q,"Sweden",answers,"guess")}
        ${culturalGuessBox(q,"Rwanda",answers,"guess")}
      </div>
      <div class="next-row"><button class="primary" id="nextBtn">Next question</button></div>
    </div></div>`;
    $("nextBtn").onclick=nextQuestion;
    return;
  }

  const isOwnPhase=phase!=="other";
  const prompt=isOwnPhase
    ? `Answer for your own country: ${myCountry}`
    : `Guess what people in ${other} answered`;

  $("app").innerHTML=`<div class="screen"><div class="question-layout">
    ${topbar()}
    <div class="phase-pill">Cultural question · ${isOwnPhase?"1/2":"2/2"}</div>
    <h1 class="question-title">${esc(q.title)}</h1>
    <div class="notice"><strong>${esc(prompt)}</strong></div>
    <div class="halves">
      <section class="half">
        <h3>${isOwnPhase?(myCountry==="Sweden"?"🇸🇪":"🇷🇼"):(other==="Sweden"?"🇸🇪":"🇷🇼")} ${isOwnPhase?myCountry:other}</h3>
        ${q.options.map(o=>{
          const selected=isOwnPhase?own:guess;
          return `<button class="option ${selected===o?"selected":""}" data-cultural="${esc(o)}">${esc(o)}</button>`;
        }).join("")}
      </section>
      <section class="half disabled">
        <h3>${isOwnPhase?(other==="Sweden"?"🇸🇪":"🇷🇼"):(myCountry==="Sweden"?"🇸🇪":"🇷🇼")} ${isOwnPhase?other:myCountry}</h3>
        <div class="notice">${isOwnPhase?"You are answering for your own country first.":"Your answer for your own country is already recorded."}</div>
      </section>
    </div>
    <div class="next-row"><button class="primary" id="submitCultural">Submit</button>
      <button class="secondary" id="readyCultural">Everyone has answered</button></div>
  </div></div>`;

  document.querySelectorAll("[data-cultural]").forEach(b=>b.onclick=()=>{
    document.querySelectorAll("[data-cultural]").forEach(x=>x.classList.remove("selected"));
    b.classList.add("selected"); window.pendingCultural=b.dataset.cultural;
  });
  $("submitCultural").onclick=submitCultural;
  $("readyCultural").onclick=readyCultural;
}

async function submitCultural(){
  const q=currentQuestion();
  const value=window.pendingCultural ?? null;
  if(!value){alert("Choose an answer first.");return;}

  const pairKey = getPairKey(selectedGroup);
  const pairSession = session.pairs?.[pairKey];
  const field = pairSession?.phase === "other" ? "guess" : "own";

  try{
    await update(ref(db,`crosslab/answers/${q.id}/${uid}`),{
    [field]:value,
    group:selectedGroup,
    country:COUNTRY(selectedGroup),
    submittedAt:Date.now()
  });

  window.pendingCultural = null;

  render();
  }catch(e) {
    console.error("Failed to submit cultural answer:", e);
    alert("Could not save your answer: " + e.message);
  }
}

async function readyCultural(){
  const q=currentQuestion(); 
  const answers=window.currentAnswers||{};
  const required=GROUPS;
  const pairKey = getPairKey(selectedGroup);
  const pairSession = session.pairs?.[pairKey];

  const allOwn=required.every(g=>Object.values(answers).some(a=>a.group===g && a.own));

  if(pairSession?.phase!=="other"){
    if(!allOwn){
      alert("Everyone needs to answer for their own country first.");
      return;
    }
    await update(ref(db, `crosslab/session/pairs/${pairKey}`), {phase: "other"});
  }else{
    const allGuess=required.every(g=>Object.values(answers).some(a=>a.group===g && a.guess));
    if(!allGuess){
      alert("Everyone needs to guess the other country first.");
      return;
    }
    await update(ref(db, `crosslab/session/pairs/${pairKey}`), {revealed: true});
  }
}

function culturalBox(q,country,answers,field){
  const counts={}; q.options.forEach(o=>counts[o]=0);
  Object.values(answers||{}).forEach(a=>{if(a.country===country && a[field])counts[a[field]]++;});
  const total=Object.values(counts).reduce((a,b)=>a+b,0);
  return `<div class="result-box"><h3>${country==="Sweden"?"🇸🇪":"🇷🇼"} ${country} — actual answers</h3>
    ${q.options.map(o=>bar(o,counts[o],total)).join("")}</div>`;
}

function culturalGuessBox(q,targetCountry,answers,field){
  const counts={}; q.options.forEach(o=>counts[o]=0);
  Object.values(answers||{}).forEach(a=>{if(a.country!==targetCountry && a.guess)counts[a.guess]++;});
  const total=Object.values(counts).reduce((a,b)=>a+b,0);
  return `<div class="result-box"><h3>${targetCountry==="Sweden"?"🇸🇪":"🇷🇼"} ${targetCountry} — guesses by foreigners</h3>
    ${q.options.map(o=>bar(o,counts[o],total)).join("")}</div>`;
}

function bar(label,n,total){
  const pct=total?Math.round(n/total*100):0;
  return `<div class="bar-row"><span>${esc(label)}</span><div class="bar"><div class="fill" style="width:${pct}%"></div></div><strong>${n}</strong></div>`;
}

async function nextQuestion(){
  const pairKey = getPairKey(selectedGroup);
  const pairSession = session.pairs?.[pairKey];
  const idx=QUESTIONS.findIndex(q=>q.id===pairSession.questionId);

  if (idx === -1) {
    console.warn("Current question not found in QUESTIONS array")
    return;
  }

  const next = QUESTIONS[idx + 1];

  if(!next){
    await update(ref(db, `crosslab/session/pairs/${pairKey}`), {
      questionId: "",
      phase: "answer",
      revealed: false
    });
    return;
  }
  await update(ref(db, `crosslab/session/pairs/${pairKey}`), {
    questionId: next.id,
    phase: next.type === "cultural" ? "own" : "answer",
    revealed: false
  });
}



function renderHost(){
  $("app").innerHTML=`<div class="screen"><div class="question-layout">
    <div class="topbar"><div><span class="logo">CrossLab Host</span></div><a href="#" id="studentView">Student view</a></div>
    <div class="host-grid">
      ${["Rwa1-Swe1", "Rwa2-Swe2", "Rwa3-Swe3"].map(pairKey => {
        const pairSession = session?.pairs?.[pairKey] || {};
        const q = QUESTIONS.find(q => q.id === pairSession.questionId) || QUESTIONS[0];
        return `<div class="card">
          <h2>${pairKey}</h2>
          <p><strong>Question:</strong> ${q?.title || "None"}</p>
          <p><strong>Phase:</strong> ${pairSession.phase || "—"}</p>
          <p><strong>Revealed:</strong> ${pairSession.revealed ? "Yes" : "No"}</p>
          <button class="secondary" onclick="revealPair('${pairKey}')">Reveal</button>
          <button class="secondary" onclick="nextPair('${pairKey}')">Next</button>
          <button class="danger" onclick="resetPair('${pairKey}')">Reset</button>
        </div>`;
      }).join("")}
    </div>
    <div class="card"><h2>Controls</h2>
      <button class="danger" id="resetHost">Reset all</button>
    </div>
  </div></div>`;
  
  $("studentView").onclick=e=>{e.preventDefault();location.hash="";render();};
  $("resetHost").onclick=resetSession;
}

async function revealPair(pairKey){
  await update(ref(db, `crosslab/session/pairs/${pairKey}`), {revealed: true});
}

async function nextPair(pairKey){
  const pairSession = session?.pairs?.[pairKey];
  const idx = QUESTIONS.findIndex(q => q.id === pairSession?.questionId);
  const next = QUESTIONS[idx + 1];
  
  if(!next){
    await update(ref(db, `crosslab/session/pairs/${pairKey}`), {
      questionId: "",
      phase: "answer",
      revealed: false
    });
    return;
  }
  
  await update(ref(db, `crosslab/session/pairs/${pairKey}`), {
    questionId: next.id,
    phase: next.type === "cultural" ? "own" : "answer",
    revealed: false
  });
}

async function resetPair(pairKey){
  if(!confirm(`Reset ${pairKey}?`)) return;

  try{
    const groups = pairKey.split("-");

    for(const q of QUESTIONS){
      const snap = await get(dbAnswers(q.id));
      const answers = snap.val() || {};

      for(const [answerUid, answer] of Object.entries(answers)){
        if(groups.include(answer.group)){
          await remove(
            ref(db, `crosslab/answers/${q.id}/${answerUid}`)
          );
        }
      }
    }
  
  await set(
    ref(db, `crosslab/session/pairs/${pairKey}`),
    {
      questionId: QUESTIONS[0].id,
      phase: "answer",
      revealed: false
    }
  );

  window.currentAnswers = {};
  window.pendingAnswer = null;
  window.pendingCultural = null;

  console.log(`${pairKey} reset to q1`);
} catch(e){
  console.error("Reset failed: ", e);
  alert("Could not reset " + pairKey + ": " + e.message);
}
}



async function resetSession(){
  if(!confirm("Are you sure you want to reset the entire session for all groups?")){
    return;
  }

  try{
    for (const q of QUESTIONS){
      await remove(ref(db, `crosslab/answers/${q.id}`));
    }
    await set(dbSession(), {
      pairs: {
        "Rwa1-Swe1": {
          questionId: "q1",
          phase: "answer",
          revealed: false
        },
        "Rwa2-Swe2": {
          questionId: "q1",
          phase: "answer",
          revealed: false
        },
        "Rwa3-Swe3": {
          questionId: "q1",
          phase: "answer",
          revealed: false
        }
      }
    });
    
    window.currentAnswers = {};
    window.pendingAnswer = null;
    window.pendingCultural = null;

    console.log("Entire session reset to q1");
  } catch(e) {
    console.error("Reset fialed: ", e);
    alert("Could not reset session: " + e.message);
  }
}

window.addEventListener("hashchange",render);

async function boot(){
  await ensureAuth();
  // If no session exists, create a starting session. Multiple clients
  // may attempt this; identical initial state is harmless.
  setTimeout(async()=>{
    if(uid){
      const snap=await get(dbSession());
      if(!snap.exists()){
        await set(dbSession(),{
          pairs: {
            "Rwa1-Swe1":{questionId: QUESTIONS[0].id, phase: "answer", revealed: false},
            "Rwa2-Swe2": {questionId: QUESTIONS[0].id, phase: "answer", revealed: false},
            "Rwa3-Swe3": {questionId: QUESTIONS[0].id, phase: "answer", revealed: false}
          }
        });
      }
    }
  },1000);
}
boot();
