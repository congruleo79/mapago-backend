type AppEnv = Env

type UserRow = {
  id: number
  public_id: string
  handle: string
  display_name: string
  password_hash: string | null
  created_at: string
}

type SessionRow = {
  id: number
  public_id: string
  user_id: number
  token_hash: string
  expires_at: string
  revoked_at: string | null
  created_at: string
}

type GameWithLocationRow = {
  game_id: number
  game_public_id: string
  game_date: string
  game_name: string | null
  location_id: number
  location_public_id: string
  ordinal: number
  name: string
  region: string | null
  iso_country_code: string | null
  description: string | null
  latitude: number
  longitude: number
  location_link: string | null
  source_link: string | null
  page_views: number | null
}

type PlayGuessRow = {
  play_id: number
  play_public_id: string
  total_score: number
  play_created_at: string
  finalized_at: string | null
  guess_id: number | null
  guess_public_id: string | null
  location_id: number | null
  location_public_id: string | null
  ordinal: number | null
  guess_latitude: number | null
  guess_longitude: number | null
  distance_meters: number | null
  score: number | null
  guess_created_at: string | null
}

type LeaderboardRow = {
  play_public_id: string
  total_score: number
  finalized_at: string
  user_public_id: string
  handle: string
  display_name: string
}

type SocialGuessRow = LeaderboardRow & {
  location_public_id: string
  ordinal: number
  guess_public_id: string
  guess_latitude: number
  guess_longitude: number
  distance_meters: number
  score: number
}

type SessionWithUserRow = SessionRow & {
  handle: string
  display_name: string
  password_hash: string | null
  user_public_id: string
  user_created_at: string
}

type ErrorBody = {
  error: string
}

type SeedLocationInput = {
  name: string
  region?: string
  isoCountryCode?: string
  description?: string
  latitude: number
  longitude: number
  locationLink?: string
  sourceLink?: string
  pageViews?: number
}

type SeedTodayGameInput = {
  name?: string
  locations: SeedLocationInput[]
}

const SESSION_HEADER = "authorization"
const SESSION_PREFIX = "Bearer "
const ADMIN_TOKEN_HEADER = "x-admin-token"
const SESSION_DURATION_DAYS = 365
const MAX_LOCATION_SCORE = 5000
const PASSWORD_ITERATIONS = 600000

