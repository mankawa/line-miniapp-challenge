// LINE ミニアプリ「みんなでチャレンジ」の API。
// すべて POST { action, idToken, ... }。LINE の ID トークンを検証して本人を特定する。
import postgres from "npm:postgres@3.4.4";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 3 });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const todayJST = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const text = (s: unknown, max: number) => {
  const t = typeof s === "string" ? s.trim() : "";
  if (!t || [...t].length > max) throw new HttpError(400, `1〜${max}文字で入力してね`);
  return t;
};

// ミニアプリは開発用・審査用・本番用でチャネルIDが別なので、カンマ区切りで複数持つ
let channelIds: string[] | undefined;
async function verifyUser(idToken: unknown) {
  if (typeof idToken !== "string" || !idToken) throw new HttpError(401, "LINEログインが必要です");
  if (!channelIds) {
    const rows = await sql`select value from challenge.config where key = 'line_channel_id'`;
    if (!rows.length) throw new HttpError(500, "line_channel_id が未設定です");
    channelIds = (rows[0].value as string).split(",").map((s) => s.trim());
  }
  // aud は LINE の verify で検証されるので、ここでは候補を選ぶためだけに読む
  let aud = "";
  try {
    aud = JSON.parse(atob(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).aud;
  } catch { /* 下の検証で弾かれる */ }
  if (!channelIds.includes(aud)) throw new HttpError(401, "このアプリ用のログインではありません");
  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    body: new URLSearchParams({ id_token: idToken, client_id: aud }),
  });
  if (!res.ok) throw new HttpError(401, "ログインの有効期限が切れました。開き直してね");
  const p = await res.json();
  return { userId: p.sub as string, name: (p.name as string) || "名無し", picture: (p.picture as string) ?? null };
}

function newCode() {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => abc[b % abc.length]).join("");
}

async function loadState(c: unknown, userId: string) {
  if (typeof c !== "string") throw new HttpError(400, "チャレンジが指定されていません");
  const [ch] = await sql`
    select id, title, to_char(start_date, 'YYYY-MM-DD') as "startDate", to_char(end_date, 'YYYY-MM-DD') as "endDate"
    from challenge.challenges where id = ${c}`;
  if (!ch) throw new HttpError(404, "チャレンジが見つかりません。リンクを確認してね");
  const members = await sql`
    select user_id as "userId", display_name as "name", picture_url as "picture", goal
    from challenge.members where challenge_id = ${c} order by joined_at`;
  const checkins = await sql`
    select user_id as "userId", to_char(day, 'YYYY-MM-DD') as day, done
    from challenge.checkins where challenge_id = ${c}`;
  return { challenge: ch, members, checkins, me: userId, today: todayJST() };
}

async function handle(body: Record<string, unknown>) {
  const user = await verifyUser(body.idToken);
  const today = todayJST();

  switch (body.action) {
    case "state":
      return loadState(body.c, user.userId);

    case "create": {
      const title = text(body.title, 40);
      const days = Number(body.days);
      if (!Number.isInteger(days) || days < 3 || days > 100) throw new HttpError(400, "期間は3〜100日にしてね");
      const start = isDay(body.startDate) ? body.startDate : today;
      if (start < addDays(today, -7) || start > addDays(today, 30)) throw new HttpError(400, "開始日は1週間前〜30日後の範囲で");
      const id = newCode();
      await sql`insert into challenge.challenges (id, title, start_date, end_date, created_by)
                values (${id}, ${title}, ${start}, ${addDays(start, days - 1)}, ${user.userId})`;
      return { id };
    }

    case "join": {
      const goal = text(body.goal, 40);
      const st = await loadState(body.c, user.userId);
      await sql`
        insert into challenge.members (challenge_id, user_id, display_name, picture_url, goal)
        values (${st.challenge.id}, ${user.userId}, ${user.name}, ${user.picture}, ${goal})
        on conflict (challenge_id, user_id) do update
          set display_name = excluded.display_name, picture_url = excluded.picture_url, goal = excluded.goal`;
      return loadState(body.c, user.userId);
    }

    case "checkin": {
      const st = await loadState(body.c, user.userId);
      if (!st.members.some((m) => m.userId === user.userId)) throw new HttpError(403, "先に参加してね");
      const day = body.day;
      if (!isDay(day) || day < st.challenge.startDate || day > st.challenge.endDate) {
        throw new HttpError(400, "チャレンジ期間外の日です");
      }
      if (day > today || day < addDays(today, -1)) throw new HttpError(400, "記録できるのは今日と昨日だけだよ");
      if (body.done === null) {
        await sql`delete from challenge.checkins where challenge_id = ${st.challenge.id} and user_id = ${user.userId} and day = ${day}`;
      } else {
        const done = body.done === true;
        await sql`
          insert into challenge.checkins (challenge_id, user_id, day, done)
          values (${st.challenge.id}, ${user.userId}, ${day}, ${done})
          on conflict (challenge_id, user_id, day) do update set done = excluded.done, updated_at = now()`;
      }
      return loadState(body.c, user.userId);
    }

    default:
      throw new HttpError(400, "unknown action");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json();
    return Response.json(await handle(body), { headers: CORS });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    const message = e instanceof HttpError ? e.message : "サーバーでエラーが起きました";
    return Response.json({ error: message }, { status, headers: CORS });
  }
});
