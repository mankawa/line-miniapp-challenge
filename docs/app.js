const cfg = window.APP_CONFIG;
const MOCK = !cfg.LIFF_ID || new URLSearchParams(location.search).has("mock");
const GOAL_IDEAS = ["禁酒", "フラフープ1日100回", "週2日は休肝日","毎日1万歩", "夜21時以降は食べない", "毎日ストレッチ"];
const WD = ["日", "月", "火", "水", "木", "金", "土"];

const app = document.getElementById("app");
let idToken = null;
let code = null;
let state = null;
let viewUser = null; // カレンダーで見ている人
let editingGoal = false;
let busy = false;

// ---------- utils ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const addDays = (day, n) => {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diffDays = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400e3);
const todayJST = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const md = (day) => `${+day.slice(5, 7)}/${+day.slice(8, 10)}`;
const weekday = (day) => WD[new Date(day + "T00:00:00Z").getUTCDay()];

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 2400);
}

function avatar(m, size = "") {
  if (m.picture) return `<img class="avatar ${size}" src="${esc(m.picture)}" alt="">`;
  return `<span class="avatar ${size}">${esc([...m.name][0] || "?")}</span>`;
}

function shareUrl() {
  return MOCK ? `https://miniapp.line.me/（LIFF ID）?c=${code}` : `https://miniapp.line.me/${cfg.LIFF_ID}?c=${code}`;
}

// ---------- api ----------
async function api(action, payload = {}) {
  if (MOCK) return MockApi.call(action, payload);
  const res = await fetch(cfg.API_URL, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: cfg.API_KEY },
    body: JSON.stringify({ action, idToken, ...payload }),
  });
  const data = await res.json().catch(() => ({ error: "通信エラーが起きました" }));
  if (!res.ok) throw new Error(data.error || "エラーが起きました");
  return data;
}

async function run(fn) {
  if (busy) return;
  busy = true;
  try {
    await fn();
  } catch (e) {
    toast(e.message);
  } finally {
    busy = false;
  }
}

// ---------- 集計 ----------
function statsFor(userId) {
  const { challenge: ch, today } = state;
  const log = new Map(state.checkins.filter((x) => x.userId === userId).map((x) => [x.day, x.status]));
  const last = today < ch.endDate ? today : ch.endDate;
  let done = 0, half = 0, fail = 0, rest = 0, miss = 0;
  for (let d = ch.startDate; d <= last; d = addDays(d, 1)) {
    const v = log.get(d);
    if (v === "ok") done++;
    else if (v === "half") half++;
    else if (v === "ng") fail++;
    else if (v === "rest") rest++;
    else if (d < today) miss++; // 今日の未入力はまだ失敗扱いしない
  }
  // △は0.5日ぶん。連続記録は△でも途切れない。予定どおりのお休みは数えずに飛ばす
  const score = done + half / 2;
  let streak = 0;
  let d = last;
  if (d === today && !log.has(d)) d = addDays(d, -1);
  for (; d >= ch.startDate; d = addDays(d, -1)) {
    const v = log.get(d);
    if (v === "ok" || v === "half") streak++;
    else if (v !== "rest") break;
  }
  return { log, done, half, fail, rest, miss, score, streak };
}

// ---------- 画面 ----------
function renderError(msg) {
  app.innerHTML = `<div class="card"><h2>うまく開けませんでした</h2><p class="muted">${esc(msg)}</p>
    <button class="btn sub" style="margin-top:14px" onclick="location.reload()">もう一度開く</button></div>`;
}

function mockBar() {
  return MOCK ? `<div class="mockbar">お試しモード（LINEにつながず、この端末の中だけで動いています）</div>` : "";
}

function renderCreate() {
  const today = todayJST();
  app.innerHTML = `${mockBar()}
    <h1>新しいチャレンジ</h1>
    <p class="muted">作ったら招待リンクをグループに貼ってね。開いた人が目標を決めて参加できるよ。</p>
    <form class="card" id="createForm">
      <label for="title">チャレンジ名</label>
      <input type="text" id="title" maxlength="40" value="1ヶ月チャレンジ" required>
      <label for="start">開始日</label>
      <input type="date" id="start" value="${today}" min="${addDays(today, -7)}" max="${addDays(today, 30)}" required>
      <label for="days">期間</label>
      <select id="days">
        ${[7, 14, 21, 30, 31, 60, 90].map((n) => `<option value="${n}" ${n === 30 ? "selected" : ""}>${n}日間</option>`).join("")}
      </select>
      <button class="btn" style="margin-top:18px">チャレンジを作る</button>
    </form>`;
  document.getElementById("createForm").onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await api("create", {
        title: document.getElementById("title").value,
        startDate: document.getElementById("start").value,
        days: Number(document.getElementById("days").value),
      });
      code = r.id;
      const url = new URL(location.href);
      url.searchParams.set("c", code);
      history.replaceState(null, "", url);
      await refresh();
    });
  };
}

