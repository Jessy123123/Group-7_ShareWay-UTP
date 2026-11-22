# Supabase setup (real logins and bus bookings)

The website works without this (demo mode: bookings stay in the browser).
With Supabase, students sign in with their UTP email, bus seats are saved
for real, and the operator's trip plan shows live seat counts.

| File | What it is |
|---|---|
| `schema.sql` | Tables, security rules and helper functions. Run once. |
| `trips_seed.sql` | Every bus trip in the break calendar (207 trips). Made by `python src/export_supabase_trips.py`. |
| `../web/js/supabase-config.js` | Project URL and publishable key used by the website. |
| `../web/js/db.js` | The website's database code (sign in, book, cancel, live counts). |

## One-time setup

1. Wait until the project status on the Supabase home page is **Healthy**.
2. **SQL Editor → New query**: paste all of `schema.sql`, click **Run**.
3. **New query** again: paste all of `trips_seed.sql`, click **Run** (207 rows).
4. **Authentication → Sign In / Providers → Email**: keep Email enabled.
   - For a class demo, turn **Confirm email** off. Otherwise every sign-up needs
     an email link, and Supabase's free plan only sends a few emails per hour.
5. **Authentication → URL Configuration**: set **Site URL** to the Vercel address
   and add `http://localhost:8765` to **Redirect URLs** (only used for email links).
6. **Project Settings → API Keys**: copy the **Publishable key** (`sb_publishable_…`)
   into `SUPABASE_KEY` in `web/js/supabase-config.js`.
   Never use the **secret** / `service_role` key in the website.

## Logins

The website shows a login pop-up when Supabase is connected:

- **Student view**: sign in or create an account with a `@utp.edu.my` email.
- **Operator view**: only accounts with the operator role get in. Operators can
  use **any** email (Gmail is fine), but an admin must approve it first.

## Make someone an operator

New operator (any email): approve the address in the SQL Editor, then they
choose **Operator → Create account** on the website and get the operator role:

```sql
insert into public.operator_emails (email) values ('someone@gmail.com');
```

Someone who already has an account:

```sql
update public.profiles set role = 'operator' where email = 'their@email.com';
```

## Rules the database enforces

- Students sign up with `@utp.edu.my` emails; other emails only if approved as operators.
- Students only see their own bookings; everyone can see *how many* seats are booked per trip.
- A student can hold one seat per trip and can only book trips that haven't left yet.
- Bookings are cancelled, never deleted, so the history stays for retraining.
- Students can't make themselves operators.

## Using real bookings to retrain the model

`bookings_so_far(days_before)` (operators only) gives each trip's bookings N days
before departure, the same `bookings_so_far` column the model learns from. After
a break, export it for 28, 21, 14, 10, 7, 5, 3 and 1 days plus the real final
passengers, and add those rows to the training data.

## Personal data

The database stores students' names and UTP emails, so Malaysia's PDPA applies:
tell students what is stored and why, and keep only what the booking needs.
