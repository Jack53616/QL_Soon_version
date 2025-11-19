// QL Trading AI v2.1 — Frontend logic
const TWA = window.Telegram?.WebApp;
const INVISIBLE_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;
const VALID_KEY_CHARS = /^[A-Za-z0-9._\-+=]+$/;
const KEY_FRAGMENT_RE = /[A-Za-z0-9][A-Za-z0-9._\-+=]{3,}[A-Za-z0-9=]?/g;
const BANNED_KEY_WORDS = new Set([
  "key", "code", "subscription", "subs", "sub", "token", "pass", "password",
  "link", "your", "this", "that", "here", "is", "for", "the", "my",
  "http", "https", "www", "click", "press", "bot", "created", "generated"
]);

const scoreToken = (token) => {
  const lower = token.toLowerCase();
  const length = token.length;
  const digitCount = (token.match(/\d/g) || []).length;
  const letterCount = (token.match(/[A-Za-z]/g) || []).length;

  let score = 0;
  if (digitCount) score += 6;
  if (/[-_]/.test(token)) score += 2;
  if (/[+=]/.test(token)) score += 1;
  if (digitCount && letterCount) score += 2;
  if (length >= 28) score += 6;
  else if (length >= 20) score += 5;
  else if (length >= 16) score += 4;
  else if (length >= 12) score += 3;
  else if (length >= 8) score += 2;
  else if (length >= 6) score += 1;

  const digitRatio = length ? digitCount / length : 0;
  if (digitRatio >= 0.5) score += 4;
  else if (digitRatio >= 0.35) score += 2;

  const upperCount = (token.match(/[A-Z]/g) || []).length;
  if (upperCount >= 4 && letterCount) score += 1;

  if (length > 32) score -= Math.min(length - 32, 12);
  if (length > 64) score -= Math.min(length - 64, 12);

  if (BANNED_KEY_WORDS.has(lower)) score -= 12;
  if (/^(key|code|token|pass)/.test(lower)) score -= 8;
  if (lower.includes("created") || lower.includes("generated")) score -= 6;
  if (lower.includes("http") || lower.includes("www") || lower.includes("tme")) score -= 15;
  if (lower.includes("telegram")) score -= 8;
  if (lower.includes("start=")) score -= 6;

  return score;
};

const sanitizeToken = (candidate = "") => {
  if (!candidate) return "";
  let token = candidate
    .replace(INVISIBLE_CHARS, "")
    .trim();
  if (!token) return "";
  token = token.replace(/^[^A-Za-z0-9]+/, "").replace(/[^A-Za-z0-9=]+$/, "");
  if (!token) return "";
  if (!VALID_KEY_CHARS.test(token)) {
    token = token.replace(/[^A-Za-z0-9._\-+=]+/g, "");
  }
  if (token.length < 4) return "";
  return token;
};

const sanitizedCollapsed = (text = "") => {
  if (!text) return "";
  const collapsed = text.replace(/[^A-Za-z0-9._\-+=]+/g, "");
  return collapsed.length >= 4 ? collapsed : "";
};