function periodText() {
  const ch = state.challenge;
  return `${md(ch.startDate)}(${weekday(ch.startDate)}) 〜 ${md(ch.endDate)}(${weekday(ch.endDate)})・${diffDays(ch.startDate, ch.endDate) + 1}日間`;
}

function renderJoin() {
  const me = state.members.find((m) => m.userId === state.me);
  const others = state.members.filter((m) => m.userId !== state.me);
  app.innerHTML = `${mockBar()}
    <h1>${esc(state.challenge.title)}</h1>
    <p class="muted">${periodText()}</p>
    ${others.length ? `<div class="card"><h2>参加中のメンバー（${others.length}人）</h2>
      <div class="member-chips">${others.map((m) => `<span class="member-chip">${avatar(m)}${esc(m.name)}：${esc(m.goal)}</span>`).join("")}</div></div>` : ""}
    <form class="card" id="joinForm">
      <h2>${me ? "目標を変更する" : "あなたの目標は？"}</h2>
      <p class="muted">お酒をやめる人は「禁酒」。飲む派の人は代わりの目標でもOK！</p>
      <input type="text" id="goal" maxlength="40" placeholder="例：フラフープ1日100回" value="${esc(me?.goal ?? "")}" required style="margin-top:12px">
      <div class="chips">${GOAL_IDEAS.map((g) => `<button type="button" class="chip">${esc(g)}</button>`).join("")}</div>
      <button class="btn" style="margin-top:18px">${me ? "保存する" : "この目標で参加する"}</button>
      ${me ? `<button type="button" class="btn sub" id="cancelEdit" style="margin-top:8px">もどる</button>` : ""}
    </form>
    ${shareCard()}`;
  app.querySelectorAll(".chip").forEach((b) => (b.onclick = () => (document.getElementById("goal").value = b.textContent)));
  const cancel = document.getElementById("cancelEdit");
  if (cancel) cancel.onclick = () => { editingGoal = false; render(); };
  document.getElementById("joinForm").onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      state = await api("join", { c: code, goal: document.getElementById("goal").value });
      editingGoal = false;
      viewUser = state.me;
      render();
      toast(me ? "目標を変更したよ" : "参加しました！がんばろう💪");
    });
  };
  bindShare();
}

function shareCard() {
  return `<div class="card"><h2>グループに招待する</h2>
    <p class="muted">このリンクをLINEグループに貼ると、開いた人が参加できるよ。</p>
    <div class="share-url">${esc(shareUrl())}</div>
    <div class="stack">
      <button class="btn" id="shareBtn">LINEで送る</button>
      <button class="btn sub" id="copyBtn">リンクをコピー</button>
    </div></div>`;
}

function bindShare() {
  const text = `「${state.challenge.title}」やろう！\n毎日「頑張れた／ちょっとだけ／挫折」を押して競争するよ💪\n${shareUrl()}`;
  document.getElementById("copyBtn").onclick = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl());
      toast("リンクをコピーしたよ");
    } catch {
      toast("コピーできませんでした。長押しでコピーしてね");
    }
  };
  document.getElementById("shareBtn").onclick = () =>
    run(async () => {
      if (!MOCK && liff.isApiAvailable("shareTargetPicker")) {
        await liff.shareTargetPicker([{ type: "text", text }]);
      } else if (!MOCK) {
        location.href = `https://line.me/R/share?text=${encodeURIComponent(text)}`;
      } else {
        toast("お試しモードでは送れません");
      }
    });
}

