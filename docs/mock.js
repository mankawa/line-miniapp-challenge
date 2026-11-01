// LIFF ID 未設定 or ?mock=1 のときに使う、ブラウザ内だけで動くお試し用 API。
// 本番の challenge-api と同じ形のデータを返す。データは localStorage に保存。
window.MockApi = (() => {
  const KEY = "challenge-mock-v1";
  const ME = { userId: "U_me", name: "あなた", picture: null };
  const FRIENDS = [
    { userId: "U_a", name: "さき", goal: "禁酒" },
    { userId: "U_b", name: "けんた", goal: "禁酒" },
    { userId: "U_c", name: "ゆう", goal: "平日は禁酒" },
  ];

  const todayJST = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const addDays = (day, n) => {
    const d = new Date(day + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || { challenges: {} }; } catch { return { challenges: {} }; }
  };
  const save = (db) => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };

  function state(db, c) {
    const ch = db.challenges[c];
    if (!ch) throw new Error("チャレンジが見つかりません。リンクを確認してね");
    const { members, checkins, ...challenge } = ch;
    return { challenge, members, checkins, me: ME.userId, today: todayJST() };
  }

  async function call(action, p) {
    await new Promise((r) => setTimeout(r, 150));
    const db = load();
    const today = todayJST();
    switch (action) {
      case "state":
        return state(db, p.c);
      case "create": {
        const id = Math.random().toString(36).slice(2, 10);
        const startDate = p.startDate || today;
        // 雰囲気が分かるように友だち3人と、過去日の記録を入れておく
        const checkins = [];
        for (const f of FRIENDS) {
          for (let d = startDate; d < today; d = addDays(d, 1)) {
            const r = Math.random();
            if (r < 0.75) checkins.push({ userId: f.userId, day: d, done: true });
            else if (r < 0.9) checkins.push({ userId: f.userId, day: d, done: false });
          }
          if (Math.random() < 0.5) checkins.push({ userId: f.userId, day: today, done: true });
        }
        db.challenges[id] = {
          id, title: p.title, startDate, endDate: addDays(startDate, p.days - 1),
          members: FRIENDS.map((f) => ({ ...f, picture: null })),
          checkins,
        };
        save(db);
        return { id };
      }
      case "join": {
        const ch = db.challenges[p.c];
        const m = ch.members.find((x) => x.userId === ME.userId);
        if (m) m.goal = p.goal;
        else ch.members.push({ ...ME, goal: p.goal });
        save(db);
        return state(db, p.c);
      }
      case "checkin": {
        const ch = db.challenges[p.c];
        if (p.day > today || p.day < addDays(today, -1)) throw new Error("記録できるのは今日と昨日だけだよ");
        ch.checkins = ch.checkins.filter((x) => !(x.userId === ME.userId && x.day === p.day));
        if (p.done !== null) ch.checkins.push({ userId: ME.userId, day: p.day, done: p.done });
        save(db);
        return state(db, p.c);
      }
    }
    throw new Error("unknown action");
  }

  return { call };
})();
