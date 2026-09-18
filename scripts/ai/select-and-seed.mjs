import fs from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { parseArgs, parseIsoDate, printUsage } from "./shared.mjs"

const usage = `
Usage: npm run ai:select-and-seed -- --days <count> [--dry-run]

Find the latest curated date in locations/ and, starting with the next day,
run Copilot location selection and location seeding for each date.
`

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  printUsage(usage)
}

const days = parseDays(args.days)
const dryRun = args["dry-run"] === true
const locationsDir = path.resolve(process.cwd(), "locations")
const latestDate = await getLatestCuratedDate(locationsDir)
const firstDate = addDays(parseIsoDate(latestDate), 1)

for (let offset = 0; offset < days; offset += 1) {
  const date = toIsoDate(addDays(firstDate, offset))
  const commands = [
    ["copilot", "-p", `/select-locations ${date}`],
    ["npm", "run", "seed:locations", "--", "--date", date],
  ]

  for (const command of commands) {
    if (dryRun) {
      process.stdout.write(`${formatCommand(command)}\n`)
      continue
    }

    process.stdout.write(`> ${formatCommand(command)}\n`)
    const result = spawnSync(command[0], command.slice(1), {
      cwd: process.cwd(),
      stdio: "inherit",
    })

    if (result.error) {
      throw result.error
    }

    if (result.status !== 0) {
      process.exit(result.status ?? 1)
    }
  }
}

function parseDays(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    printUsage(`${usage}\nMissing or invalid required --days argument.`, 1)
  }

  return parsed
}

async function getLatestCuratedDate(locationsDir) {
  const entries = await fs.readdir(locationsDir, { withFileTypes: true })
  const datedFiles = entries
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name))
    .map((entry) => entry.name.slice(0, 10))
    .sort()

  const latestDate = datedFiles.at(-1)
  if (!latestDate) {
    throw new Error(`No dated location files found in ${locationsDir}.`)
  }

  return latestDate
}

function addDays(date, days) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10)
}

function formatCommand(parts) {
  return parts
    .map((part) => (/[\s"]/u.test(part) ? JSON.stringify(part) : part))
    .join(" ")
}