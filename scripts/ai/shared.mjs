import fs from "node:fs"
import path from "node:path"

const WIKIPEDIA_ALLOWED_HOST = "en.wikipedia.org"
const WIKIPEDIA_ARTICLE_PREFIX = "/wiki/"
const WIKIPEDIA_BLOCKED_NAMESPACES = new Set([
  "category",
  "draft",
  "file",
  "help",
  "mediawiki",
  "module",
  "portal",
  "special",
  "talk",
  "template",
  "user",
  "wikipedia",
])

export function parseArgs(argv) {
  const args = { _: [] }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith("--")) {
      args._.push(token)
      continue
    }

    const eqIndex = token.indexOf("=")
    if (eqIndex !== -1) {
      args[token.slice(2, eqIndex)] = token.slice(eqIndex + 1)
      continue
    }

    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith("--")) {
      args[key] = true
      continue
    }

    args[key] = next
    index += 1
  }

  return args
}

export function printUsage(text, exitCode = 0) {
  const stream = exitCode === 0 ? process.stdout : process.stderr
  stream.write(`${text.trim()}\n`)
  process.exit(exitCode)
}

export function parseIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Date must use YYYY-MM-DD")
  }

  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Date must be a valid calendar date")
  }

  return parsed
}

export function formatMonthDay(date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date)
}

export function loadEnvFile(envFilePath = path.resolve(process.cwd(), ".env")) {
  if (!fs.existsSync(envFilePath)) {
    return {}
  }

  const contents = fs.readFileSync(envFilePath, "utf8")
  const entries = {}

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }

    const exportPrefix = trimmed.startsWith("export ") ? "export ".length : 0
    const separatorIndex = trimmed.indexOf("=", exportPrefix)
    if (separatorIndex === -1) {
      continue
    }

    const key = trimmed.slice(exportPrefix, separatorIndex).trim()
    let value = trimmed.slice(separatorIndex + 1).trim()

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    entries[key] = value
  }

  return entries
}

export function getRequiredEnv(name, envFilePath) {
  const envValues = loadEnvFile(envFilePath)
  const value = process.env[name] ?? envValues[name]
  if (!value) {
    throw new Error(`Missing required environment variable ${name}. Set it in the shell or ${path.basename(envFilePath ?? ".env")}.`)
  }
  return value
}

export async function fetchJson(url, init = {}) {
  const headers = new Headers(init.headers ?? {})
  if (!headers.has("accept")) {
    headers.set("accept", "application/json")
  }
  if (!headers.has("user-agent")) {
    headers.set("user-agent", "mapago-backend-ai-scripts/0.1")
  }

  const response = await fetch(url, {
    ...init,
    headers,
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Request failed with ${response.status} ${response.statusText}: ${body.slice(0, 400)}`)
  }

  return response.json()
}

export function toJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function writeJson(value) {
  process.stdout.write(toJson(value))
}

export function isHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

export function isEnglishWikipediaArticleUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return false
    }
    if (url.hostname !== WIKIPEDIA_ALLOWED_HOST) {
      return false
    }
    if (!url.pathname.startsWith(WIKIPEDIA_ARTICLE_PREFIX)) {
      return false
    }

    const title = decodeURIComponent(url.pathname.slice(WIKIPEDIA_ARTICLE_PREFIX.length))
    if (!title) {
      return false
    }

    const namespaceSeparatorIndex = title.indexOf(":")
    if (namespaceSeparatorIndex === -1) {
      return true
    }

    const namespace = title.slice(0, namespaceSeparatorIndex).toLowerCase()
    return !WIKIPEDIA_BLOCKED_NAMESPACES.has(namespace)
  } catch {
    return false
  }
}

export function wikipediaArticleKey(value) {
  if (!isEnglishWikipediaArticleUrl(value)) {
    return null
  }

  const url = new URL(value)
  return normalizeText(decodeURIComponent(url.pathname.slice(WIKIPEDIA_ARTICLE_PREFIX.length)).replace(/_/g, " "))
}

export function normalizeText(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

export function normalizeLocationKey({ name, isoCountryCode, locationLink }) {
  const articleKey = locationLink ? wikipediaArticleKey(locationLink) : null
  if (articleKey) {
    return `wiki:${articleKey}`
  }

  const normalizedName = normalizeText(name)
  const normalizedCountry = normalizeText(isoCountryCode ?? "")
  return `name:${normalizedName}|country:${normalizedCountry}`
}

export function readJsonFile(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath)
  const contents = fs.readFileSync(absolutePath, "utf8")
  return JSON.parse(contents)
}

export function asArray(value) {
  return Array.isArray(value) ? value : []
}

export const DEFAULT_ADMIN_API_URL = "https://mapago-backend.map-ago.workers.dev/admin/locations/recent"