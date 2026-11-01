-- 仲間内チャレンジ用ミニアプリ。既存プロジェクトに相乗りするので専用スキーマに隔離する。
-- このスキーマは PostgREST に公開せず、Edge Function (challenge-api) から DB 直結でのみ触る。
create schema if not exists challenge;
revoke all on schema challenge from public, anon, authenticated;

create table challenge.config (
  key   text primary key,
  value text not null
);

create table challenge.challenges (
  id         text primary key,                 -- 招待リンクに載る短いコード
  title      text not null check (char_length(title) between 1 and 40),
  start_date date not null,
  end_date   date not null check (end_date >= start_date),
  created_by text not null,                    -- LINE userId
  created_at timestamptz not null default now()
);

create table challenge.members (
  challenge_id text not null references challenge.challenges(id) on delete cascade,
  user_id      text not null,
  display_name text not null,
  picture_url  text,
  goal         text not null check (char_length(goal) between 1 and 40),
  joined_at    timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

create table challenge.checkins (
  challenge_id text not null,
  user_id      text not null,
  day          date not null,
  done         boolean not null,
  updated_at   timestamptz not null default now(),
  primary key (challenge_id, user_id, day),
  foreign key (challenge_id, user_id) references challenge.members(challenge_id, user_id) on delete cascade
);

alter table challenge.config     enable row level security;
alter table challenge.challenges enable row level security;
alter table challenge.members    enable row level security;
alter table challenge.checkins   enable row level security;
