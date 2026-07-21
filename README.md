# mapago-backend

Cloudflare Worker backend for the daily map guessing game.

This document is written for frontend integration. It describes the auth flow, request and response shapes, and the runtime rules enforced by the API.

## Base behavior

- Base URL: your deployed Worker URL, for example `https://mapago-backend.<subdomain>.workers.dev`
- Content type: all request and response bodies are JSON
- CORS: enabled for `GET`, `POST`, `PATCH`, `OPTIONS`
- Error shape:

```json
{
  "error": "Human readable message"
}
```

## Authentication

All player endpoints require:

```http
Authorization: Bearer <token>
```

Recommended frontend flow:

1. If the client has no token, call `POST /sessions/guest`.
2. Persist the returned token locally.
3. Send that token on every authenticated request.
4. If the player wants a stable account, call `PATCH /me` with `handle`, `displayName`, and optionally `password`.
5. Returning players can call `POST /sessions/login` with `handle` and `password` to get a fresh token.

Notes:

- Guest users are real users with a generated handle like `guest_ab12cd34`.
- A password is optional until the player sets one.
- If the token is missing or invalid, the API returns `401`.

## Core domain rules

- There is only one playable game: today's game.
- A game always contains exactly 5 ordered locations.
- Guesses are immutable. A player can only submit one guess per location.
- The 5th guess auto-finalizes the play.
- Leaderboard only shows finalized plays.
- Social guesses are only visible after the viewer has submitted at least one guess for today's game.
- Location-specific social guesses are only visible after the viewer has submitted their own guess for that same location.
- Any dated game can only be reseeded before any play exists for that date.

## Common shapes

### User

```json
{
  "publicId": "usr_...",
  "handle": "guest_ab12cd34",
  "displayName": "Guest ab12cd34",
  "hasPassword": false,
  "createdAt": "2026-07-20 10:15:00"
}
```

### Game

`GET /games/today` returns the full location payload, including coordinates.

```json
{
  "game_id": 1,
  "public_id": "gam_...",
  "game_date": "2026-07-20",
  "name": "Daily Challenge",
  "locations": [
    {
      "publicId": "loc_...",
      "ordinal": 1,
      "name": "Berlin",
      "region": "Berlin",
      "isoCountryCode": "DE",
      "description": "Capital city",
      "latitude": 52.52,
      "longitude": 13.405,
      "locationLink": "https://example.com/berlin",
      "sourceLink": "https://en.wikipedia.org/wiki/Berlin",
      "pageViews": 12345
    }
  ]
}
```

### Play

```json
{
  "publicId": "ply_...",
  "totalScore": 9800,
  "finalizedAt": null,
  "createdAt": "2026-07-20 10:20:00",
  "guesses": [
    {
      "publicId": "gus_...",
      "locationPublicId": "loc_...",
      "ordinal": 1,
      "latitude": 52.5,
      "longitude": 13.4,
      "distanceMeters": 2100.42,
      "score": 4998,
      "createdAt": "2026-07-20 10:21:00"
    }
  ]
}
```

## Endpoints

### `GET /health`

Simple health check.

Response:

```json
{
  "ok": true
}
```

### `POST /sessions/guest`

Creates a guest user and session.

Request body: none

Response `201`:

```json
{
  "token": "opaque-session-token",
  "user": {
    "publicId": "usr_...",
    "handle": "guest_ab12cd34",
    "displayName": "Guest ab12cd34",
    "hasPassword": false,
    "createdAt": "2026-07-20 10:15:00"
  }
}
```

Frontend use:

- Call this once on first app load if no token exists.
- Save `token` immediately.

### `POST /sessions/login`

Creates a new session for an existing user with password auth.

Request body:

```json
{
  "handle": "florian",
  "password": "super-secret-password"
}
```

Response `201`:

```json
{
  "token": "opaque-session-token",
  "user": {
    "publicId": "usr_...",
    "handle": "florian",
    "displayName": "Florian",
    "hasPassword": true,
    "createdAt": "2026-07-20 10:15:00"
  }
}
```

Possible errors:

- `400` if password is shorter than 8 chars
- `401` if credentials are invalid

### `GET /me`

Returns the authenticated user.

Response `200`:

```json
{
  "user": {
    "publicId": "usr_...",
    "handle": "florian",
    "displayName": "Florian",
    "hasPassword": true,
    "createdAt": "2026-07-20 10:15:00"
  }
}
```

### `PATCH /me`

Updates the current user. All fields are optional, but at least one should be sent.

Request body:

```json
{
  "handle": "florian",
  "displayName": "Florian",
  "password": "super-secret-password"
}
```

Rules:

- `handle` must match `^[a-z0-9_]{3,24}$`
- `displayName` must be 1 to 50 chars
- `password` must be at least 8 chars

Response `200`:

```json
{
  "user": {
    "publicId": "usr_...",
    "handle": "florian",
    "displayName": "Florian",
    "hasPassword": true,
    "createdAt": "2026-07-20 10:15:00"
  }
}
```

