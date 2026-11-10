-- Partial bulk updates used by the simulator so a tick never overwrites
-- concurrent user changes (scenario selection, acknowledgements, bed binding).

create or replace function public.apply_monitor_telemetry(items jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.monitors m
     set battery_level = (i ->> 'battery_level')::real,
         connection    = i ->> 'connection',
         sensor_status = i ->> 'sensor_status',
         last_seen_at  = coalesce((i ->> 'last_seen_at')::timestamptz, m.last_seen_at),
         updated_at    = now()
    from jsonb_array_elements(items) as i
   where m.id = (i ->> 'id')::uuid;
$$;

-- Only touches condition-tracking columns; acknowledgement columns are never written here.
create or replace function public.apply_alarm_updates(items jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.alarms a
     set state        = i ->> 'state',
         cleared_at   = (i ->> 'cleared_at')::timestamptz,
         last_seen_at = (i ->> 'last_seen_at')::timestamptz,
         value        = (i ->> 'value')::real,
         message      = i ->> 'message',
         priority     = i ->> 'priority'
    from jsonb_array_elements(items) as i
   where a.id = (i ->> 'id')::uuid
     and a.state = 'active';
$$;

revoke all on function public.apply_monitor_telemetry(jsonb) from public, anon, authenticated;
revoke all on function public.apply_alarm_updates(jsonb) from public, anon, authenticated;
grant execute on function public.apply_monitor_telemetry(jsonb) to service_role;
grant execute on function public.apply_alarm_updates(jsonb) to service_role;