function todayCard() {
  const { challenge: ch, today } = state;
  const me = state.members.find((m) => m.userId === state.me);
  if (today < ch.startDate) {
    return `<div class="card"><h2>開始まであと${diffDays(today, ch.startDate)}日</h2>
      <p class="muted">${md(ch.startDate)}から記録できるよ。目標：${esc(me.goal)}</p></div>`;
  }
  if (today > ch.endDate) {
    return `<div class="card"><h2>チャレンジ終了！おつかれさま🎉</h2>
      <p class="muted">最終結果はランキングを見てね。</p></div>`;
  }
  const log = statsFor(state.me).log;
  const v = log.get(today);
  const yesterday = addDays(today, -1);
  const yv = log.get(yesterday);
  const sel = (want, cur) => (cur === want ? "selected" : cur === undefined ? "" : "dim");
  const RECORDED = { ok: "記録したよ。ナイス！", half: "記録したよ。おしい！", ng: "記録したよ。明日がんばろう", rest: "予定どおりのお休み。楽しんで！" };
  return `<div class="card" id="todayCard">
    <p class="muted">今日 ${md(today)}(${weekday(today)}) の目標</p>
    <p class="today-goal">${esc(me.goal)}</p>
    <div class="big-buttons">
      <button class="big ok ${sel("ok", v)}" data-day="${today}" data-status="ok"><span class="emoji">🙆</span>頑張れた</button>
      <button class="big half ${sel("half", v)}" data-day="${today}" data-status="half"><span class="emoji">🤏</span>ちょっとだけ</button>
      <button class="big ng ${sel("ng", v)}" data-day="${today}" data-status="ng"><span class="emoji">🙅</span>挫折</button>
    </div>
    <button class="rest-btn ${sel("rest", v)}" data-day="${today}" data-status="rest">🍻 もともと飲む予定だった日（お休み）</button>
    ${v === undefined ? "" : `<p class="recorded">${RECORDED[v]} <button class="linkbtn" data-day="${today}" data-status="">取り消す</button></p>`}
    ${yesterday >= ch.startDate ? `<div class="yesterday"><span>昨日 ${md(yesterday)} ${yv === undefined ? "<b>未入力</b>" : ""}</span>
      <span class="pair">
        <button class="small-btn ok ${yv === "ok" ? "selected" : ""}" data-day="${yesterday}" data-status="ok">○</button>
        <button class="small-btn half ${yv === "half" ? "selected" : ""}" data-day="${yesterday}" data-status="half">△</button>
        <button class="small-btn ng ${yv === "ng" ? "selected" : ""}" data-day="${yesterday}" data-status="ng">✕</button>
        <button class="small-btn rest ${yv === "rest" ? "selected" : ""}" data-day="${yesterday}" data-status="rest">休</button>
      </span></div>` : ""}
  </div>`;
}

function rankingCard() {
  const today = state.today;
  const rows = state.members
    .map((m) => ({ m, s: statsFor(m.userId) }))
    .sort((a, b) => b.s.score - a.s.score || b.s.streak - a.s.streak || a.s.fail - b.s.fail);
  let prev = null, rank = 0;
  return `<div class="card"><h2>ランキング</h2>
    ${rows.map(({ m, s }, i) => {
      const key = `${s.score}-${s.streak}-${s.fail}`;
      if (key !== prev) rank = i + 1;
      prev = key;
      const t = s.log.get(today);
      const mark = { ok: "🙆", half: "🤏", ng: "🙅", rest: "🍻" }[t] ?? "<span class='muted'>…</span>";
      return `<div class="rank-row ${m.userId === viewUser ? "active" : ""}" data-user="${esc(m.userId)}">
        <span class="rank-no ${rank <= 3 ? "top" : ""}">${rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : rank}</span>
        ${avatar(m)}
        <div class="rank-main">
          <div class="rank-name">${esc(m.name)}${m.userId === state.me ? '<span class="you">あなた</span>' : ""}</div>
          <div class="rank-goal">${esc(m.goal)}</div>
        </div>
        <div class="rank-stat"><b>${s.score}</b>日<div class="streak">🔥${s.streak}日連続</div></div>
        <span class="today-mark" title="今日">${mark}</span>
      </div>`;
    }).join("")}
    <p class="muted" style="margin-top:8px">△は0.5日で計算。予定どおりのお休みは数えず、連続も途切れないよ。右はしは今日の記録。名前をタップするとカレンダーが見られるよ。</p>
  </div>`;
}