export default {
  async fetch(request: Request, env: AppEnv): Promise<Response> {
    try {
      const url = new URL(request.url)
      const pathname = trimTrailingSlash(url.pathname)

      if (request.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }))
      }

      if (request.method === "GET" && pathname === "/health") {
        return json({ ok: true })
      }

      if (request.method === "POST" && pathname.match(/^\/admin\/games\/\d{4}-\d{2}-\d{2}\/seed$/)) {
        await requireAdminSeedToken(request, env)
        const gameDate = pathname.split("/")[3] as string
        const body = await readJson<SeedTodayGameInput>(request)
        const result = await seedGameForDate(env, gameDate, body)
        return withCors(json(result, result.created ? 201 : 200))
      }

      if (request.method === "POST" && pathname === "/sessions/guest") {
        return withCors(await createGuestSession(env))
      }

      if (request.method === "POST" && pathname === "/sessions/login") {
        const session = await createPasswordSession(request, env)
        return withCors(json(session, 201))
      }

      if (request.method === "GET" && pathname === "/me") {
        const session = await requireSession(request, env)
        return withCors(json({ user: serializeUser(session.user) }))
      }

      if (request.method === "PATCH" && pathname === "/me") {
        const session = await requireSession(request, env)
        const body = await readJson<{ handle?: string; displayName?: string; password?: string }>(request)
        const user = await updateCurrentUser(env, session.user, body)
        return withCors(json({ user: serializeUser(user) }))
      }

      if (request.method === "GET" && pathname === "/games/today") {
        const session = await requireSession(request, env)
        const game = await getCurrentGame(env)
        return withCors(json({ game, user: serializeUser(session.user) }))
      }

      if (request.method === "GET" && pathname === "/games/today/play") {
        const session = await requireSession(request, env)
        const game = await requireCurrentGame(env)
        const play = await getOrCreatePlay(env, game.game_id, session.user.id)
        const guesses = await getPlayWithGuesses(env, play.id)
        return withCors(json({ play: serializePlay(guesses) }))
      }

      if (request.method === "POST" && pathname.match(/^\/games\/today\/guesses\/\d+$/)) {
        const session = await requireSession(request, env)
        const ordinal = Number(pathname.split("/").at(-1))
        const body = await readJson<{ latitude: number; longitude: number }>(request)
        validateCoordinatePayload(body)
        const result = await createGuess(env, session.user.id, ordinal, body.latitude, body.longitude)
        return withCors(json(result, result.finalized ? 201 : 200))
      }

      if (request.method === "POST" && pathname.match(/^\/follows\/[a-z0-9_]+$/)) {
        const session = await requireSession(request, env)
        const followedUserPublicId = pathname.split("/").at(-1) as string
        const follow = await createFollow(env, session.user.id, followedUserPublicId)
        return withCors(json({ follow }, 201))
      }

      if (request.method === "GET" && pathname === "/follows") {
        const session = await requireSession(request, env)
        const follows = await listFollows(env, session.user.id)
        return withCors(json({ users: follows }))
      }

      if (request.method === "GET" && pathname === "/leaderboard") {
        const session = await requireSession(request, env)
        const game = await requireCurrentGame(env)
        const leaderboard = await getLeaderboard(env, game.game_id)
        return withCors(json({ game: summarizeGame(game), leaderboard, user: serializeUser(session.user) }))
      }

      if (request.method === "GET" && pathname === "/games/today/social") {
        const session = await requireSession(request, env)
        const game = await requireCurrentGame(env)
        const social = await getSocialGuesses(env, game.game_id, session.user.id)
        return withCors(json({ game: summarizeGame(game), plays: social }))
      }

      return withCors(jsonError("Not found", 404))
    } catch (error) {
      return withCors(handleError(error))
    }
  },
}

async function createGuestSession(env: AppEnv): Promise<Response> {
  const token = createOpaqueToken()
  const tokenHash = await sha256Hex(token)
  const userPublicId = createPublicId("usr")
  const sessionPublicId = createPublicId("ses")
  const handleSuffix = crypto.randomUUID().slice(0, 8)
  const handle = `guest_${handleSuffix}`
  const displayName = `Guest ${handleSuffix}`
  const expiresAt = addDays(new Date(), SESSION_DURATION_DAYS).toISOString()

  const userInsert = env.DB.prepare(`INSERT INTO users (public_id, handle, display_name) VALUES (?, ?, ?)`).bind(userPublicId, handle, displayName)

  await userInsert.run()
  const user = requireFound(await first<UserRow>(env.DB.prepare(`SELECT * FROM users WHERE public_id = ?`).bind(userPublicId)), 500, "Failed to load newly created user")

  await env.DB.prepare(`INSERT INTO user_sessions (public_id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`).bind(sessionPublicId, user.id, tokenHash, expiresAt).run()

  return json({ token, user: serializeUser(user) }, 201)
}

async function createPasswordSession(request: Request, env: AppEnv) {
  const body = await readJson<{ handle: string; password: string }>(request)
  const handle = normalizeHandle(body.handle)
  if (!body.password || body.password.length < 8) {
    throw httpError(400, "Password must be at least 8 characters long")
  }

  const user = await first<UserRow>(env.DB.prepare(`SELECT * FROM users WHERE handle = ?`).bind(handle))

  if (!user || !user.password_hash) {
    throw httpError(401, "Invalid credentials")
  }

  const matches = await verifyPassword(body.password, user.password_hash)
  if (!matches) {
    throw httpError(401, "Invalid credentials")
  }

  const token = createOpaqueToken()
  const tokenHash = await sha256Hex(token)
  const sessionPublicId = createPublicId("ses")
  const expiresAt = addDays(new Date(), SESSION_DURATION_DAYS).toISOString()

  await env.DB.prepare(`INSERT INTO user_sessions (public_id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`).bind(sessionPublicId, user.id, tokenHash, expiresAt).run()

  return {
    token,
    user: serializeUser(user),
  }
}