Possible errors:

- `400` for invalid handle, display name, or password
- `409` if the handle is already taken

### `GET /games/today`

Returns today's game and the authenticated user.

Response `200`:

```json
{
  "game": {
    "game_id": 1,
    "public_id": "gam_...",
    "game_date": "2026-07-20",
    "name": "Daily Challenge",
    "locations": [
      {
        "publicId": "loc_...",
        "ordinal": 1,
        "name": "Berlin",
        "region": "Berlin",
        "isoCountryCode": "DE",
        "description": "Capital city",
        "latitude": 52.52,
        "longitude": 13.405,
        "locationLink": "https://example.com/berlin",
        "sourceLink": "https://en.wikipedia.org/wiki/Berlin",
        "pageViews": 12345
      }
    ]
  },
  "user": {
    "publicId": "usr_...",
    "handle": "florian",
    "displayName": "Florian",
    "hasPassword": true,
    "createdAt": "2026-07-20 10:15:00"
  }
}
```

Possible errors:

- `200` with `game: null` if today's game has not been seeded yet

### `GET /games/today/play`

Returns the current user's play for today's game. If the user has no play yet, one is created automatically.

Response `200`:

```json
{
  "play": {
    "publicId": "ply_...",
    "totalScore": 0,
    "finalizedAt": null,
    "createdAt": "2026-07-20 10:20:00",
    "guesses": []
  }
}
```

Possible errors:

- `404` if no game exists for today

Frontend use:

- Use this endpoint to restore guess progress on app reload.
- The `guesses` array is the source of truth for which ordinals are already locked.

### `POST /games/today/guesses/:ordinal`

Submits a guess for one location.

Request body:

```json
{
  "latitude": 52.5,
  "longitude": 13.4
}
```

Rules:

- `ordinal` must be `1` to `5`
- latitude must be between `-90` and `90`
- longitude must be between `-180` and `180`
- a location can only be guessed once
- once the play is finalized, no more guesses can be submitted

Response `200` for guesses 1 to 4, `201` on guess 5:

```json
{
  "finalized": false,
  "play": {
    "publicId": "ply_...",
    "totalScore": 4998,
    "finalizedAt": null,
    "createdAt": "2026-07-20 10:20:00",
    "guesses": [
      {
        "publicId": "gus_...",
        "locationPublicId": "loc_...",
        "ordinal": 1,
        "latitude": 52.5,
        "longitude": 13.4,
        "distanceMeters": 2100.42,
        "score": 4998,
        "createdAt": "2026-07-20 10:21:00"
      }
    ]
  }
}
```

Possible errors:

- `400` invalid ordinal or coordinates
- `404` no game for today or location missing
- `409` guess already submitted for that location
- `409` play already finalized

### `POST /follows/:userPublicId`

Creates a follow relationship.

Request body: none

Response `201`:

```json
{
  "follow": {
    "publicId": "fol_...",
    "followedUserId": "usr_..."
  }
}
```

Notes:

- If the follow already exists, the endpoint still returns a follow object.
- The endpoint currently still responds with `201` even when the relationship already existed.

Possible errors:

- `400` if the user tries to follow themself
- `404` if the target user does not exist

### `GET /follows`

Returns the users followed by the current user.

Response `200`:

```json
{
  "users": [
    {
      "publicId": "usr_...",
      "handle": "friend_one",
      "displayName": "Friend One",
      "followedAt": "2026-07-20 11:00:00"
    }
  ]
}
```

### `GET /leaderboard`

Returns today's finalized plays only.

Response `200`:

```json
{
  "game": {
    "publicId": "gam_...",
    "gameDate": "2026-07-20",
    "name": "Daily Challenge"
  },
  "leaderboard": [
    {
      "rank": 1,
      "playPublicId": "ply_...",
      "totalScore": 24000,
      "finalizedAt": "2026-07-20 10:30:00",
      "user": {
        "publicId": "usr_...",
        "handle": "florian",
        "displayName": "Florian"
      }
    }
  ],
  "user": {
    "publicId": "usr_...",
    "handle": "florian",
    "displayName": "Florian",
    "hasPassword": true,
    "createdAt": "2026-07-20 10:15:00"
  }
}
```

### `GET /games/today/social`

Returns plays and guesses for followed users for today's game.

Precondition:

- the viewer must already have at least one guess in today's game

Response `200`:

```json
{
  "game": {
    "publicId": "gam_...",
    "gameDate": "2026-07-20",
    "name": "Daily Challenge"
  },
  "plays": [
    {
      "playPublicId": "ply_...",
      "totalScore": 24000,
      "finalizedAt": "2026-07-20 10:30:00",
      "user": {
        "publicId": "usr_...",
        "handle": "friend_one",
        "displayName": "Friend One"
      },
      "guesses": [
        {
          "locationPublicId": "loc_...",
          "ordinal": 1,
          "guessPublicId": "gus_...",
          "latitude": 52.5,
          "longitude": 13.4,
          "distanceMeters": 2100.42,
          "score": 4998
        }
      ]
    }
  ]
}
```

