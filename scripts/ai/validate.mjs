import {
  DEFAULT_ADMIN_API_URL,
  fetchJson,
  formatMonthDay,
  getRequiredEnv,
  isEnglishWikipediaArticleUrl,
  isHttpUrl,
  normalizeLocationKey,
  parseArgs,
  parseIsoDate,
  printUsage,
  readJsonFile,
  writeJson,
} from "./shared.mjs"

const REQUIRED_KEYS = ["isoCountryCode", "location_link", "name", "region", "source_link", "text"]
const usage = `
Usage: npm run ai:validate -- --file path/to/file.json [--env-file .env] [--api-url ${DEFAULT_ADMIN_API_URL}]

Validate one AI-generated selection file against local rules and the recent-location blacklist.
`

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  printUsage(usage)
}

const inputFile = typeof args.file === "string" ? args.file : args._[0]
if (!inputFile) {
  printUsage(`${usage}\nMissing required --file argument.`, 1)
}

const payload = readJsonFile(inputFile)
const [dateKey, locations] = extractDatedLocations(payload)
const date = parseIsoDate(dateKey)
const monthDay = formatMonthDay(date)
const errors = []
const seenCountries = new Set()
const seenLocationKeys = new Set()

if (locations.length !== 5) {
  errors.push(`Expected exactly 5 locations for ${dateKey}, received ${locations.length}.`)
}

for (const [index, location] of locations.entries()) {
  const label = `Item ${index + 1}`
  if (!location || typeof location !== "object" || Array.isArray(location)) {
    errors.push(`${label} must be an object.`)
    continue
  }

  const keys = Object.keys(location).sort()
  if (JSON.stringify(keys) !== JSON.stringify(REQUIRED_KEYS)) {
    errors.push(`${label} must contain exactly these keys: ${REQUIRED_KEYS.join(", ")}.`)
  }

  if (!isNonEmptyString(location.name)) {
    errors.push(`${label} has an invalid name.`)
  }

  if (!isNonEmptyString(location.region)) {
    errors.push(`${label} has an invalid region.`)
  }

  if (!isIsoCountryCode(location.isoCountryCode)) {
    errors.push(`${label} has an invalid isoCountryCode.`)
  } else {
    if (seenCountries.has(location.isoCountryCode)) {
      errors.push(`${label} repeats country ${location.isoCountryCode}.`)
    }
    seenCountries.add(location.isoCountryCode)
  }

  if (!isNonEmptyString(location.text)) {
    errors.push(`${label} has an invalid text field.`)
  } else if (!location.text.startsWith(`On ${monthDay}`)) {
    errors.push(`${label} text must start with \`On ${monthDay}\`.`)
  }

  if (!isHttpUrl(location.source_link) || !isEnglishWikipediaArticleUrl(location.source_link)) {
    errors.push(`${label} has an invalid source_link.`)
  }

  if (!isHttpUrl(location.location_link) || !isEnglishWikipediaArticleUrl(location.location_link)) {
    errors.push(`${label} has an invalid location_link.`)
  }

  const locationKey = normalizeLocationKey({
    name: location.name,
    isoCountryCode: location.isoCountryCode,
    locationLink: location.location_link,
  })
  if (seenLocationKeys.has(locationKey)) {
    errors.push(`${label} duplicates another location in the same file.`)
  }
  seenLocationKeys.add(locationKey)
}

const envFilePath = typeof args["env-file"] === "string" ? args["env-file"] : undefined
const apiUrl = typeof args["api-url"] === "string" ? args["api-url"] : DEFAULT_ADMIN_API_URL
const adminToken = getRequiredEnv("ADMIN_SEED_TOKEN", envFilePath)
const blacklistPayload = await fetchJson(apiUrl, {
  headers: {
    "x-admin-token": adminToken,
  },
})

const blacklistKeys = new Set(
  Array.isArray(blacklistPayload.locations)
    ? blacklistPayload.locations.map((location) =>
        normalizeLocationKey({
          name: location?.name ?? "",
          isoCountryCode: location?.isoCountryCode ?? "",
          locationLink: location?.locationLink ?? null,
        }),
      )
    : [],
)

for (const [index, location] of locations.entries()) {
  if (!location || typeof location !== "object" || Array.isArray(location)) {
    continue
  }

  const locationKey = normalizeLocationKey({
    name: location.name,
    isoCountryCode: location.isoCountryCode,
    locationLink: location.location_link,
  })

  if (blacklistKeys.has(locationKey)) {
    errors.push(`Item ${index + 1} conflicts with a location in the recent-use blacklist.`)
  }
}

if (errors.length > 0) {
  process.stderr.write(`Validation failed for ${inputFile}:\n`)
  for (const error of errors) {
    process.stderr.write(`- ${error}\n`)
  }
  process.exit(1)
}

writeJson({
  ok: true,
  file: inputFile,
  date: dateKey,
  locations: locations.length,
  blacklistSize: blacklistKeys.size,
})

function extractDatedLocations(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Selection file must be a JSON object keyed by date.")
  }

  const entries = Object.entries(value)
  if (entries.length !== 1) {
    throw new Error("Selection file must contain exactly one top-level date key.")
  }

  const [dateKey, locations] = entries[0]
  if (!Array.isArray(locations)) {
    throw new Error(`Value for ${dateKey} must be an array.`)
  }

  return [dateKey, locations]
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0
}

function isIsoCountryCode(value) {
  return typeof value === "string" && /^[A-Z]{2}$/.test(value)
}