# Murray Bridge Games Group — PRD

## Original problem statement
Build a landing page: pwa compatible. our group is focused on a community that plays board/card games and computer games and need a community group website. user accounts to track games, gameplay time and scores with an annual subscription offer at $120 (offering a $50 discount [down from $170] from the irl meetup admission over the cost of a year's worth of irl sessions. further allowing all users to check in and pay on the website/pwa instead of paying and checking in on arrival)

subscription features: annual sub ($170 -> $120, no further discount should they fail to attend); no manual admission for entry; optional sign in via website/pwa check-in (track attendance vs cost); during free admission sessions 1 x free drink and snack; 1 x guaranteed game choice per month (token button alerts admin/host); not needed to be present when winning raffle prizes (kept 3 months).

user account features: subscriber-only, honor-based game log (game title, genre, player count, own player id, est. playtime, total score, endgame placement) with a tab per game and leaderboard tabs over last 365 days; digital check-in with $5 admission; donations 5/10/20/50/custom; lucky-number raffle entries for end-of-year free session.
Widescreen logo top of each page, round logo elsewhere, red & blue with orange highlights. Favourite games as fixed left/right borders, changing per page (random). Games: Flip 7, Love Letter, Tacta, Star Realms, Shards of Infinity, Project L, Dominion, Nexus Ops, King of Tokyo, Soloverse (own game + logo), Castles of Caleira, Ticket to Ride, Catan, Stardew Valley, Survive the Island, Jackbox, 12 Rivers, Splendor, Brawlhalla, Mario Kart.
Additional: token use includes chosen game; every user has a public collection tab split by board game, card game, digital platform.
Choices: Square (AUD), Google + email/password login (no Facebook), one admin who promotes hosts, random rails per page load.

## Architecture
- FastAPI single server.py + MongoDB (users, user_sessions, login_attempts, payments, checkins, game_logs, token_uses, raffle_entries, collections). Cookie session_token for both Google (Emergent) and email login.
- Square Checkout API payment links (LIVE production keys, AUD location); payment confirmed server-side by fetching Square order + payment (on return page and on dashboard load). Timezone Australia/Adelaide.
- React (CRA) PWA: manifest.json + service-worker.js; pages Landing, Login, Account, Game Log, Leaderboards, Members, Public Profile (/u/:id), My Collection, Host desk (/admin), Checkout complete.

## Implemented (2026-11-13)
- All above features; admin seeded (alcock.jacob@gmail.com). Tested iteration_1: backend 26/26, frontend flows pass; fixes applied after (Square email prefill removed, pending link reuse, IP+email login lockout, Adelaide dates, badge refresh, mobile ticker below logo).

## Iteration 2 (2026-11-13)
- User request: cash membership button (admin), prize pickup tracker (3 months), game log + leaderboards open to every account, 3 free raffle entries for logging every checked-in session in a 2-month block, site name colours (Murray white / Bridge logo blue #12a4f5 / Games Group white), host session summary of games & scores, monthly most-played games.
- Implemented all; tested iteration_2 (backend 36/36, UI flows pass). Follow-up fixes: bonus backfill of previous-year blocks (late awards go into current year raffle), date validation, prize collect guard, grant button double-click guard, error states.

## Iteration 3 (2026-11-13)
- Install-to-home-screen button (native prompt or instructions dialog); staff toast + badge alerts on new digital check-ins; family members under 15 (name + birth year) on accounts, checked in free with parent (counted in headcount, no login); hosts/admins free check-in; side rails removed, ticker directly under logo; perks "no manual admission"/"optional check-in" removed (everyone checks in, members free); quarterly (Mar/Jun/Sep/Dec) top total-score-since-1-Jan subscriber prize auto-recorded into prize tracker 7 days after quarter end; reminder banner for past check-ins (last 14 days) without a game log.
- Tested iteration_3: backend 49/49, frontend flows pass. Follow-ups: own check-in excluded from staff alerts, blank family names rejected, quarter winners decided after 7-day grace and never frozen empty.

## Backlog
- P1: Square webhook for payments where user never returns; admin manual "paid cash"/grant membership; prize holding tracker (3-month window)
- P2: push notifications to hosts for token alerts; shadcn date picker; raffle draw tool
