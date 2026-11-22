-- ShareWay UTP database (Supabase / Postgres)
--
-- Run this ONCE in Supabase: SQL Editor -> New query -> paste -> Run.
-- Then run trips_seed.sql (made by `python src/export_supabase_trips.py`).
--
-- What it stores:
--   profiles  one row per signed-up student (UTP email only), role student/operator
--   trips     every bus trip in the break calendar (route + departure date)
--   bookings  a student's seat on a trip (booked / cancelled)
--
-- Security (row level security): students only ever see their OWN bookings.
-- Everyone can see how many seats are booked per trip, but not who booked them.
-- Operators (role = 'operator') can see all bookings.

-- ---------- tables ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'student' check (role in ('student', 'operator')),
  created_at timestamptz not null default now()
);

create table if not exists public.trips (
  id bigint generated always as identity primary key,
  route text not null check (route in ('A', 'B', 'C')),
  departure_date date not null,
  event_name text not null,
  is_holiday boolean not null,
  unique (route, departure_date)
);

create table if not exists public.bookings (
  id bigint generated always as identity primary key,
  trip_id bigint not null references public.trips (id) on delete cascade,
  student_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  destination text not null,              -- the stop the student gets off at
  status text not null default 'booked' check (status in ('booked', 'cancelled')),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

-- one active seat per student per trip
create unique index if not exists one_active_booking
  on public.bookings (trip_id, student_id) where status = 'booked';
create index if not exists bookings_by_trip on public.bookings (trip_id);

-- ---------- helpers ----------

create or replace function public.is_operator()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'operator');
$$;

-- A new sign-up gets a profile. Students need a UTP email. Accounts created
-- from the Operator login (role = 'operator' in the sign-up data) can use any
-- email, e.g. Gmail, and become operators straight away.
-- NOTE (demo setting): anyone can create an operator account, and operators
-- can see every booking. Fine for a class demo; a real system would approve
-- operators first.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  is_operator boolean := coalesce(new.raw_user_meta_data ->> 'role', '') = 'operator';
begin
  if not is_operator and lower(new.email) not like '%@utp.edu.my' then
    raise exception 'Please sign up with your UTP email (@utp.edu.my)';
  end if;
  insert into public.profiles (id, email, full_name, role)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data ->> 'full_name', ''),
          case when is_operator then 'operator' else 'student' end);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- security rules ----------

alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.bookings enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_operator());

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- students may change their name, never their role
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

drop policy if exists "trips are public" on public.trips;
create policy "trips are public" on public.trips
  for select to anon, authenticated using (true);

drop policy if exists "read own bookings" on public.bookings;
create policy "read own bookings" on public.bookings
  for select to authenticated using (student_id = auth.uid() or public.is_operator());

drop policy if exists "book a seat for yourself" on public.bookings;
create policy "book a seat for yourself" on public.bookings
  for insert to authenticated
  with check (
    student_id = auth.uid()
    and status = 'booked'
    and exists (select 1 from public.trips t where t.id = trip_id and t.departure_date >= current_date)
  );

drop policy if exists "cancel own booking" on public.bookings;
create policy "cancel own booking" on public.bookings
  for update to authenticated using (student_id = auth.uid()) with check (student_id = auth.uid());

-- a booking can only be cancelled, nothing else about it can change
revoke update on public.bookings from authenticated;
grant update (status, cancelled_at) on public.bookings to authenticated;

-- ---------- shared numbers (no personal data) ----------

-- Seats booked right now on each trip. Anyone can call it.
create or replace function public.trip_counts()
returns table (trip_id bigint, booked bigint)
language sql stable security definer set search_path = public
as $$
  select b.trip_id, count(*) from public.bookings b where b.status = 'booked' group by b.trip_id;
$$;
grant execute on function public.trip_counts() to anon, authenticated;

-- Bookings each trip had N days before departure: the "bookings_so_far"
-- the demand model uses. Operators only. Use it to export real data for
-- retraining (see README).
create or replace function public.bookings_so_far(days_before integer)
returns table (trip_id bigint, route text, departure_date date, bookings_so_far bigint)
language sql stable security definer set search_path = public
as $$
  select t.id, t.route, t.departure_date,
         count(b.id) filter (
           where b.created_at < (t.departure_date - days_before)::timestamptz
             and (b.status = 'booked' or b.cancelled_at >= (t.departure_date - days_before)::timestamptz)
         )
  from public.trips t
  left join public.bookings b on b.trip_id = t.id
  where public.is_operator()
  group by t.id;
$$;
revoke execute on function public.bookings_so_far(integer) from public, anon;
grant execute on function public.bookings_so_far(integer) to authenticated;

-- ---------- operators ----------
-- Operators create their own account from Operator -> Create account on the
-- website (any email). To turn an existing account into an operator:
--   update public.profiles set role = 'operator' where email = 'their@email.com';
