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

type PopulateEmptyIconsResponse = {
  updatedUsers: number
}

const usage = `
Usage: npm run icons:populate-empty -- [--env-file .env] [--api-url https://.../admin/users/icons/populate-empty]

Fill every user row whose icon is an empty string with a random curated emoji.
`

const args = parseArgs(process.argv.slice(2)) as CliArgs

if (args.help) {
  printUsage(usage)
}

const envFilePath = typeof args["env-file"] === "string" ? args["env-file"] : undefined
const apiUrl = normalizeApiUrl(typeof args["api-url"] === "string" ? args["api-url"] : defaultPopulateEmptyIconsApiUrl())
const adminToken = getRequiredEnv("ADMIN_SEED_TOKEN", envFilePath)

const response = (await fetchJson(apiUrl, {
  method: "POST",
  headers: {
    "x-admin-token": adminToken,
  },
})) as PopulateEmptyIconsResponse

process.stdout.write(`Populated icons for ${response.updatedUsers} user(s).\n`)

function defaultPopulateEmptyIconsApiUrl() {
  const base = new URL(DEFAULT_ADMIN_API_URL)
  return new URL("/admin/users/icons/populate-empty", base.origin).toString()
}

function normalizeApiUrl(value: string) {
  const url = new URL(value)
  return url.toString()
}