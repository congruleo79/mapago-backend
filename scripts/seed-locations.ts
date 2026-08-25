import { appendFile, readFile, readdir } from "node:fs/promises"
import path from "node:path"

import { DEFAULT_ADMIN_API_URL, fetchJson, getRequiredEnv, parseArgs, parseIsoDate, printUsage } from "./ai/shared.mjs"

type CliArgs = {
  [key: string]: string | boolean | string[] | undefined
  _: string[]
}

type SourceLocation = {
  name?: string
  region?: string
  isoCountryCode?: string
  text?: string
  source_link?: string
  wikibase_id?: string
  coordinates?: {
    lat?: number
    lon?: number
  }
}

type SeedLocation = {
  name: string
  region?: string
  isoCountryCode?: string
  description?: string
  latitude: number
  longitude: number
  locationLink: string
  sourceLink?: string
  pageViews: number
}

type SeedResponse = {
  created: boolean
  game: {
    gameDate: string
    locations: Array<unknown>
  }
}

const DEFAULT_ADMIN_GAMES_API_URL = new URL("/admin/games", DEFAULT_ADMIN_API_URL).toString()
const DATE_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}\.json$/
const BLACKLIST_PATH = path.resolve(process.cwd(), "locations", "candidates", "blacklist.txt")
const usage = `
Usage: npm run seed:locations -- [--date YYYY-MM-DD] [--env-file .env] [--api-url ${DEFAULT_ADMIN_GAMES_API_URL}] [--dir locations]

Read dated JSON files from locations/ and seed them to the admin games endpoint.
By default, only files after today's UTC date are seeded.
When --date is provided, only files on or after that date are seeded.
`

const args = parseArgs(process.argv.slice(2)) as CliArgs

if (args.help) {
  printUsage(usage)
}

const envFilePath = typeof args["env-file"] === "string" ? args["env-file"] : undefined
const apiUrl = normalizeApiUrl(typeof args["api-url"] === "string" ? args["api-url"] : DEFAULT_ADMIN_GAMES_API_URL)
const inputDir = path.resolve(process.cwd(), typeof args.dir === "string" ? args.dir : "locations")
const minimumDate = typeof args.date === "string" ? parseIsoDate(args.date).toISOString().slice(0, 10) : tomorrowIsoDate()
const adminToken = getRequiredEnv("ADMIN_SEED_TOKEN", envFilePath)
const seededBlacklistLines = new Set<string>()

const dateFiles = (await readdir(inputDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && DATE_FILE_PATTERN.test(entry.name))
  .map((entry) => entry.name)
  .filter((fileName) => minimumDate === null || fileName.slice(0, -".json".length) >= minimumDate)
  .sort()

if (dateFiles.length === 0) {
  throw new Error(`No dated location files found in ${inputDir} on or after ${minimumDate}`)
}

const results: Array<{ date: string; created: boolean; locations: number }> = []

for (const fileName of dateFiles) {
  const gameDate = fileName.slice(0, -".json".length)
  const filePath = path.join(inputDir, fileName)
  const locations = await loadSeedLocations(filePath)
  const result = (await fetchJson(`${apiUrl}/${gameDate}/seed`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-token": adminToken,
    },
    body: JSON.stringify({ locations }),
  })) as SeedResponse

  results.push({
    date: result.game.gameDate,
    created: result.created,
    locations: result.game.locations.length,
  })

  for (const location of locations) {
    seededBlacklistLines.add(formatBlacklistLine(location))
  }

  process.stdout.write(`${gameDate}: ${result.created ? "created" : "updated"} (${locations.length} locations)\n`)
}

const appendedBlacklistLines = await appendBlacklistLines(BLACKLIST_PATH, seededBlacklistLines)

if (appendedBlacklistLines > 0) {
  process.stdout.write(`Appended ${appendedBlacklistLines} blacklist line(s) to ${BLACKLIST_PATH}.\n`)
}

process.stdout.write(`Seeded ${results.length} file(s).\n`)

function normalizeApiUrl(value: string) {
  const url = new URL(value)
  return url.toString().replace(/\/$/, "")
}

function tomorrowIsoDate() {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

async function loadSeedLocations(filePath: string): Promise<SeedLocation[]> {
  const contents = await readFile(filePath, "utf8")
  const parsed = JSON.parse(contents) as unknown

  if (!Array.isArray(parsed)) {
    throw new Error(`${filePath} must contain a JSON array`)
  }

  return parsed.map((location, index) => toSeedLocation(location, filePath, index + 1))
}

function toSeedLocation(value: unknown, filePath: string, ordinal: number): SeedLocation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${filePath} item ${ordinal} must be an object`)
  }

  const location = value as SourceLocation
  const name = requireString(location.name, filePath, ordinal, "name")
  const wikibaseId = requireString(location.wikibase_id, filePath, ordinal, "wikibase_id")
  const latitude = requireNumber(location.coordinates?.lat, filePath, ordinal, "coordinates.lat")
  const longitude = requireNumber(location.coordinates?.lon, filePath, ordinal, "coordinates.lon")

  return {
    name,
    region: optionalString(location.region),
    isoCountryCode: optionalString(location.isoCountryCode),
    description: optionalString(location.text),
    latitude,
    longitude,
    locationLink: `https://www.wikidata.org/wiki/${wikibaseId}`,
    sourceLink: optionalString(location.source_link),
    pageViews: 0,
  }
}

function requireString(value: string | undefined, filePath: string, ordinal: number, fieldName: string) {
  const normalized = optionalString(value)
  if (!normalized) {
    throw new Error(`${filePath} item ${ordinal} is missing ${fieldName}`)
  }
  return normalized
}

function optionalString(value: string | undefined) {
  if (typeof value !== "string") {
    return undefined
  }

  const normalized = value.trim()
  return normalized ? normalized : undefined
}

function requireNumber(value: number | undefined, filePath: string, ordinal: number, fieldName: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${filePath} item ${ordinal} is missing ${fieldName}`)
  }

  return value
}

function formatBlacklistLine(location: SeedLocation) {
  const region = location.region?.trim() ?? ""
  return `${location.name}, ${region}`.trim()
}

async function appendBlacklistLines(filePath: string, lines: Iterable<string>) {
  const existingLines = await readExistingBlacklistLines(filePath)
  const nextLines = [...lines].filter((line) => line !== "," && !existingLines.has(line))

  if (nextLines.length === 0) {
    return 0
  }

  await appendFile(filePath, `${nextLines.join("\n")}\n`, "utf8")
  return nextLines.length
}

async function readExistingBlacklistLines(filePath: string) {
  try {
    const contents = await readFile(filePath, "utf8")
    return new Set(
      contents
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    )
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return new Set<string>()
    }

    throw error
  }
}
