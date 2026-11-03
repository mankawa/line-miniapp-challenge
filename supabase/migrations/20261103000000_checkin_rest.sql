-- 「もともと飲む予定だった日（予定どおりのお休み）」を足す。達成にも挫折にも数えない。
alter table challenge.checkins
  drop constraint checkins_status_check,
  add constraint checkins_status_check check (status in ('ok', 'half', 'ng', 'rest'));