const extractKeyCandidates = (raw = "") => {
  if (!raw) return [];
  const normalized = raw.normalize("NFKC").replace(INVISIBLE_CHARS, " ").trim();
  if (!normalized) return [];
  const seen = new Map();
  const candidates = [];
  const sanitizedParts = [];

  const register = (token, boost = 0) => {
    const sanitized = sanitizeToken(token);
    if (!sanitized) return;
    const key = sanitized.toLowerCase();
    if (seen.has(key)) return;
    const score = scoreToken(sanitized) + boost;
    seen.set(key, score);
    candidates.push({ token: sanitized, score, idx: candidates.length });
  };

  const pushMatches = (text, boost = 0) => {
    if (!text) return;
    const matches = text.match(KEY_FRAGMENT_RE);
    if (matches) matches.forEach(match => register(match, boost));
  };

  pushMatches(normalized, 1);

  const startMatch = normalized.match(/start=([A-Za-z0-9._\-+=]+)/i);
  if (startMatch) register(startMatch[1], 6);

  normalized
    .split(/[\s|,;:/\\]+/)
    .map(part => part.trim())
    .filter(Boolean)
    .forEach(part => {
      const sanitizedPart = sanitizeToken(part);
      if (sanitizedPart) {
        sanitizedParts.push({
          value: sanitizedPart,
          hasDigits: /\d/.test(sanitizedPart),
          hasLetters: /[A-Za-z]/.test(sanitizedPart)
        });
      }
      const eqIndex = part.indexOf("=");
      if (eqIndex >= 0 && eqIndex < part.length - 1) {
        register(part.slice(eqIndex + 1), 5);
      }
      register(part);
      pushMatches(part);
    });

  for (let i = 0; i < sanitizedParts.length - 1; i++) {
    const first = sanitizedParts[i];
    const second = sanitizedParts[i + 1];
    const joined = first.value + second.value;
    if (joined.length >= 6 && (first.hasDigits || second.hasDigits)) {
      register(joined, first.hasDigits && second.hasDigits ? 6 : 5);
    }
  }

  for (let i = 0; i < sanitizedParts.length - 2; i++) {
    const a = sanitizedParts[i];
    const b = sanitizedParts[i + 1];
    const c = sanitizedParts[i + 2];
    const joined = a.value + b.value + c.value;
    if (joined.length >= 8 && (a.hasDigits || b.hasDigits || c.hasDigits)) {
      register(joined, 4);
    }
  }

  const collapsed = sanitizedCollapsed(normalized);
  if (collapsed) {
    const lowerCollapsed = collapsed.toLowerCase();
    const startsWithMeta = /^(key|code|token|pass)/.test(lowerCollapsed);
    register(collapsed, startsWithMeta ? -2 : 1);
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.token.length !== a.token.length) return b.token.length - a.token.length;
    return a.idx - b.idx;
  });

  return candidates.map(c => c.token);
};
const state = {
  tg_id: null,
  token: null,
  user: null,
  lang: localStorage.getItem("lang") || "en",
  feedTimer: null,
  musicOn: false,
  method: "usdt_trc20",
  methodAddr: ""
};

document.body.classList.add("is-gated");

