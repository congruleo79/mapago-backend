import path from "node:path"

import { parseArgs, parseIsoDate, printUsage, readJsonFile, writeJson } from "./shared.mjs"

const usage = `
Usage: npm run ai:candidates:get -- --date YYYY-MM-DD --indices 1,4,7 [--dir locations/candidates]

Return the candidate entries at the requested zero-based indices from locations/candidates/YYYY-MM-DD.json.
`

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  printUsage(usage)
}

const dateValue = typeof args.date === "string" ? args.date : undefined
if (!dateValue) {
  printUsage(`${usage}\nMissing required --date argument.`, 1)
}

parseIsoDate(dateValue)

const indicesValue = typeof args.indices === "string" ? args.indices : args._.join(",")
const indices = parseIndices(indicesValue)
if (indices.length === 0) {
  printUsage(`${usage}\nMissing required indices. Pass --indices 1,4,7 or positional indices.`, 1)
}

const baseDir = path.resolve(process.cwd(), typeof args.dir === "string" ? args.dir : path.join("locations", "candidates"))
const inputFile = path.join(baseDir, `${dateValue}.json`)
const payload = readJsonFile(inputFile)

if (!Array.isArray(payload)) {
  throw new Error(`${inputFile} must contain a JSON array.`)
}

const entries = indices.map((index) => {
  if (index < 0 || index >= payload.length) {
    throw new Error(`Index ${index} is out of range for ${inputFile}; expected 0-${payload.length - 1}.`)
  }

  return payload[index]
})

writeJson(entries)

function parseIndices(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return []
  }

  return value
    .split(",")
    .flatMap((token) => token.split(/\s+/))
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      if (!/^\d+$/.test(token)) {
        throw new Error(`Invalid index: ${token}`)
      }

      return Number(token)
    })
}
