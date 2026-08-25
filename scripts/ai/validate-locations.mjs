import path from "node:path"

import { formatMonthDay, isEnglishWikipediaArticleUrl, isHttpUrl, parseArgs, parseIsoDate, printUsage, readJsonFile } from "./shared.mjs"

const REQUIRED_KEYS = ["name", "region", "isoCountryCode", "text", "source_link", "wikibase_id", "coordinates"]
const REQUIRED_COORDINATE_KEYS = ["lat", "lon"]
const usage = `
Usage: npm run ai:validate:locations -- --date YYYY-MM-DD [--dir locations] [--allow-repeat-country]

Validate one curated AI location file at locations/YYYY-MM-DD.json.
`

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  printUsage(usage)
}

const dateValue = typeof args.date === "string" ? args.date : typeof args._[0] === "string" ? args._[0] : undefined
if (!dateValue) {
  printUsage(`${usage}\nMissing required --date argument.`, 1)
}

const date = parseIsoDate(dateValue)
const monthDay = formatMonthDay(date)
const baseDir = path.resolve(process.cwd(), typeof args.dir === "string" ? args.dir : "locations")
const inputFile = path.join(baseDir, `${dateValue}.json`)
const payload = readJsonFile(inputFile)
const errors = []
const seenCountries = new Set()
const allowRepeatCountry = args["allow-repeat-country"] === true

if (!Array.isArray(payload)) {
  throw new Error(`${inputFile} must contain a JSON array.`)
}

if (payload.length !== 5) {
  errors.push(`Expected exactly 5 locations, received ${payload.length}.`)
}

for (const [index, location] of payload.entries()) {
  const label = `Item ${index + 1}`

  if (!location || typeof location !== "object" || Array.isArray(location)) {
    errors.push(`${label} must be an object.`)
    continue
  }

  const keys = Object.keys(location)
  if (JSON.stringify(keys) !== JSON.stringify(REQUIRED_KEYS)) {
    errors.push(`${label} must contain exactly these keys in order: ${REQUIRED_KEYS.join(", ")}.`)
  }

  if (!isNonEmptyString(location.name)) {
    errors.push(`${label} has an invalid name.`)
  }

  if (!isNonEmptyString(location.region)) {
    errors.push(`${label} has an invalid region.`)
  }

  if (!isIsoCountryCode(location.isoCountryCode)) {
    errors.push(`${label} has an invalid isoCountryCode.`)
  } else if (!allowRepeatCountry && seenCountries.has(location.isoCountryCode)) {
    errors.push(`${label} repeats country ${location.isoCountryCode}.`)
  } else {
    seenCountries.add(location.isoCountryCode)
  }

  validateText(location.text, monthDay, label, errors)

  if (!isHttpUrl(location.source_link) || !isEnglishWikipediaArticleUrl(location.source_link)) {
    errors.push(`${label} has an invalid source_link.`)
  }

  if (!isWikibaseId(location.wikibase_id)) {
    errors.push(`${label} has an invalid wikibase_id.`)
  }

  validateCoordinates(location.coordinates, label, errors)
}

if (errors.length > 0) {
  process.stderr.write(`Validation failed for ${inputFile}:\n`)
  for (const error of errors) {
    process.stderr.write(`- ${error}\n`)
  }
  process.exit(1)
}

process.stdout.write(`Validated ${inputFile}\n`)

function validateText(value, monthDay, label, errors) {
  if (!isNonEmptyString(value)) {
    errors.push(`${label} has an invalid text field.`)
    return
  }

  if (!value.startsWith(`On ${monthDay}`)) {
    errors.push(`${label} text must start with \`On ${monthDay}\`.`)
  }

  const wordCount = countWords(value)
  if (wordCount > 50) {
    errors.push(`${label} text must contain 50 words or fewer; received ${wordCount}.`)
  }
}

function validateCoordinates(value, label, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label} has invalid coordinates.`)
    return
  }

  const keys = Object.keys(value)
  if (JSON.stringify(keys) !== JSON.stringify(REQUIRED_COORDINATE_KEYS)) {
    errors.push(`${label} coordinates must contain exactly these keys in order: ${REQUIRED_COORDINATE_KEYS.join(", ")}.`)
  }

  if (!isFiniteLatitude(value.lat)) {
    errors.push(`${label} has an invalid coordinates.lat.`)
  }

  if (!isFiniteLongitude(value.lon)) {
    errors.push(`${label} has an invalid coordinates.lon.`)
  }
}

function countWords(value) {
  const matches = value.match(/\b\w+\b/g)
  return matches ? matches.length : 0
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0
}

function isIsoCountryCode(value) {
  return typeof value === "string" && /^[A-Z]{2}$/.test(value)
}

function isWikibaseId(value) {
  return typeof value === "string" && /^Q\d+$/.test(value)
}

function isFiniteLatitude(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90
}

function isFiniteLongitude(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180
}