const i18n = {
  en: {
    gateTitle: "QL Trading — Access",
    gateSub: "Enter your subscription key to unlock your wallet",
    confirm: "Confirm",
    buyKey: "Buy a key",
    tabWallet: "Home",
    tabMarkets: "Markets",
    tabTrades: "Trades",
    tabWithdraw: "Withdraw",
    tabRequests: "Requests",
    tabSupport: "Support",
    noOpenTrade: "No open trade",
    withdraw: "Withdraw",
    markets: "Markets",
    support: "Support",
    day: "Day",
    month: "Month",
    subLeft: "Subscription",
    recent: "Recent activity",
    recentSub: "Wallet history",
    live: "Live feed",
    liveSub: "QL Trading feed",
    withdrawCrypto: "Withdraw (crypto only)",
    request: "Request",
    savedAddr: "* Saved address will be used for the selected method.",
    deposit: "Deposit",
    yourRequests: "Your requests",
    supportCenter: "Support Center",
    chooseMethod: "Choose withdraw method",
    cancel: "Cancel",
    myTrades: "My trades",
    save: "Save",
    settingsTitle: "Account & Settings",
    profile: "Profile",
    id: "ID",
    name: "Name",
    email: "Email",
    broker: "Broker",
    xmLinked: "Linked",
    xmNote: "Your QL Wallet is connected with XM trading infrastructure."
  },
  ar: {
    gateTitle: "QL Trading — دخول",
    gateSub: "أدخل مفتاح الاشتراك لفتح محفظتك",
    confirm: "تأكيد",
    buyKey: "شراء مفتاح",
    tabWallet: "الرئيسية",
    tabMarkets: "الأسواق",
    tabTrades: "صفقاتي",
    tabWithdraw: "السحب",
    tabRequests: "الطلبات",
    tabSupport: "الدعم",
    noOpenTrade: "لا توجد صفقة مفتوحة",
    withdraw: "سحب",
    markets: "الأسواق",
    support: "الدعم",
    day: "اليوم",
    month: "الشهر",
    subLeft: "الاشتراك",
    recent: "النشاط الأخير",
    recentSub: "سجل المحفظة",
    live: "بث مباشر",
    liveSub: "تحديثات QL Trading",
    withdrawCrypto: "سحب (عملات رقمية فقط)",
    request: "طلب",
    savedAddr: "* سيتم استخدام العنوان المحفوظ للطريقة المحددة.",
    deposit: "إيداع",
    yourRequests: "طلباتك",
    supportCenter: "مركز الدعم",
    chooseMethod: "اختر طريقة السحب",
    cancel: "إلغاء",
    myTrades: "صفقاتي",
    save: "حفظ",
    settingsTitle: "الحساب والإعدادات",
    profile: "الملف الشخصي",
    id: "المعرّف",
    name: "الاسم",
    email: "البريد الإلكتروني",
    broker: "شركة التداول",
    xmLinked: "مربوط",
    xmNote: "محفظة QL مربوطة ببنية التداول الخاصة بشركة XM."
  },
  tr: {
    gateTitle: "QL Trading — Giriş",
    gateSub: "Cüzdanınızı açmak için abonelik anahtarınızı girin",
    confirm: "Onayla",
    buyKey: "Anahtar satın al",
    tabWallet: "Ana sayfa",
    tabMarkets: "Piyasalar",
    tabTrades: "İşlemlerim",
    tabWithdraw: "Çekim",
    tabRequests: "Talepler",
    tabSupport: "Destek",
    noOpenTrade: "Açık işlem yok",
    withdraw: "Çekim",
    markets: "Piyasalar",
    support: "Destek",
    day: "Gün",
    month: "Ay",
    subLeft: "Abonelik",
    recent: "Son aktiviteler",
    recentSub: "Cüzdan geçmişi",
    live: "Canlı akış",
    liveSub: "QL Trading akışı",
    withdrawCrypto: "Çekim (sadece kripto)",
    request: "Talep",
    savedAddr: "* Kayıtlı adres seçilen yöntem için kullanılacaktır.",
    deposit: "Yatırma",
    yourRequests: "Talepleriniz",
    supportCenter: "Destek merkezi",
    chooseMethod: "Çekim yöntemini seçin",
    cancel: "İptal",
    myTrades: "İşlemlerim",
    save: "Kaydet",
    settingsTitle: "Hesap ve ayarlar",
    profile: "Profil",
    id: "ID",
    name: "İsim",
    email: "E-posta",
    broker: "Aracı kurum",
    xmLinked: "Bağlı",
    xmNote: "QL cüzdanınız XM işlem altyapısına bağlıdır."
  },
  de: {
    gateTitle: "QL Trading — Zugang",
    gateSub: "Gib deinen Aboschlüssel ein, um deine Wallet zu öffnen",
    confirm: "Bestätigen",
    buyKey: "Schlüssel kaufen",
    tabWallet: "Start",
    tabMarkets: "Märkte",
    tabTrades: "Meine Trades",
    tabWithdraw: "Auszahlung",
    tabRequests: "Anfragen",
    tabSupport: "Support",
    noOpenTrade: "Kein offener Trade",
    withdraw: "Auszahlen",
    markets: "Märkte",
    support: "Support",
    day: "Tag",
    month: "Monat",
    subLeft: "Abo",
    recent: "Letzte Aktivitäten",
    recentSub: "Wallet-Verlauf",
    live: "Live-Feed",
    liveSub: "QL Trading Feed",
    withdrawCrypto: "Auszahlung (nur Krypto)",
    request: "Anfrage",
    savedAddr: "* Die gespeicherte Adresse wird für die gewählte Methode verwendet.",
    deposit: "Einzahlung",
    yourRequests: "Deine Anfragen",
    supportCenter: "Support-Center",
    chooseMethod: "Auszahlungsmethode wählen",
    cancel: "Abbrechen",
    myTrades: "Meine Trades",
    save: "Speichern",
    settingsTitle: "Konto & Einstellungen",
    profile: "Profil",
    id: "ID",
    name: "Name",
    email: "E-Mail",
    broker: "Broker",
    xmLinked: "Verbunden",
    xmNote: "Deine QL Wallet ist mit der XM-Trading-Infrastruktur verbunden."
  }
};