async function updateCurrentUser(env: AppEnv, user: UserRow, body: { handle?: string; displayName?: string; password?: string }) {
  const updates: string[] = []
  const values: Array<string | null> = []

  if (body.handle !== undefined) {
    const handle = normalizeHandle(body.handle)
    updates.push(`handle = ?`)
    values.push(handle)
  }

  if (body.displayName !== undefined) {
    const displayName = body.displayName.trim()
    if (displayName.length < 1 || displayName.length > 50) {
      throw httpError(400, "Display name must be between 1 and 50 characters")
    }
    updates.push(`display_name = ?`)
    values.push(displayName)
  }

  if (body.password !== undefined) {
    if (body.password.length < 8) {
      throw httpError(400, "Password must be at least 8 characters long")
    }
    const passwordHash = await hashPassword(body.password)
    updates.push(`password_hash = ?`)
    values.push(passwordHash)
  }

  if (updates.length === 0) {
    return user
  }

  try {
    await env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`)
      .bind(...values, user.id)
      .run()
  } catch (error) {
    if (isSqliteConstraintError(error)) {
      throw httpError(409, "User handle is already taken")
    }
    throw error
  }

  return requireFound(await first<UserRow>(env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(user.id)), 500, "Failed to load updated user")
}

async function requireSession(request: Request, env: AppEnv): Promise<{ user: UserRow; session: SessionRow }> {
  const header = request.headers.get(SESSION_HEADER)
  if (!header || !header.startsWith(SESSION_PREFIX)) {
    throw httpError(401, "Missing bearer token")
  }

  const token = header.slice(SESSION_PREFIX.length).trim()
  if (!token) {
    throw httpError(401, "Missing bearer token")
  }

  const tokenHash = await sha256Hex(token)
  const row = await first<SessionWithUserRow>(
    env.DB.prepare(
      `SELECT
        s.id,
        s.public_id,
        s.user_id,
        s.token_hash,
        s.expires_at,
        s.revoked_at,
        s.created_at,
        u.handle,
        u.display_name,
        u.password_hash,
        u.public_id AS user_public_id,
        u.created_at AS user_created_at
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
        AND s.revoked_at IS NULL
        AND s.expires_at > CURRENT_TIMESTAMP`,
    ).bind(tokenHash),
  )

  if (!row) {
    throw httpError(401, "Invalid session")
  }

  return {
    user: {
      id: row.user_id,
      public_id: row.user_public_id,
      handle: row.handle,
      display_name: row.display_name,
      password_hash: row.password_hash,
      created_at: row.user_created_at,
    },
    session: {
      id: row.id,
      public_id: row.public_id,
      user_id: row.user_id,
      token_hash: row.token_hash,
      expires_at: row.expires_at,
      revoked_at: row.revoked_at,
      created_at: row.created_at,
    },
  }
}

async function requireAdminSeedToken(request: Request, env: AppEnv) {
  const configuredToken = getAdminSeedToken(env)
  if (!configuredToken) {
    throw httpError(500, "ADMIN_SEED_TOKEN is not configured")
  }

  const providedToken = request.headers.get(ADMIN_TOKEN_HEADER)
  if (!providedToken) {
    throw httpError(401, "Missing admin token")
  }

  if (!timingSafeEqualText(providedToken, configuredToken)) {
    throw httpError(401, "Invalid admin token")
  }
}

async function seedGameForDate(env: AppEnv, gameDate: string, body: SeedTodayGameInput) {
  const normalized = normalizeSeedTodayGameInput(body)
  const normalizedGameDate = normalizeGameDate(gameDate)

  let created = false
  let game = await first<{ id: number; public_id: string }>(env.DB.prepare(`SELECT id, public_id FROM games WHERE game_date = ?`).bind(normalizedGameDate))

  if (game) {
    const existingPlay = await first<{ id: number }>(env.DB.prepare(`SELECT id FROM plays WHERE game_id = ? LIMIT 1`).bind(game.id))
    if (existingPlay) {
      throw httpError(409, `Cannot reseed game ${normalizedGameDate} after players have started`)
    }
  } else {
    created = true
    await env.DB.prepare(`INSERT INTO games (public_id, game_date, name) VALUES (?, ?, ?)`).bind(createPublicId("gam"), normalizedGameDate, normalized.name).run()
    game = requireFound(
      await first<{ id: number; public_id: string }>(env.DB.prepare(`SELECT id, public_id FROM games WHERE game_date = ?`).bind(normalizedGameDate)),
      500,
      `Failed to create game ${normalizedGameDate}`,
    )
  }

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`UPDATE games SET name = ? WHERE id = ?`).bind(normalized.name, game.id),
    env.DB.prepare(`DELETE FROM locations WHERE game_id = ?`).bind(game.id),
  ]

  for (const location of normalized.locations) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO locations (
          public_id,
          game_id,
          ordinal,
          name,
          region,
          iso_country_code,
          description,
          latitude,
          longitude,
          location_link,
          source_link,
          page_views
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        createPublicId("loc"),
        game.id,
        location.ordinal,
        location.name,
        location.region,
        location.isoCountryCode,
        location.description,
        location.latitude,
        location.longitude,
        location.locationLink,
        location.sourceLink,
        location.pageViews,
      ),
    )
  }

  await env.DB.batch(statements)

  const seededGame = requireFound(await getGameByDate(env, normalizedGameDate), 500, `Failed to load game ${normalizedGameDate}`)
  return {
    created,
    game: {
      publicId: seededGame.public_id,
      gameDate: seededGame.game_date,
      name: seededGame.name,
      locations: seededGame.locations,
    },
  }
}

async function getGameByDate(env: AppEnv, gameDate: string) {
  const rows = await all<GameWithLocationRow>(
    env.DB.prepare(
      `SELECT
        g.id AS game_id,
        g.public_id AS game_public_id,
        g.game_date,
        g.name AS game_name,
        l.id AS location_id,
        l.public_id AS location_public_id,
        l.ordinal,
        l.name,
        l.region,
        l.iso_country_code,
        l.description,
        l.latitude,
        l.longitude,
        l.location_link,
        l.source_link,
        l.page_views
      FROM games g
      JOIN locations l ON l.game_id = g.id
      WHERE g.game_date = ?
      ORDER BY l.ordinal ASC`,
    ).bind(gameDate),
  )

  if (rows.length === 0) {
    return null
  }

  return {
    game_id: rows[0].game_id,
    public_id: rows[0].game_public_id,
    game_date: rows[0].game_date,
    name: rows[0].game_name,
    locations: rows.map((row) => ({
      publicId: row.location_public_id,
      ordinal: row.ordinal,
      name: row.name,
      region: row.region,
      isoCountryCode: row.iso_country_code,
      description: row.description,
      latitude: row.latitude,
      longitude: row.longitude,
      locationLink: row.location_link,
      sourceLink: row.source_link,
      pageViews: row.page_views,
    })),
  }
}

async function getCurrentGame(env: AppEnv) {
  return getGameByDate(env, currentUtcDate())
}

async function requireCurrentGame(env: AppEnv) {
  const game = await getCurrentGame(env)
  if (!game) {
    throw httpError(404, "No game found for today")
  }
  return game
}

async function getOrCreatePlay(env: AppEnv, gameId: number, userId: number) {
  let play = await first<{ id: number; public_id: string }>(env.DB.prepare(`SELECT id, public_id FROM plays WHERE game_id = ? AND user_id = ?`).bind(gameId, userId))

  if (play) {
    return play
  }

  const publicId = createPublicId("ply")
  await env.DB.prepare(`INSERT INTO plays (public_id, game_id, user_id) VALUES (?, ?, ?)`).bind(publicId, gameId, userId).run()

  play = await first<{ id: number; public_id: string }>(env.DB.prepare(`SELECT id, public_id FROM plays WHERE game_id = ? AND user_id = ?`).bind(gameId, userId))

  return requireFound(play, 500, "Failed to load play")
}

async function getPlayWithGuesses(env: AppEnv, playId: number) {
  const rows = await all<PlayGuessRow>(
    env.DB.prepare(
      `SELECT
        p.id AS play_id,
        p.public_id AS play_public_id,
        p.total_score,
        p.created_at AS play_created_at,
        p.finalized_at,
        g.id AS guess_id,
        g.public_id AS guess_public_id,
        l.id AS location_id,
        l.public_id AS location_public_id,
        l.ordinal,
        g.guess_latitude,
        g.guess_longitude,
        g.distance_meters,
        g.score,
        g.created_at AS guess_created_at
      FROM plays p
      LEFT JOIN guesses g ON g.play_id = p.id
      LEFT JOIN locations l ON l.id = g.location_id
      WHERE p.id = ?
      ORDER BY l.ordinal ASC`,
    ).bind(playId),
  )

  if (rows.length === 0) {
    throw httpError(404, "Play not found")
  }

  return rows
}

async function createGuess(env: AppEnv, userId: number, ordinal: number, latitude: number, longitude: number) {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 5) {
    throw httpError(400, "Location ordinal must be between 1 and 5")
  }

  const game = await requireCurrentGame(env)
  const play = await getOrCreatePlay(env, game.game_id, userId)
  const existingPlay = await first<{ finalized_at: string | null }>(env.DB.prepare(`SELECT finalized_at FROM plays WHERE id = ?`).bind(play.id))

  if (existingPlay?.finalized_at) {
    throw httpError(409, "Play already finalized")
  }

  const location = await first<{ id: number; public_id: string; latitude: number; longitude: number }>(
    env.DB.prepare(`SELECT id, public_id, latitude, longitude FROM locations WHERE game_id = ? AND ordinal = ?`).bind(game.game_id, ordinal),
  )

  if (!location) {
    throw httpError(404, "Location not found")
  }

  const existingGuess = await first<{ id: number }>(env.DB.prepare(`SELECT id FROM guesses WHERE play_id = ? AND location_id = ?`).bind(play.id, location.id))

  if (existingGuess) {
    throw httpError(409, "Guess already submitted for this location")
  }

  const distanceMeters = haversineMeters(latitude, longitude, location.latitude, location.longitude)
  const score = distanceToScore(distanceMeters)
  const guessPublicId = createPublicId("gus")

  await env.DB.prepare(
    `INSERT INTO guesses (public_id, play_id, location_id, guess_latitude, guess_longitude, distance_meters, score)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(guessPublicId, play.id, location.id, latitude, longitude, distanceMeters, score)
    .run()

  const aggregate = requireFound(
    await first<{ guess_count: number; total_score: number }>(env.DB.prepare(`SELECT COUNT(*) AS guess_count, COALESCE(SUM(score), 0) AS total_score FROM guesses WHERE play_id = ?`).bind(play.id)),
    500,
    "Failed to aggregate play score",
  )

  let finalized = false
  if (aggregate.guess_count === 5) {
    finalized = true
    await env.DB.prepare(`UPDATE plays SET total_score = ?, finalized_at = CURRENT_TIMESTAMP WHERE id = ? AND finalized_at IS NULL`).bind(aggregate.total_score, play.id).run()
  } else {
    await env.DB.prepare(`UPDATE plays SET total_score = ? WHERE id = ?`).bind(aggregate.total_score, play.id).run()
  }

  const guesses = await getPlayWithGuesses(env, play.id)
  return {
    finalized,
    play: serializePlay(guesses),
  }
}

async function createFollow(env: AppEnv, followerUserId: number, followedUserPublicId: string) {
  const followed = await first<UserRow>(env.DB.prepare(`SELECT * FROM users WHERE public_id = ?`).bind(followedUserPublicId))

  if (!followed) {
    throw httpError(404, "User not found")
  }

  if (followed.id === followerUserId) {
    throw httpError(400, "Cannot follow yourself")
  }

  const existing = await first<{ public_id: string }>(env.DB.prepare(`SELECT public_id FROM follows WHERE follower_user_id = ? AND followed_user_id = ?`).bind(followerUserId, followed.id))

  if (existing) {
    return { publicId: existing.public_id, followedUserId: followed.public_id }
  }

  const publicId = createPublicId("fol")
  await env.DB.prepare(`INSERT INTO follows (public_id, follower_user_id, followed_user_id) VALUES (?, ?, ?)`).bind(publicId, followerUserId, followed.id).run()

  return { publicId, followedUserId: followed.public_id }
}

async function listFollows(env: AppEnv, followerUserId: number) {
  const rows = await all<{ public_id: string; handle: string; display_name: string; created_at: string }>(
    env.DB.prepare(
      `SELECT u.public_id, u.handle, u.display_name, f.created_at
       FROM follows f
       JOIN users u ON u.id = f.followed_user_id
       WHERE f.follower_user_id = ?
       ORDER BY u.handle ASC`,
    ).bind(followerUserId),
  )

  return rows.map((row) => ({
    publicId: row.public_id,
    handle: row.handle,
    displayName: row.display_name,
    followedAt: row.created_at,
  }))
}

async function getLeaderboard(env: AppEnv, gameId: number) {
  const rows = await all<LeaderboardRow>(
    env.DB.prepare(
      `SELECT
        p.public_id AS play_public_id,
        p.total_score,
        p.finalized_at,
        u.public_id AS user_public_id,
        u.handle,
        u.display_name
       FROM plays p
       JOIN users u ON u.id = p.user_id
       WHERE p.game_id = ? AND p.finalized_at IS NOT NULL
       ORDER BY p.total_score DESC, p.finalized_at ASC, u.handle ASC`,
    ).bind(gameId),
  )

  return rows.map((row, index) => ({
    rank: index + 1,
    playPublicId: row.play_public_id,
    totalScore: row.total_score,
    finalizedAt: row.finalized_at,
    user: {
      publicId: row.user_public_id,
      handle: row.handle,
      displayName: row.display_name,
    },
  }))
}

async function getSocialGuesses(env: AppEnv, gameId: number, userId: number) {
  const viewerGuess = await first<{ id: number }>(
    env.DB.prepare(
      `SELECT g.id
       FROM plays p
       JOIN guesses g ON g.play_id = p.id
       WHERE p.game_id = ? AND p.user_id = ?
       LIMIT 1`,
    ).bind(gameId, userId),
  )

  if (!viewerGuess) {
    throw httpError(403, "Submit at least one guess before viewing social guesses")
  }

  const rows = await all<SocialGuessRow>(
    env.DB.prepare(
      `SELECT
        p.public_id AS play_public_id,
        p.total_score,
        p.finalized_at,
        u.public_id AS user_public_id,
        u.handle,
        u.display_name,
        l.public_id AS location_public_id,
        l.ordinal,
        g.public_id AS guess_public_id,
        g.guess_latitude,
        g.guess_longitude,
        g.distance_meters,
        g.score
       FROM follows f
       JOIN plays p ON p.user_id = f.followed_user_id AND p.game_id = ?
       JOIN users u ON u.id = p.user_id
       JOIN guesses g ON g.play_id = p.id
       JOIN locations l ON l.id = g.location_id
       WHERE f.follower_user_id = ?
       ORDER BY u.handle ASC, l.ordinal ASC`,
    ).bind(gameId, userId),
  )

  const grouped = new Map<
    string,
    {
      playPublicId: string
      totalScore: number
      finalizedAt: string
      user: { publicId: string; handle: string; displayName: string }
      guesses: Array<{
        locationPublicId: string
        ordinal: number
        guessPublicId: string
        latitude: number
        longitude: number
        distanceMeters: number
        score: number
      }>
    }
  >()

  for (const row of rows) {
    const existing = grouped.get(row.play_public_id)
    if (existing) {
      existing.guesses.push({
        locationPublicId: row.location_public_id,
        ordinal: row.ordinal,
        guessPublicId: row.guess_public_id,
        latitude: row.guess_latitude,
        longitude: row.guess_longitude,
        distanceMeters: row.distance_meters,
        score: row.score,
      })
      continue
    }

    grouped.set(row.play_public_id, {
      playPublicId: row.play_public_id,
      totalScore: row.total_score,
      finalizedAt: row.finalized_at,
      user: {
        publicId: row.user_public_id,
        handle: row.handle,
        displayName: row.display_name,
      },
      guesses: [
        {
          locationPublicId: row.location_public_id,
          ordinal: row.ordinal,
          guessPublicId: row.guess_public_id,
          latitude: row.guess_latitude,
          longitude: row.guess_longitude,
          distanceMeters: row.distance_meters,
          score: row.score,
        },
      ],
    })
  }

  return Array.from(grouped.values())
}

function serializeUser(user: UserRow) {
  return {
    publicId: user.public_id,
    handle: user.handle,
    displayName: user.display_name,
    hasPassword: Boolean(user.password_hash),
    createdAt: user.created_at,
  }
}

function serializePlay(rows: PlayGuessRow[]) {
  const firstRow = rows[0]
  return {
    publicId: firstRow.play_public_id,
    totalScore: firstRow.total_score,
    finalizedAt: firstRow.finalized_at,
    createdAt: firstRow.play_created_at,
    guesses: rows
      .filter((row) => row.guess_id !== null)
      .map((row) => ({
        publicId: row.guess_public_id,
        locationPublicId: row.location_public_id,
        ordinal: row.ordinal,
        latitude: row.guess_latitude,
        longitude: row.guess_longitude,
        distanceMeters: row.distance_meters,
        score: row.score,
        createdAt: row.guess_created_at,
      })),
  }
}

function summarizeGame(game: Awaited<ReturnType<typeof requireCurrentGame>>) {
  return {
    publicId: game.public_id,
    gameDate: game.game_date,
    name: game.name,
  }
}

function validateCoordinatePayload(body: { latitude: number; longitude: number }) {
  if (!Number.isFinite(body.latitude) || body.latitude < -90 || body.latitude > 90) {
    throw httpError(400, "Latitude must be between -90 and 90")
  }

  if (!Number.isFinite(body.longitude) || body.longitude < -180 || body.longitude > 180) {
    throw httpError(400, "Longitude must be between -180 and 180")
  }
}

function normalizeSeedTodayGameInput(body: SeedTodayGameInput) {
  if (!Array.isArray(body.locations) || body.locations.length !== 5) {
    throw httpError(400, "Seed payload must contain exactly 5 locations")
  }

  return {
    name: normalizeOptionalText(body.name, 100),
    locations: body.locations.map((location, index) => normalizeSeedLocation(location, index + 1)),
  }
}

function normalizeGameDate(gameDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gameDate)) {
    throw httpError(400, "Game date must use YYYY-MM-DD")
  }

  const parsed = new Date(`${gameDate}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== gameDate) {
    throw httpError(400, "Game date must be a valid calendar date")
  }

  return gameDate
}

function normalizeSeedLocation(location: SeedLocationInput, ordinal: number) {
  const name = location.name?.trim()
  if (!name) {
    throw httpError(400, `Location ${ordinal} is missing a name`)
  }

  validateCoordinatePayload(location)

  return {
    ordinal,
    name,
    region: normalizeOptionalText(location.region, 100),
    isoCountryCode: normalizeIsoCountryCode(location.isoCountryCode, ordinal),
    description: normalizeOptionalText(location.description, 2000),
    latitude: location.latitude,
    longitude: location.longitude,
    locationLink: normalizeOptionalUrl(location.locationLink, ordinal, "locationLink"),
    sourceLink: normalizeOptionalUrl(location.sourceLink, ordinal, "sourceLink"),
    pageViews: normalizeOptionalPageViews(location.pageViews, ordinal),
  }
}

function normalizeOptionalText(value: string | undefined, maxLength: number) {
  if (value === undefined) {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed.length > maxLength) {
    throw httpError(400, `Text field exceeds maximum length of ${maxLength}`)
  }

  return trimmed
}

function normalizeIsoCountryCode(value: string | undefined, ordinal: number) {
  const trimmed = normalizeOptionalText(value, 2)
  if (trimmed === null) {
    return null
  }

  const normalized = trimmed.toUpperCase()
  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw httpError(400, `Location ${ordinal} has an invalid isoCountryCode`)
  }

  return normalized
}

function normalizeOptionalUrl(value: string | undefined, ordinal: number, fieldName: string) {
  const trimmed = normalizeOptionalText(value, 2048)
  if (trimmed === null) {
    return null
  }

  try {
    const url = new URL(trimmed)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol")
    }
  } catch {
    throw httpError(400, `Location ${ordinal} has an invalid ${fieldName}`)
  }

  return trimmed
}

function normalizeOptionalPageViews(value: number | undefined, ordinal: number) {
  if (value === undefined) {
    return null
  }

  if (!Number.isInteger(value) || value < 0) {
    throw httpError(400, `Location ${ordinal} has an invalid pageViews value`)
  }

  return value
}

function normalizeHandle(handle: string) {
  const normalized = handle.trim().toLowerCase()
  if (!/^[a-z0-9_]{3,24}$/.test(normalized)) {
    throw httpError(400, "Handle must be 3-24 chars using lowercase letters, numbers, or underscores")
  }
  return normalized
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw httpError(400, "Request body must be valid JSON")
  }
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const earthRadiusMeters = 6371000
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusMeters * c
}

function distanceToScore(distanceMeters: number) {
  const distanceKm = distanceMeters / 1000
  const raw = MAX_LOCATION_SCORE - Math.floor(distanceKm)
  return Math.max(0, raw)
}

function toRadians(value: number) {
  return (value * Math.PI) / 180
}

function createPublicId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`
}

function createOpaqueToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return toBase64Url(bytes)
}

function toBase64Url(bytes: Uint8Array) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const derived = await pbkdf2(password, salt, PASSWORD_ITERATIONS)
  return `pbkdf2$${PASSWORD_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(derived)}`
}

async function verifyPassword(password: string, encodedHash: string) {
  const [algorithm, iterationsText, saltText, hashText] = encodedHash.split("$")
  if (algorithm !== "pbkdf2" || !iterationsText || !saltText || !hashText) {
    return false
  }

  const iterations = Number(iterationsText)
  if (!Number.isInteger(iterations) || iterations < 1) {
    return false
  }

  const salt = fromBase64Url(saltText)
  const expectedHash = fromBase64Url(hashText)
  const actualHash = await pbkdf2(password, salt, iterations)
  return timingSafeEqual(actualHash, expectedHash)
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const saltBytes = Uint8Array.from(salt)
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"])
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBytes,
      iterations,
    },
    key,
    256,
  )
  return new Uint8Array(bits)
}

function fromBase64Url(value: string) {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=")
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) {
    return false
  }

  let diff = 0
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index]
  }
  return diff === 0
}

function timingSafeEqualText(left: string, right: string) {
  return timingSafeEqual(new TextEncoder().encode(left), new TextEncoder().encode(right))
}

