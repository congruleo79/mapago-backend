import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

type CliArgs = {
  help?: boolean
  date?: string
  enrichWikidata?: boolean
}

type OnThisDayResponse = {
  births?: WikimediaEntry[]
  deaths?: WikimediaEntry[]
  events?: WikimediaEntry[]
  holidays?: WikimediaEntry[]
  selected?: WikimediaEntry[]
}

type WikimediaEntry = {
  year?: number | null
  text?: string
  pages?: WikimediaPage[]
}

type WikimediaPage = {
  title?: string
  extract?: string
  normalizedtitle?: string
  wikibase_item?: string
  description?: string
  content_urls?: {
    desktop?: {
      page?: string
    }
  }
  coordinates?: unknown
}

type CandidateEntry = {
  category: CandidateCategory
  year: number | null
  text: string
  pages: CandidatePage[]
}

type CandidateCategory = "birth" | "death" | "event" | "holiday" | "selected"

type CandidatePage = {
  title: string
  extract: string
  wikibase_item: string
  description: string
  url: string
  coordinates: CandidateCoordinates | null
  wikidata: CandidateWikidata | null
}

type CandidateCoordinates = {
  lat: number
  lon: number
}

type CandidateWikidata = {
  placeOfBirth: string | null
  placeOfDeath: string | null
  categories: string[]
  location: string | null
  coordinateLocation: CandidateCoordinates | null
  northExtremePoint: CandidateCoordinates | null
  eastExtremePoint: CandidateCoordinates | null
  westExtremePoint: CandidateCoordinates | null
  southExtremePoint: CandidateCoordinates | null
  area: CandidateArea | null
}

type CandidateArea = {
  amount: number
  unit: string | null
}

type WikidataEntityResponse = {
  entities?: Record<string, WikidataEntity>
}

type WikidataEntity = {
  claims?: Record<string, WikidataClaim[]>
}

type WikidataClaim = {
  mainsnak?: {
    datavalue?: {
      value?: unknown
    }
  }
}

const WIKIDATA_ENTITY_BASE_URL = "https://www.wikidata.org/wiki/Special:EntityData"
const WIKIDATA_REQUEST_DELAY_MS = 300
const WIKIDATA_MAX_ATTEMPTS = 5
const WIKIDATA_INITIAL_BACKOFF_MS = 1_000

const usage = `
Usage: npm run ai:events -- --date YYYY-MM-DD [--enrich-wikidata]

Fetch Wikimedia On This Day entries for a date, keep only entries with at least one mapable page,
flatten them into a single array tagged by category, and write the result to
locations/candidates/YYYY-MM-DD.json.
`

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  printUsage(usage)
}

if (!args.date) {
  printUsage(`${usage}\nMissing required --date argument.`, 1)
}

const date = parseIsoDate(args.date)
const month = String(date.getUTCMonth() + 1).padStart(2, "0")
const day = String(date.getUTCDate()).padStart(2, "0")
const sourceUrl = `https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/all/${month}/${day}`

const payload = await fetchJson<OnThisDayResponse>(sourceUrl)
const result = [
  ...filterEntries("selected", payload.selected),
  ...filterEntries("event", payload.events),
  ...filterEntries("holiday", payload.holidays),
  ...filterEntries("birth", payload.births),
  ...filterEntries("death", payload.deaths),
]

const outputDir = path.resolve(process.cwd(), "locations", "candidates")
const outputPath = path.join(outputDir, `${args.date}.json`)

await mkdir(outputDir, { recursive: true })
if (args.enrichWikidata) {
  await enrichEntriesWithWikidata(result, outputPath)
}
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8")

process.stdout.write(`${outputPath}\n`)

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {}

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === "--help") {
      parsed.help = true
      continue
    }

    if (token === "--enrich-wikidata") {
      parsed.enrichWikidata = true
      continue
    }

    if (token === "--date") {
      parsed.date = argv[index + 1]
      index += 1
      continue
    }

    if (token.startsWith("--date=")) {
      parsed.date = token.slice("--date=".length)
      continue
    }

    throw new Error(`Unknown argument: ${token}`)
  }

  return parsed
}

function printUsage(text: string, exitCode = 0): never {
  const stream = exitCode === 0 ? process.stdout : process.stderr
  stream.write(`${text.trim()}\n`)
  process.exit(exitCode)
}

function parseIsoDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Date must use YYYY-MM-DD")
  }

  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Date must be a valid calendar date")
  }

  return parsed
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "mapago-backend-ai-scripts/0.1",
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Request failed with ${response.status} ${response.statusText}: ${body.slice(0, 400)}`)
  }

  return (await response.json()) as T
}

function filterEntries(category: CandidateCategory, entries: WikimediaEntry[] | undefined): CandidateEntry[] {
  return (entries ?? []).map((entry) => toCandidateEntry(category, entry)).filter((entry): entry is CandidateEntry => entry !== null)
}

function toCandidateEntry(category: CandidateCategory, entry: WikimediaEntry): CandidateEntry | null {
  const text = typeof entry.text === "string" ? entry.text.trim() : ""
  if (!text) {
    return null
  }

  const sourcePages = entry.pages ?? []
  const pages = sourcePages.map(toCandidatePage).filter((page): page is CandidatePage => page !== null)
  if (!pages.some(hasCoordinates)) {
    return null
  }

  return {
    category,
    year: typeof entry.year === "number" ? entry.year : null,
    text,
    pages,
  }
}

function toCandidatePage(page: WikimediaPage): CandidatePage | null {
  const title = readOptionalString(page.normalizedtitle)
  const extract = readOptionalString(page.extract)
  const wikibaseItem = readOptionalString(page.wikibase_item)
  const description = readOptionalString(page.description)
  const url = readOptionalString(page.content_urls?.desktop?.page)

  if (!title || !extract || !wikibaseItem || !description || !url) {
    return null
  }

  return {
    title,
    extract,
    wikibase_item: wikibaseItem,
    description,
    url,
    coordinates: readCoordinates(page.coordinates),
    wikidata: null,
  }
}

async function enrichEntriesWithWikidata(entries: CandidateEntry[], outputPath: string): Promise<void> {
  const cache = new Map<string, CandidateWikidata>()

  for (const entry of entries) {
    for (const page of entry.pages) {
      const cached = cache.get(page.wikibase_item)
      if (cached) {
        page.wikidata = cached
        continue
      }

      const wikidata = await fetchWikidataWithRetry(page.wikibase_item)
      cache.set(page.wikibase_item, wikidata)
      page.wikidata = wikidata
      await writeFile(outputPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8")
      await delay(WIKIDATA_REQUEST_DELAY_MS)
    }
  }
}

async function fetchWikidataWithRetry(entityId: string): Promise<CandidateWikidata> {
  let backoffMs = WIKIDATA_INITIAL_BACKOFF_MS

  for (let attempt = 1; attempt <= WIKIDATA_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetchWikidata(entityId)
    } catch (error) {
      if (attempt === WIKIDATA_MAX_ATTEMPTS) {
        throw error
      }

      await delay(backoffMs)
      backoffMs *= 2
    }
  }

  throw new Error(`Unable to fetch Wikidata entity ${entityId}`)
}

async function fetchWikidata(entityId: string): Promise<CandidateWikidata> {
  const response = await fetch(`${WIKIDATA_ENTITY_BASE_URL}/${entityId}.json`, {
    headers: {
      accept: "application/json",
      "user-agent": "mapago-backend-ai-scripts/0.1",
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Wikidata request failed for ${entityId} with ${response.status} ${response.statusText}: ${body.slice(0, 400)}`)
  }

  const payload = (await response.json()) as WikidataEntityResponse
  const claims = payload.entities?.[entityId]?.claims
  if (!claims) {
    throw new Error(`Wikidata entity ${entityId} did not include claims`)
  }

  return {
    placeOfBirth: readFirstEntityIdClaim(claims, "P19"),
    placeOfDeath: readFirstEntityIdClaim(claims, "P20"),
    categories: readEntityIdClaims(claims, "P31"),
    location: readFirstEntityIdClaim(claims, "P276"),
    coordinateLocation: readFirstCoordinatesClaim(claims, "P625"),
    northExtremePoint: readFirstCoordinatesClaim(claims, "P1332"),
    eastExtremePoint: readFirstCoordinatesClaim(claims, "P1334"),
    westExtremePoint: readFirstCoordinatesClaim(claims, "P1335"),
    southExtremePoint: readFirstCoordinatesClaim(claims, "P1333"),
    area: readFirstAreaClaim(claims, "P2046"),
  }
}

function readEntityIdClaims(claims: Record<string, WikidataClaim[]>, propertyId: string): string[] {
  return readClaimValues(claims, propertyId)
    .map(readEntityId)
    .filter((value): value is string => value !== null)
}

function readFirstEntityIdClaim(claims: Record<string, WikidataClaim[]>, propertyId: string): string | null {
  const [value] = readEntityIdClaims(claims, propertyId)
  return value ?? null
}

function readFirstCoordinatesClaim(claims: Record<string, WikidataClaim[]>, propertyId: string): CandidateCoordinates | null {
  for (const value of readClaimValues(claims, propertyId)) {
    const coordinates = readWikidataCoordinates(value)
    if (coordinates) {
      return coordinates
    }
  }

  return null
}

function readFirstAreaClaim(claims: Record<string, WikidataClaim[]>, propertyId: string): CandidateArea | null {
  for (const value of readClaimValues(claims, propertyId)) {
    const area = readWikidataArea(value)
    if (area) {
      return area
    }
  }

  return null
}

function readClaimValues(claims: Record<string, WikidataClaim[]>, propertyId: string): unknown[] {
  return (claims[propertyId] ?? []).map((claim) => claim.mainsnak?.datavalue?.value)
}

function readEntityId(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const id = (value as { id?: unknown }).id
  return typeof id === "string" && id ? id : null
}

function readWikidataCoordinates(value: unknown): CandidateCoordinates | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const lat = readFiniteNumber((value as { latitude?: unknown }).latitude)
  const lon = readFiniteNumber((value as { longitude?: unknown }).longitude)
  if (lat === null || lon === null) {
    return null
  }

  return { lat, lon }
}

function readWikidataArea(value: unknown): CandidateArea | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const amountValue = (value as { amount?: unknown }).amount
  const unitValue = (value as { unit?: unknown }).unit
  if (typeof amountValue !== "string") {
    return null
  }

  const amount = Number(amountValue)
  if (!Number.isFinite(amount)) {
    return null
  }

  return {
    amount,
    unit: typeof unitValue === "string" ? extractEntityIdFromUri(unitValue) : null,
  }
}

function extractEntityIdFromUri(value: string): string | null {
  const match = value.match(/Q\d+$/)
  return match ? match[0] : null
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function hasCoordinates(page: Pick<CandidatePage, "coordinates">): boolean {
  return readCoordinates(page.coordinates) !== null
}

function readCoordinates(value: unknown): CandidateCoordinates | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const lat = readFiniteNumber((value as { lat?: unknown }).lat)
  const lon = readFiniteNumber((value as { lon?: unknown }).lon)
  if (lat === null || lon === null) {
    return null
  }

  return { lat, lon }
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected ${fieldName} to be a string`)
  }

  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`Expected ${fieldName} to be a non-empty string`)
  }

  return trimmed
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