function t(key){
  const lang = state.lang;
  return (i18n[lang] && i18n[lang][key]) || (i18n.en[key]||key);
}
function applyI18n(){
  document.querySelectorAll("[data-i18n]").forEach(el=>{
    el.textContent = t(el.dataset.i18n);
  });
  document.body.dir = (state.lang === "ar") ? "rtl" : "ltr";
}

const $ = (q)=>document.querySelector(q);
const $$ = (q)=>document.querySelectorAll(q);

// Splash fade then gate
setTimeout(()=> { $("#splash")?.classList.add("hidden"); }, 1800);

const cleanKeyInput = (value = "") => extractKeyCandidates(value)[0] || "";

// Setup TG id
function detectTG(){
  try{
    const initDataUnsafe = TWA?.initDataUnsafe;
    const tgId = initDataUnsafe?.user?.id || null;
    state.tg_id = tgId;
  }catch{ state.tg_id = null; }
}

// Token (optional)
async function getToken(){
  if(!state.tg_id) return;
  const r = await fetch("/api/token",{method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({tg_id: state.tg_id})}).then(r=>r.json());
  if(r.ok) state.token = r.token;
}

// Activate
const gateBtn = $("#g-activate");
gateBtn?.addEventListener("click", async ()=>{
  if(gateBtn.disabled) return;
  const rawKey = $("#g-key").value || "";
  const candidates = extractKeyCandidates(rawKey);
  const key = candidates[0] || cleanKeyInput(rawKey);
  const name = $("#g-name").value.trim();
  const email = $("#g-email").value.trim();
  if(!key) return toast("Enter key");
  const tg_id = state.tg_id || Number(prompt("Enter Telegram ID (test):","1262317603"));
  if(!tg_id){ toast("Missing Telegram ID"); return; }
  const initData = TWA?.initData || null;
  const payload = { key, rawKey, candidates, tg_id, name, email, initData };

  const restore = gateBtn.textContent;
  gateBtn.disabled = true;
  gateBtn.textContent = "...";

  try{
    const r = await fetch("/api/activate",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload)
    }).then(r=>r.json());
    if(!r?.ok){
      toast(r?.error || "Invalid key");
      return;
    }
    state.user = r.user;
    localStorage.setItem("tg", r.user.tg_id);
    hydrateUser(r.user);
    unlockGate();
    $("#g-key").value = "";
    if(r.reused){ notify("🔓 Session restored"); }
    const opened = await openApp(r.user);
    // Store session permanently
    localStorage.setItem("activated", "yes");

    // Remove gate visually
    document.body.classList.remove("is-gated");
    const gateEl = document.querySelector(".gate");
    if(gateEl){
        gateEl.classList.add("hidden");
        gateEl.style.pointerEvents = "none";
    }

    if(!opened){
      showGate();
      toast("Unable to open wallet");
    }
  }catch(err){
    console.error("Activation failed", err);
    toast("Connection error");
  }finally{
    gateBtn.disabled = false;
    gateBtn.textContent = restore;
  }
});
function toast(msg){ const el=$("#g-toast"); el.textContent=msg; setTimeout(()=> el.textContent="", 2500); }