function addDays(date: Date, days: number) {
  const copy = new Date(date)
  copy.setUTCDate(copy.getUTCDate() + days)
  return copy
}

function trimTrailingSlash(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname
}

function getAdminSeedToken(env: AppEnv) {
  return (env as AppEnv & { ADMIN_SEED_TOKEN?: string }).ADMIN_SEED_TOKEN ?? null
}

function currentUtcDate() {
  return new Date().toISOString().slice(0, 10)
}

function requireFound<T>(value: T | null, status: number, message: string): T {
  if (value === null) {
    throw httpError(status, message)
  }
  return value
}

async function first<T>(statement: D1PreparedStatement): Promise<T | null> {
  const result = await statement.first<T>()
  return result ?? null
}

async function all<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>()
  return result.results
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  })
}

function jsonError(error: string, status: number) {
  return json({ error } satisfies ErrorBody, status)
}

function withCors(response: Response) {
  const headers = new Headers(response.headers)
  headers.set("access-control-allow-origin", "*")
  headers.set("access-control-allow-methods", "GET,POST,PATCH,OPTIONS")
  headers.set("access-control-allow-headers", "authorization,content-type,x-admin-token")
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function httpError(status: number, message: string) {
  return new HttpError(status, message)
}

function handleError(error: unknown) {
  if (error instanceof HttpError) {
    return jsonError(error.message, error.status)
  }

  const message = error instanceof Error ? error.message : "Internal server error"
  return jsonError(message, 500)
}

function isSqliteConstraintError(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes("unique constraint failed")
}
