import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { parseArgs, parseIsoDate, printUsage, readJsonFile } from "./shared.mjs"

const usage = `
Usage: npm run ai:events -- --date YYYY-MM-DD

Read locations/candidates/YYYY-MM-DD.json and print a plain-text summary.
`

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  printUsage(usage)
}

const dateInput = typeof args.date === "string" ? args.date : args._[0]
if (!dateInput) {
  printUsage(`${usage}\nMissing required --date argument.`, 1)
}

parseIsoDate(dateInput)

const inputPath = path.join("locations", "candidates", `${dateInput}.json`)
ensureCandidateFile(inputPath, dateInput)
const entries = readJsonFile(inputPath)

if (!Array.isArray(entries)) {
  throw new Error(`${inputPath} must contain a top-level array.`)
}

const lines = entries.map((entry, index) => formatEntry(entry, index))
process.stdout.write(`${lines.join("\n\n")}\n`)

function ensureCandidateFile(filePath, dateInput) {
  const absolutePath = path.resolve(process.cwd(), filePath)
  if (fs.existsSync(absolutePath)) {
    return
  }

  process.stderr.write(`${filePath} does not exist. Fetching candidates for ${dateInput}.\n`)

  const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/events.ts", "--date", dateInput], {
    cwd: process.cwd(),
    stdio: "inherit",
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0 || !fs.existsSync(absolutePath)) {
    throw new Error(`Unable to generate missing candidates file ${filePath}.`)
  }
}

function formatEntry(entry, index) {
  const category = typeof entry?.category === "string" ? entry.category : "unknown"
  const year = typeof entry?.year === "number" ? String(entry.year) : "unknown"
  const text = typeof entry?.text === "string" ? entry.text.trim() : ""
  const locations = Array.isArray(entry?.pages)
    ? entry.pages
        .filter((page) => page && typeof page === "object" && page.coordinates && typeof page.title === "string")
        .map((page) => page.title.trim())
        .filter(Boolean)
    : []

  return `${index} | ${category} | ${year} | ${text}\nlocations: ${locations.join(", ")}`
}
