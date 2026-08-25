import {
  DEFAULT_ADMIN_API_URL,
  fetchJson,
  getRequiredEnv,
  parseArgs,
  printUsage,
} from "./shared.mjs"
import fs from "node:fs/promises"
import path from "node:path"

const usage = `
Usage: npm run ai:blacklist -- [--env-file .env] [--api-url ${DEFAULT_ADMIN_API_URL}]

Fetch the recent-location blacklist from the production admin API.
Write minimal lines to blacklist.txt as: name, region
`

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  printUsage(usage)
}

const envFilePath = typeof args["env-file"] === "string" ? args["env-file"] : undefined
const apiUrl = typeof args["api-url"] === "string" ? args["api-url"] : DEFAULT_ADMIN_API_URL
const adminToken = getRequiredEnv("ADMIN_SEED_TOKEN", envFilePath)

const payload = await fetchJson(apiUrl, {
  headers: {
    "x-admin-token": adminToken,
  },
})

const locations = Array.isArray(payload.locations) ? payload.locations : []

const lines = locations
  .map((location) => {
    const name = typeof location?.name === "string" ? location.name.trim() : ""
    const region = typeof location?.region === "string" ? location.region.trim() : ""
    return `${name}, ${region}`.trim()
  })
  .filter((line) => line !== ",")

const outputPath = path.resolve(process.cwd(), "locations", "candidates", "blacklist.txt")
await fs.writeFile(outputPath, `${lines.join("\n")}\n`, "utf8")

process.stdout.write(`${outputPath}\n`)