function calendarCard() {
  const { challenge: ch, today } = state;
  const m = state.members.find((x) => x.userId === viewUser) || state.members.find((x) => x.userId === state.me);
  const s = statsFor(m.userId);
  const mine = m.userId === state.me;
  const lead = new Date(ch.startDate + "T00:00:00Z").getUTCDay();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(`<div class="cell"></div>`);
  for (let d = ch.startDate; d <= ch.endDate; d = addDays(d, 1)) {
    const v = s.log.get(d);
    let cls = "in", mark = "";
    if (v === "ok") { cls = "done"; mark = "○"; }
    else if (v === "half") { cls = "half"; mark = "△"; }
    else if (v === "ng") { cls = "fail"; mark = "✕"; }
    else if (v === "rest") { cls = "rest"; mark = "休"; }
    else if (d < today) { cls = "miss"; mark = "?"; }
    else if (d > today) cls = "future";
    const label = d === ch.startDate || d.endsWith("-01") ? md(d) : +d.slice(8);
    // 自分の先の日はタップでお休みの予定を入れたり消したりできる
    const tap = mine && d > today ? `data-day="${d}" data-status="${v === "rest" ? "" : "rest"}"` : "";
    cells.push(`<div class="cell ${cls} ${d === today ? "today" : ""} ${tap ? "tappable" : ""}" ${tap}><span>${label}</span><span class="m">${mark}</span></div>`);
  }
  return `<div class="card">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">${avatar(m)}
      <div><h2 style="margin:0">${esc(m.name)}のカレンダー</h2><div class="muted">${esc(m.goal)}</div></div></div>
    <div class="cal-summary">
      <div><b style="color:var(--green)">${s.done}</b><span class="muted">頑張れた</span></div>
      <div><b style="color:var(--orange)">${s.half}</b><span class="muted">ちょっとだけ</span></div>
      <div><b style="color:var(--red)">${s.fail}</b><span class="muted">挫折</span></div>
      <div><b style="color:var(--blue)">${s.rest}</b><span class="muted">お休み</span></div>
      <div><b style="color:var(--muted)">${s.miss}</b><span class="muted">未入力</span></div>
    </div>
    <div class="cal">${WD.map((w) => `<div class="wd">${w}</div>`).join("")}${cells.join("")}</div>
    <div class="legend">
      <span><i style="background:var(--green)"></i>頑張れた</span>
      <span><i style="background:var(--orange)"></i>ちょっとだけ</span>
      <span><i style="background:var(--red)"></i>挫折</span>
      <span><i style="background:var(--blue)"></i>予定どおりお休み</span>
      <span><i style="border:1.5px dashed #c5cdca"></i>未入力</span>
    </div>
    ${mine && today < ch.endDate ? `<p class="muted" style="margin-top:8px">🍻 飲み会などの予定がある日は、先の日付をタップしてお休みにしておけるよ（もう一度タップで取り消し）。</p>` : ""}
  </div>`;
}

function renderMain() {
  const ch = state.challenge;
  const total = diffDays(ch.startDate, ch.endDate) + 1;
  const dayNo = Math.min(Math.max(diffDays(ch.startDate, state.today) + 1, 0), total);
  app.innerHTML = `${mockBar()}
    <div class="header">
      <div><h1>${esc(ch.title)}</h1><p class="muted">${periodText()}</p></div>
      <div class="daycount"><b>${dayNo}</b><span class="muted"> / ${total}日目</span></div>
    </div>
    <div class="progress"><div style="width:${(dayNo / total) * 100}%"></div></div>
    ${todayCard()}
    ${rankingCard()}
    ${calendarCard()}
    ${shareCard()}
    <p style="text-align:center;margin-top:12px"><button class="linkbtn" id="editGoal">自分の目標を変更する</button></p>`;

  app.querySelectorAll("[data-status]").forEach((b) => {
    b.onclick = () =>
      run(async () => {
        const status = b.dataset.status || null;
        state = await api("checkin", { c: code, day: b.dataset.day, status });
        viewUser = state.me;
        render();
        if (b.dataset.day > state.today) {
          toast(status ? `${md(b.dataset.day)}をお休みの予定にしたよ🍻` : `${md(b.dataset.day)}のお休みを取り消したよ`);
        } else if (status === "ok" && b.dataset.day === state.today) {
          document.getElementById("todayCard")?.classList.add("celebrate");
          toast(`ナイス！🎉 ${statsFor(state.me).streak}日連続`);
        }
      });
  });
  app.querySelectorAll(".rank-row").forEach((r) => {
    r.onclick = () => {
      viewUser = r.dataset.user;
      render();
      app.querySelector(".cal")?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
  });
  document.getElementById("editGoal").onclick = () => { editingGoal = true; render(); scrollTo(0, 0); };
  bindShare();
}

function render() {
  const joined = state.members.some((m) => m.userId === state.me);
  if (!joined || editingGoal) renderJoin();
  else renderMain();
}

async function refresh() {
  state = await api("state", { c: code });
  if (!viewUser) viewUser = state.me;
  render();
}

async function boot() {
  try {
    if (!MOCK) {
      await liff.init({ liffId: cfg.LIFF_ID });
      if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: location.href });
        return;
      }
      idToken = liff.getIDToken();
    }
    // LIFF は init 後に ?c= を復元するので、ここで読む
    code = new URLSearchParams(location.search).get("c");
    if (code) await refresh();
    else renderCreate();
  } catch (e) {
    renderError(e.message);
  }
}

// 他の人の記録を取り込むため、アプリに戻ってきたら読み直す
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && code && state && !busy && !editingGoal) run(refresh);
});

boot();