function showGate(){
  if(state.feedTimer){ clearInterval(state.feedTimer); state.feedTimer = null; }
  document.body.classList.add("is-gated");
  $(".gate")?.classList.remove("hidden");
  $("#app")?.classList.add("hidden");
}

function unlockGate(){
  document.body.classList.remove("is-gated");
  $(".gate")?.classList.add("hidden");
  $("#app")?.classList.remove("hidden");
}

// App open
async function openApp(user = null, { auto = false } = {}){
  if(user){
    state.user = user;
    hydrateUser(user);
  }
  if(!state.user?.tg_id){
    if(!auto) toast("Please sign in again");
    showGate();
    return false;
  }
  if(!user){
    try{
      await refreshUser(true);
    }catch(err){
      console.warn("Failed to refresh session", err);
      state.user = null;
      localStorage.removeItem("tg");
      showGate();
      return false;
    }
  }
  unlockGate();
  applyI18n();
  if(user){
    refreshUser();
  }
  startFeed();
  refreshOps();
  refreshRequests();
  refreshMarkets();
  return true;
}

// Tabs
$$(".seg-btn").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    $$(".seg-btn").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    $$(".tab").forEach(s=>s.classList.remove("show"));
    $(`#tab-${tab}`)?.classList.add("show");
  });
});

$("#goWithdraw").onclick = ()=>{ document.querySelector('[data-tab="withdraw"]').click(); }
$("#goMarkets").onclick  = ()=>{ document.querySelector('[data-tab="markets"]').click(); }
$("#goSupport").onclick  = ()=>{ document.querySelector('[data-tab="support"]').click(); }

// Language
$("#btnLang").addEventListener("click", ()=>{
  const order = ["en","ar","tr","de"];
  const idx = order.indexOf(state.lang);
  state.lang = order[(idx+1)%order.length];
  localStorage.setItem("lang", state.lang);
  applyI18n();
});

// Settings panel
const settingsPanel = $("#settingsPanel");
const settingsBackdrop = $("#settingsBackdrop");
const btnSettings = $("#btnSettings");
const spClose = $("#spClose");

function openSettings(){
  if(!settingsPanel) return;
  settingsPanel.classList.remove("hidden");
  settingsPanel.classList.add("show");
  settingsBackdrop?.classList.remove("hidden");
  settingsBackdrop?.classList.add("show");
}

function closeSettings(){
  settingsPanel?.classList.remove("show");
  settingsBackdrop?.classList.remove("show");
  setTimeout(()=>{
    settingsPanel?.classList.add("hidden");
    settingsBackdrop?.classList.add("hidden");
  },200);
}

btnSettings?.addEventListener("click", openSettings);
spClose?.addEventListener("click", closeSettings);
settingsBackdrop?.addEventListener("click", closeSettings);

// Withdraw sheet
const sheet = $("#sheet");
$("#pickMethod").addEventListener("click", ()=> sheet.classList.add("show"));
$("#sCancel").addEventListener("click", ()=> sheet.classList.remove("show"));
$$(".s-item").forEach(b=>{
  b.addEventListener("click", ()=>{
    state.method = b.dataset.method;
    $("#methodLabel").textContent = b.textContent;
    renderMethod();
    sheet.classList.remove("show");
  });
});

function renderMethod(){
  const map = {
    usdt_trc20: "USDT (TRC20)",
    usdt_erc20: "USDT (ERC20)",
    btc: "Bitcoin",
    eth: "Ethereum"
  };
  $("#methodLabel").textContent = map[state.method] || "USDT (TRC20)";
  $("#methodView").innerHTML = `
    <div class="muted">Saved address:</div>
    <input id="addr" class="input" placeholder="Your ${map[state.method]||'Wallet'} address..."/>
    <button id="saveAddr" class="btn">Save</button>
  `;
  $("#saveAddr").onclick = async ()=>{
    const address = $("#addr").value.trim();
    const tg = state.user?.tg_id || Number(localStorage.getItem("tg"));
    await fetch("/api/withdraw/method",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({tg_id:tg, method:state.method, address})
    });
    notify("✅ Address saved");
  }
}
renderMethod();