Possible errors:

- `403` if the viewer has not made any guess yet
- `404` if no game exists for today

### `GET /games/today/social/:ordinal`

Returns followed users' guesses for one specific location in today's game.

Precondition:

- the viewer must already have guessed that same location ordinal

Path params:

- `ordinal`: integer from `1` to `5`

Response `200`:

```json
{
  "game": {
    "publicId": "gam_...",
    "gameDate": "2026-07-20",
    "name": "Daily Challenge"
  },
  "location": {
    "publicId": "loc_...",
    "ordinal": 3,
    "name": "Berlin"
  },
  "guesses": [
    {
      "playPublicId": "ply_...",
      "totalScore": 24000,
      "finalizedAt": "2026-07-20 10:30:00",
      "user": {
        "publicId": "usr_...",
        "handle": "friend_one",
        "displayName": "Friend One"
      },
      "guess": {
        "publicId": "gus_...",
        "latitude": 52.5,
        "longitude": 13.4,
        "distanceMeters": 2100.42,
        "score": 4998
      }
    }
  ]
}
```

Possible errors:

- `400` if `ordinal` is outside `1..5`
- `403` if the viewer has not guessed this location yet
- `404` if no game exists for today or the location does not exist

## Admin endpoint

### `POST /admin/games/:date/seed`

Creates or replaces the game for a specific date.

This is the endpoint to use for scheduling future games. You can seed multiple upcoming dates ahead of time by calling this endpoint once per date.

Authentication:

```http
x-admin-token: <ADMIN_SEED_TOKEN>
```

Setup:

```bash
npx wrangler secret put ADMIN_SEED_TOKEN
```

Rules:

- exactly 5 locations are required
- locations are stored in the order they are sent
- URLs must be `http` or `https`
- `isoCountryCode` must be a 2-letter uppercase code
- `:date` must use `YYYY-MM-DD`
- reseeding is blocked once any play exists for that game date

Practical usage:

- seed today with `POST /admin/games/2026-07-20/seed`
- seed tomorrow with `POST /admin/games/2026-07-21/seed`
- seed an entire upcoming week by calling the endpoint once per date

Example path:

```http
POST /admin/games/2026-07-25/seed
```

Request body:

```json
{
  "name": "Daily Challenge",
  "locations": [
    {
      "name": "Berlin",
      "region": "Deutschland",
      "isoCountryCode": "DE",
      "description": "On July 18th,....",
      "latitude": 52.52,
      "longitude": 13.405,
      "sourceLink": "https://en.wikipedia.org/wiki/Berlin_Event_Page",
      "locationLink": "https://en.wikipedia.org/wiki/Berlin",
      "pageViews": 12345
    },
    {
      "name": "Second location",
      "latitude": 0,
      "longitude": 0
    },
    {
      "name": "Third location",
      "latitude": 0,
      "longitude": 0
    },
    {
      "name": "Fourth location",
      "latitude": 0,
      "longitude": 0
    },
    {
      "name": "Fifth location",
      "latitude": 0,
      "longitude": 0
    }
  ]
}
```

Response `201` when the dated game is created, `200` when an empty game for that date is replaced:

```json
{
  "created": true,
  "game": {
    "publicId": "gam_...",
    "gameDate": "2026-07-25",
    "name": "Daily Challenge",
    "locations": [
      {
        "publicId": "loc_...",
        "ordinal": 1,
        "name": "Berlin",
        "region": "Berlin",
        "isoCountryCode": "DE",
        "description": "Capital city",
        "latitude": 52.52,
        "longitude": 13.405,
        "locationLink": "https://example.com/berlin",
        "sourceLink": "https://en.wikipedia.org/wiki/Berlin",
        "pageViews": 12345
      }
    ]
  }
}
```

Possible errors:

- `400` invalid payload
- `400` invalid date format or invalid calendar date
- `401` missing or invalid admin token
- `409` if that game date already has plays
- `500` if `ADMIN_SEED_TOKEN` is not configured

## Suggested frontend integration order

1. On app boot, ensure a token exists with `POST /sessions/guest` if needed.
2. Load `GET /me` if you need current account state immediately.
3. Load `GET /games/today` for the daily content.
4. Load `GET /games/today/play` to restore the current player's progress.
5. Submit guesses through `POST /games/today/guesses/:ordinal`.
6. Load `GET /games/today/social/:ordinal` when the UI needs friends' guesses for a specific location.
7. Refresh `GET /leaderboard` after the 5th guess or on leaderboard screens.
8. Load `GET /games/today/social` only after the player has guessed at least once.

## Local development

1. Install dependencies:

```bash
npm install
```

2. Apply local migrations:

```bash
npm run db:migrate:local
```

3. Start the Worker locally:

```bash
npm run dev
```

## Deployment notes

1. Create or bind the D1 database in `wrangler.jsonc`.
2. Apply remote migrations:

```bash
npm run db:migrate:remote
```

3. Deploy:

```bash
npm run deploy
```
