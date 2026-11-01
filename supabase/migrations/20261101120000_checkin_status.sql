-- できた／できなかった の2択に「まあまあ（△）」を足す。done boolean を status に置き換える。
alter table challenge.checkins add column status text;
update challenge.checkins set status = case when done then 'ok' else 'ng' end;
alter table challenge.checkins
  alter column status set not null,
  add constraint checkins_status_check check (status in ('ok', 'half', 'ng')),
  drop column done;