$("#reqWithdraw").addEventListener("click", async ()=>{
  const tg = state.user?.tg_id || Number(localStorage.getItem("tg"));
  const amount = Number($("#amount").value || 0);
  if(amount<=0) return notify("Enter amount");
  const r = await fetch("/api/withdraw",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({tg_id:tg, amount, method: state.method})
  }).then(r=>r.json());
  if(!r.ok) return notify("❌ "+(r.error||"Error"));
  notify("✅ Request sent");
  refreshUser(); refreshRequests();
});

// WhatsApp deposit
$("#whatsapp").onclick = ()=> window.open("https://wa.me/message/P6BBPSDL2CC4D1","_blank");

// Data
function hydrateUser(user){
  if(!user) return;
  const balance = Number(user.balance || 0);
  $("#balance").textContent = "$" + balance.toFixed(2);
  $("#subLeft").textContent = user.sub_expires ? new Date(user.sub_expires).toLocaleDateString() : "—";

  // Reset ticker to neutral (no fake movement)
  const tickerEl = $("#ticker");
  if(tickerEl){
    tickerEl.textContent = "+0.00";
    tickerEl.style.color = "#9df09d";
  }

  // Settings profile data
  const name = user.name || user.first_name || "";
  const email = user.email || "";
  const tgId = user.tg_id || user.id || "";
  const spTgId = $("#spTgId");
  const spName = $("#spName");
  const spEmail = $("#spEmail");
  if(spTgId) spTgId.textContent = tgId || "—";
  if(spName) spName.textContent = name || "—";
  if(spEmail) spEmail.textContent = email || "—";
}
async function refreshUser(required = false){
  const tg = state.user?.tg_id || Number(localStorage.getItem("tg"));
  if(!tg){
    if(required) throw new Error("missing_tg");
    return false;
  }
  let payload = null;
  try{
    payload = await fetch(`/api/user/${tg}`).then(r=>r.json());
  }catch(err){
    if(required) throw err;
    return false;
  }
  if(payload?.ok){
    state.user = payload.user;
    hydrateUser(payload.user);
    return true;
  }
  if(required) throw new Error(payload?.error || "user_not_found");
  return false;
}

async function refreshOps(){
  const tg = state.user?.tg_id || Number(localStorage.getItem("tg"));
  if(!tg) return;
  const r = await fetch(`/api/ops/${tg}`).then(r=>r.json());
  const box = $("#ops"); box.innerHTML = "";
  if(r.ok){
    r.list.forEach(o=>{
      const div = document.createElement("div");
      div.className="op";
      div.innerHTML = `<span>${o.type||'op'}</span><b>${Number(o.amount).toFixed(2)}</b>`;
      box.appendChild(div);
    });
  }
}

async function refreshRequests(){
  const tg = state.user?.tg_id || Number(localStorage.getItem("tg"));
  if(!tg) return;
  const r = await fetch(`/api/requests/${tg}`).then(r=>r.json());
  const box = $("#reqList"); box.innerHTML = "";
  if(r.ok){
    r.list.forEach(req=>{
      const div = document.createElement("div");
      div.className="op";
      div.innerHTML = `<span>#${req.id} — ${req.method} — ${req.status}</span><b>$${Number(req.amount).toFixed(2)}</b>`;
      if(req.status==="pending"){
        const b = document.createElement("button");
        b.className="btn"; b.style.marginLeft="8px"; b.textContent="Cancel";
        b.onclick = async ()=>{
          const tg = state.user?.tg_id || Number(localStorage.getItem("tg"));
          await fetch("/api/withdraw/cancel",{method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({tg_id:tg, id:req.id})});
          refreshRequests(); refreshUser();
        };
        div.appendChild(b);
      }
      box.appendChild(div);
    });
  }
}

