import { DEFAULT_ADMIN_API_URL, fetchJson, getRequiredEnv, parseArgs, printUsage } from "./ai/shared.mjs"

declare const process: {
  argv: string[]
  stdout: {
    write(chunk: string): void
  }
}

type CliArgs = {
  [key: string]: string | boolean | string[] | undefined
  _: string[]
}

type RatingBackfillCursor = {
  finalizedAt: string
  playId: number
}

type RatingBackfillResponse = {
  reset: boolean
  processedPlays: number
  createdEvents: number
  nextCursor: RatingBackfillCursor | null
}

const usage = `
Usage: npm run ratings:backfill -- [--reset] [--limit 100] [--env-file .env] [--api-url https://.../admin/ratings/backfill] [--cursor-finalized-at TIMESTAMP --cursor-play-id ID]

Replay rating history in batches through the admin ratings backfill endpoint.
Use --reset on the first run to clear existing rating events and reset all user ratings to 1500.
`

const args = parseArgs(process.argv.slice(2)) as CliArgs

if (args.help) {
  printUsage(usage)
}

const envFilePath = typeof args["env-file"] === "string" ? args["env-file"] : undefined
const apiUrl = normalizeApiUrl(typeof args["api-url"] === "string" ? args["api-url"] : defaultBackfillApiUrl())
const adminToken = getRequiredEnv("ADMIN_SEED_TOKEN", envFilePath)
const limit = normalizeLimit(args.limit)
let cursor = normalizeCursor(args)
let shouldReset = Boolean(args.reset)
let totalProcessedPlays = 0
let totalCreatedEvents = 0

for (;;) {
  const response = (await fetchJson(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-token": adminToken,
    },
    body: JSON.stringify({
      reset: shouldReset,
      limit,
      cursor,
    }),
  })) as RatingBackfillResponse

  totalProcessedPlays += response.processedPlays
  totalCreatedEvents += response.createdEvents

  process.stdout.write(`processed=${response.processedPlays} createdEvents=${response.createdEvents} reset=${response.reset} nextCursor=${formatCursor(response.nextCursor)}\n`)

  if (response.nextCursor === null) {
    break
  }

  cursor = response.nextCursor
  shouldReset = false
}

process.stdout.write(`Backfill complete. processedPlays=${totalProcessedPlays} createdEvents=${totalCreatedEvents}\n`)

function defaultBackfillApiUrl() {
  const base = new URL(DEFAULT_ADMIN_API_URL)
  return new URL("/admin/ratings/backfill", base.origin).toString()
}

function normalizeApiUrl(value: string) {
  const url = new URL(value)
  return url.toString()
}

function normalizeLimit(value: string | boolean | string[] | undefined) {
  if (value === undefined) {
    return 100
  }

  if (typeof value !== "string") {
    throw new Error("--limit must be a number")
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new Error("--limit must be an integer between 1 and 500")
  }

  return parsed
}

function normalizeCursor(args: CliArgs): RatingBackfillCursor | null {
  const finalizedAt = args["cursor-finalized-at"]
  const playId = args["cursor-play-id"]

  if (finalizedAt === undefined && playId === undefined) {
    return null
  }

  if (typeof finalizedAt !== "string" || typeof playId !== "string") {
    throw new Error("--cursor-finalized-at and --cursor-play-id must be provided together")
  }

  const parsedPlayId = Number(playId)
  if (!Number.isInteger(parsedPlayId) || parsedPlayId < 1) {
    throw new Error("--cursor-play-id must be a positive integer")
  }

  return {
    finalizedAt,
    playId: parsedPlayId,
  }
}

function formatCursor(cursor: RatingBackfillCursor | null) {
  if (cursor === null) {
    return "done"
  }

  return `${cursor.finalizedAt}:${cursor.playId}`
}