// Markets
async function refreshMarkets(){
  try{
    const r = await fetch("/api/markets").then(r=>r.json());
    if(!r.ok) return;
    $$(".mkt").forEach(card=>{
      const sym = card.dataset.sym;
      const price = r.data?.[sym] || 0;
      card.querySelector(".price").textContent = "$"+Number(price).toFixed(2);
      // spark fake
      const c = card.querySelector("canvas");
      const ctx = c.getContext("2d");
      ctx.clearRect(0,0,c.width,c.height);
      ctx.beginPath();
      let y = 40 + Math.random()*8;
      ctx.moveTo(0,y);
      for(let x=0; x<c.width; x+=8){
        y += (Math.random()-0.5)*4;
        ctx.lineTo(x,y);
      }
      ctx.lineWidth = 2; ctx.strokeStyle = "#7fe0ff";
      ctx.stroke();
      // pct
      const pct = ((Math.random()-.5)*2).toFixed(2);
      card.querySelector(".pct").textContent = (pct>0?"+":"") + pct + "%";
      card.querySelector(".pct").style.color = (pct>=0) ? "#9df09d" : "#ff8899";
    });
  }catch{}
}

// Live feed (وهمي كل 20 ثانية)
const names = ["أحمد","محمد","خالد","سارة","رامي","نور","ليلى","وسيم","حسن","طارق"];
function startFeed(){
  if(state.feedTimer) clearInterval(state.feedTimer);
  const feed = $("#feed");
  const push = (txt)=>{
    const it = document.createElement("div");
    it.className="item"; it.textContent = txt;
    feed.prepend(it);
    $("#sndNotify")?.play().catch(()=>{});
    while(feed.childElementCount>12) feed.lastChild.remove();
  };
  const once = ()=>{
    const r = Math.random();
    const name = names[Math.floor(Math.random()*names.length)];
    if(r<0.34){
      const v = 50+Math.floor(Math.random()*200);
      push(`🪙 ${name} سحب ${v}$ بنجاح`);
    }else if(r<0.67){
      const v = 20+Math.floor(Math.random()*120);
      const m = ["Gold","BTC","ETH","Silver"][Math.floor(Math.random()*4)];
      push(`💰 ${name} ربح ${v}$ من صفقة ${m}`);
    }else{
      const v = 150+Math.floor(Math.random()*400);
      push(`🎉 مستخدم جديد انضم وأودع ${v}$`);
    }
  };
  once();
  state.feedTimer = setInterval(once, 20000);
}

// Balance ticker is now driven only by real backend values.
let tickerI = 0;
async function loadTrades(){
  const tg = state.user?.tg_id || Number(localStorage.getItem("tg"));
  // ما في endpoint لائحة، نعرض من ops كتمثيل مبسط:
  const box = $("#tradesList"); box.innerHTML = "";
  const div = document.createElement("div");
  div.className="op";
  div.innerHTML = `<span>Open trade: XAUUSD</span><b>running...</b>`;
  box.appendChild(div);
}
$("#saveSLTP").onclick = ()=>{
  notify("✅ SL/TP saved");
};

// Helpers
function notify(msg){
  const el = document.createElement("div");
  el.className="feed item";
  el.textContent = msg;
  $("#feed").prepend(el);
  $("#sndNotify")?.play().catch(()=>{});
  setTimeout(()=>{ el.remove();}, 6000);
}

// Boot
(async function(){
  detectTG();

// Auto-skip gate if activated before
if (localStorage.getItem("activated") === "yes") {
    document.body.classList.remove("is-gated");
    const g = document.querySelector(".gate");
    if(g){
        g.classList.add("hidden");
        g.style.pointerEvents = "none";
    }
}

  await getToken();
  applyI18n();

  // إذا عنده TG محفوظ، جرّب تفتح مباشرة
  const old = localStorage.getItem("tg");
  if(old){
    state.user = { tg_id: Number(old) };
    const opened = await openApp(null, { auto: true });
    if(!opened) showGate();
  }else{
    showGate();
  }
})();
