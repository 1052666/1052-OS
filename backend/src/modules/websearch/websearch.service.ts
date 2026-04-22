import { HttpError } from '../../http-error.js'
import { readJson, writeJson } from '../../storage.js'
import { getUapisCatalog, setUapisApiEnabled } from '../uapis/uapis.service.js'

type SearchRegion = 'cn' | 'global'
type SearchTime = 'hour' | 'day' | 'week' | 'month' | 'year'
type SearchIntent =
  | 'general'
  | 'development'
  | 'privacy'
  | 'news'
  | 'academic'
  | 'wechat'
  | 'knowledge'
type SearchEngineStatus = 'stable' | 'pass'
export type SearchSourceFamily = 'web-search' | 'skill-marketplace' | 'uapis'
type SearchSourceKind = 'engine' | 'marketplace' | 'repository' | 'api'

type SearchEngine = {
  id: string
  name: string
  region: SearchRegion
  template: string
  homepage: string
  supportsTime?: boolean
  intentTags?: SearchIntent[]
  status: SearchEngineStatus
  statusReason?: string
}

export type SearchSourceInfo = {
  id: string
  name: string
  family: SearchSourceFamily
  kind: SearchSourceKind
  status: SearchEngineStatus
  statusReason: string | null
  enabled: boolean
  homepage: string
  region: SearchRegion | 'shared' | null
  supportsTime: boolean
  intents: string[]
  tags: string[]
}

export type SearchSourceGroup = {
  id: SearchSourceFamily
  title: string
  description: string
  items: SearchSourceInfo[]
}

export type SearchRequest = {
  query: string
  engines?: string[]
  region?: 'auto' | SearchRegion
  site?: string
  filetype?: string
  time?: SearchTime
  intent?: SearchIntent
  limit?: number
}

export type SearchItem = {
  title: string
  url: string
  snippet: string
  engine: string
  engineId: string
  score: number
  matchedBy: string[]
}

export type SearchResponse = {
  query: string
  searchQuery: string
  intent: SearchIntent
  usedDefaultStableSet: boolean
  selectedEngines: { id: string; name: string; region: SearchRegion }[]
  succeededEngines: string[]
  failedEngines: { engine: string; error: string }[]
  results: SearchItem[]
}

export type WebPageResponse = {
  url: string
  finalUrl: string
  title: string
  text: string
  excerpt: string
}

type RawSearchItem = Omit<SearchItem, 'score' | 'matchedBy'>

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
const FETCH_TIMEOUT_MS = 12000
const RETRY_DELAY_MS = 1200
const SKILL_MARKETPLACE_HOME = 'https://skills.sh/'
const GITHUB_HOME = 'https://github.com/'

const ENGINES: SearchEngine[] = [
  {
    id: 'bing-cn',
    name: 'Bing CN',
    region: 'cn',
    template: 'https://cn.bing.com/search?q={query}&ensearch=0',
    homepage: 'https://cn.bing.com/',
    supportsTime: true,
    intentTags: ['general', 'development', 'news'],
    status: 'stable',
  },
  {
    id: 'bing-int',
    name: 'Bing INT',
    region: 'cn',
    template: 'https://cn.bing.com/search?q={query}&ensearch=1',
    homepage: 'https://cn.bing.com/',
    supportsTime: true,
    intentTags: ['general', 'development', 'news'],
    status: 'stable',
  },
  {
    id: 'sogou-web',
    name: 'Sogou Web',
    region: 'cn',
    template: 'https://www.sogou.com/web?query={query}',
    homepage: 'https://www.sogou.com/',
    intentTags: ['general', 'development', 'news'],
    status: 'stable',
    statusReason: '已验证网页搜索结果可稳定返回，并补通搜狗跳转链接解析。',
  },
  {
    id: 'wechat',
    name: 'WeChat',
    region: 'cn',
    template: 'https://wx.sogou.com/weixin?type=2&query={query}',
    homepage: 'https://wx.sogou.com/',
    intentTags: ['wechat'],
    status: 'stable',
    statusReason: '已补通微信搜索解析，作为正式可用源保留。',
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    region: 'global',
    template: 'https://duckduckgo.com/html/?q={query}',
    homepage: 'https://duckduckgo.com/',
    intentTags: ['development', 'privacy', 'general'],
    status: 'stable',
  },
  {
    id: 'startpage',
    name: 'Startpage',
    region: 'global',
    template: 'https://www.startpage.com/sp/search?query={query}',
    homepage: 'https://www.startpage.com/',
    intentTags: ['privacy'],
    status: 'stable',
  },
]

const ENGINE_MAP = new Map(ENGINES.map((engine) => [engine.id, engine]))
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 30
const MAX_PAGE_CHARS = 12000
const SEARCH_SOURCES_CONFIG_FILE = 'search-sources-config.json'

type SearchSourcesConfig = {
  disabledSourceKeys: string[]
  updatedAt: number
}

type SearchEngineInfo = {
  id: string
  name: string
  region: SearchRegion
  status: SearchEngineStatus
  statusReason: string | null
  supportsTime: boolean
  intents: string[]
  enabled: boolean
}

type SetSearchSourceEnabledInput = {
  family: SearchSourceFamily
  id: string
  enabled: boolean
}

const SEARCH_SOURCE_FAMILIES: SearchSourceFamily[] = ['web-search', 'skill-marketplace', 'uapis']
const SKILL_MARKETPLACE_SOURCE_IDS = new Set(['skills-sh', 'github-archive'])

function makeSourceKey(family: SearchSourceFamily, id: string) {
  return `${family}:${id}`
}

function defaultSearchSourcesConfig(): SearchSourcesConfig {
  return {
    disabledSourceKeys: [],
    updatedAt: Date.now(),
  }
}

function normalizeSearchSourcesConfig(
  input: Partial<SearchSourcesConfig> | undefined,
): SearchSourcesConfig {
  return {
    disabledSourceKeys: Array.isArray(input?.disabledSourceKeys)
      ? [...new Set(input.disabledSourceKeys.filter((item): item is string => typeof item === 'string'))]
      : [],
    updatedAt:
      typeof input?.updatedAt === 'number' && Number.isFinite(input.updatedAt)
        ? input.updatedAt
        : Date.now(),
  }
}

async function readSearchSourcesConfig() {
  return normalizeSearchSourcesConfig(
    await readJson<Partial<SearchSourcesConfig>>(SEARCH_SOURCES_CONFIG_FILE, defaultSearchSourcesConfig()),
  )
}

async function writeSearchSourcesConfig(next: SearchSourcesConfig) {
  await writeJson(
    SEARCH_SOURCES_CONFIG_FILE,
    normalizeSearchSourcesConfig({
      ...next,
      updatedAt: Date.now(),
    }),
  )
}

function isSourceEnabled(config: SearchSourcesConfig, family: SearchSourceFamily, id: string) {
  return !config.disabledSourceKeys.includes(makeSourceKey(family, id))
}

function withDisabledStatus(
  status: SearchEngineStatus,
  statusReason: string | undefined,
  enabled: boolean,
) {
  if (enabled) {
    return {
      status,
      statusReason: statusReason ?? null,
    }
  }

  return {
    status: 'pass' as const,
    statusReason: 'This source is currently disabled and will not be used by the agent.',
  }
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

function stripHtml(value: string) {
  return normalizeText(
    decodeHtml(
      value
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, ' '),
    ),
  )
}

function looksBlocked(html: string) {
  return /百度安全验证|confirm you['’]?re not a robot|enable javascript and cookies to continue|firewall|captcha|验证/i.test(
    html,
  )
}

function isChineseQuery(query: string) {
  return /[\u3400-\u9fff]/.test(query)
}

function inferIntent(query: string): SearchIntent {
  const lower = query.toLowerCase()
  if (/公众号|微信|weixin|wechat/.test(lower)) return 'wechat'
  if (/integrate|solve|stock|weather|population|汇率|换算|公式|方程|数学/.test(lower)) {
    return 'knowledge'
  }
  if (/paper|scholar|学术|论文|arxiv/.test(lower)) return 'academic'
  if (/privacy|匿名|隐私|追踪/.test(lower)) return 'privacy'
  if (/news|新闻|快讯|headlines/.test(lower)) return 'news'
  if (/github|stack overflow|stackoverflow|npm|pypi|文档|docs|api|框架|库/.test(lower)) {
    return 'development'
  }
  return 'general'
}

function buildSearchQuery(input: SearchRequest) {
  const parts = [input.query.trim()]
  if (typeof input.site === 'string' && input.site.trim()) {
    parts.push(`site:${input.site.trim()}`)
  }
  if (typeof input.filetype === 'string' && input.filetype.trim()) {
    parts.push(`filetype:${input.filetype.trim()}`)
  }
  return parts.join(' ')
}

function buildSearchUrl(engine: SearchEngine, query: string, time?: SearchTime) {
  const url = new URL(engine.template.replace('{query}', encodeURIComponent(query)))
  if (!time) return url.toString()

  if ((engine.id === 'bing-cn' || engine.id === 'bing-int') && engine.supportsTime) {
    const mapping: Record<SearchTime, string> = {
      hour: 'ez1',
      day: 'ez2',
      week: 'ez3',
      month: 'ez5',
      year: 'ez6',
    }
    url.searchParams.set('filters', `ex1:"${mapping[time]}"`)
  } else if (engine.id === 'startpage') {
    const mapping: Record<SearchTime, string> = {
      hour: 'day',
      day: 'day',
      week: 'week',
      month: 'month',
      year: 'year',
    }
    url.searchParams.set('time', mapping[time])
  }

  return url.toString()
}

function resolveResultUrl(rawUrl: string) {
  const value = decodeHtml(rawUrl.trim())
  if (!value) return ''

  const absolute = value.startsWith('//') ? `https:${value}` : value
  try {
    const parsed = new URL(absolute)
    const uddg = parsed.searchParams.get('uddg')
    if (uddg) return decodeURIComponent(uddg)
    const encodedTarget = parsed.searchParams.get('u')
    if (encodedTarget) {
      const normalized = encodedTarget.startsWith('a1') ? encodedTarget.slice(2) : encodedTarget
      try {
        const decoded = Buffer.from(normalized, 'base64').toString('utf-8')
        if (/^https?:\/\//i.test(decoded)) return decoded
      } catch {}
    }
    const target = parsed.searchParams.get('target') ?? parsed.searchParams.get('url')
    if (target) return decodeURIComponent(target)
    return /^https?:\/\//i.test(parsed.toString()) ? parsed.toString() : ''
  } catch {
    return /^https?:\/\//i.test(absolute) ? absolute : ''
  }
}

function resolveRelativeUrl(rawUrl: string, base: string) {
  const value = decodeHtml(rawUrl.trim())
  if (!value) return ''
  try {
    return new URL(value, base).toString()
  } catch {
    return ''
  }
}

function normalizeResultUrl(url: string) {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|spm|from|source|ref|ei|ved|sa|gs_|oq|aqs|sxsrf)/i.test(key)) {
        parsed.searchParams.delete(key)
      }
    }
    return parsed.toString()
  } catch {
    return url
  }
}

function parseAnchorResults(html: string, engine: SearchEngine) {
  const matches = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
  const items: RawSearchItem[] = []
  const seen = new Set<string>()

  for (const match of matches) {
    const href = resolveResultUrl(match[1] ?? '')
    const title = stripHtml(match[2] ?? '')
    if (!href || !title) continue
    if (!/^https?:\/\//i.test(href)) continue
    if (/google|bing|baidu|duckduckgo|brave|startpage|search\.yahoo|sogou|so\.com|sm\.cn|qwant|ecosia/i.test(href)) {
      continue
    }
    const normalizedUrl = normalizeResultUrl(href)
    if (seen.has(normalizedUrl)) continue
    seen.add(normalizedUrl)

    const contextStart = Math.max(0, match.index ?? 0)
    const context = html.slice(contextStart, contextStart + 1200)
    const snippet = stripHtml(context).replace(title, '').slice(0, 220).trim()

    items.push({
      title,
      url: href,
      snippet,
      engine: engine.name,
      engineId: engine.id,
    })
  }

  return items
}

function parseRelativeAnchorResults(
  html: string,
  engine: SearchEngine,
  options: {
    baseUrl: string
    allowHref: (href: string) => boolean
    allowResolvedUrl?: (url: string) => boolean
    resolveUrl?: (href: string) => string
    resolveResult?: (href: string, resolvedHref: string) => string
  },
) {
  const matches = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
  const items: RawSearchItem[] = []
  const seen = new Set<string>()

  for (const match of matches) {
    const rawHref = decodeHtml(match[1] ?? '').trim()
    if (!rawHref || !options.allowHref(rawHref)) continue
    const resolvedHref = options.resolveUrl
      ? options.resolveUrl(rawHref)
      : /^https?:\/\//i.test(rawHref)
        ? rawHref
        : resolveRelativeUrl(rawHref, options.baseUrl)
    const url = options.resolveResult ? options.resolveResult(rawHref, resolvedHref) : resolveResultUrl(resolvedHref)
    const title = stripHtml(match[2] ?? '')
    if (!url || !/^https?:\/\//i.test(url) || !title || title.length < 2) continue
    if (options.allowResolvedUrl && !options.allowResolvedUrl(url)) continue
    const normalizedUrl = normalizeResultUrl(url)
    if (seen.has(normalizedUrl)) continue
    seen.add(normalizedUrl)

    const contextStart = Math.max(0, match.index ?? 0)
    const context = html.slice(contextStart, contextStart + 1400)
    const snippet = stripHtml(context).replace(title, '').slice(0, 220).trim()

    items.push({
      title,
      url,
      snippet,
      engine: engine.name,
      engineId: engine.id,
    })
  }

  return items
}

function parseSearchResults(html: string, engine: SearchEngine) {
  const items: RawSearchItem[] = []
  const seen = new Set<string>()

  const push = (url: string, title: string, snippet: string) => {
    if (!/^https?:\/\//i.test(url)) return
    const normalizedUrl = normalizeResultUrl(url)
    if (!url || !title || seen.has(normalizedUrl)) return
    seen.add(normalizedUrl)
    items.push({
      title,
      url,
      snippet,
      engine: engine.name,
      engineId: engine.id,
    })
  }

  if (engine.id === 'bing-cn' || engine.id === 'bing-int') {
    for (const match of html.matchAll(
      /<li class="b_algo"[\s\S]*?<h2><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p>([\s\S]*?)<\/p>)?/gi,
    )) {
      push(resolveResultUrl(match[1] ?? ''), stripHtml(match[2] ?? ''), stripHtml(match[3] ?? ''))
    }
    if (items.length > 0) return items
  }

  if (engine.id === 'duckduckgo') {
    for (const match of html.matchAll(
      /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>)?/gi,
    )) {
      push(
        resolveResultUrl(match[1] ?? ''),
        stripHtml(match[2] ?? ''),
        stripHtml(match[3] ?? match[4] ?? ''),
      )
    }
    if (items.length > 0) return items
  }

  if (engine.id === 'wechat') {
    for (const match of html.matchAll(
      /<li[^>]*id="sogou_vr_11002601_box_\d+"[\s\S]*?<h3>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<p class="txt-info"[^>]*>([\s\S]*?)<\/p>[\s\S]*?<div class="s-p">[\s\S]*?<span class="all-time-y2">([\s\S]*?)<\/span>/gi,
    )) {
      const url = resolveRelativeUrl(match[1] ?? '', 'https://wx.sogou.com')
      const source = stripHtml(match[4] ?? '')
      const snippetBody = stripHtml(match[3] ?? '')
      push(url, stripHtml(match[2] ?? ''), source ? `${source} | ${snippetBody}` : snippetBody)
    }
    if (items.length > 0) return items
  }

  if (engine.id === 'sogou-web') {
    const sogouItems = parseRelativeAnchorResults(html, engine, {
      baseUrl: 'https://www.sogou.com',
      allowHref: (href) => href.startsWith('/link?url=') || /^https?:\/\//i.test(href),
      resolveResult: (href, resolvedHref) =>
        /^https?:\/\//i.test(href) && !/https?:\/\/(?:[^/]+\.)?sogou\.com\//i.test(href) ? href : resolvedHref,
      allowResolvedUrl: (url) => !/https?:\/\/(?:[^/]+\.)?sogou\.com\//i.test(url),
    })
    if (sogouItems.length > 0) return sogouItems
  }

  return parseAnchorResults(html, engine)
}

function extractClientRedirectUrl(html: string) {
  const replaceMatch = html.match(/window\.location(?:\.href)?\.replace\((["'])(.*?)\1\)/i)
  if (replaceMatch?.[2]) return decodeHtml(replaceMatch[2])
  const assignMatch = html.match(/window\.location(?:\.href)?\s*=\s*(["'])(.*?)\1/i)
  if (assignMatch?.[2]) return decodeHtml(assignMatch[2])
  const metaMatch = html.match(/<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']/i)
  if (metaMatch?.[1]) return decodeHtml(metaMatch[1].replace(/^['"]|['"]$/g, ''))
  return ''
}

async function finalizeEngineItems(engine: SearchEngine, items: RawSearchItem[]) {
  if (engine.id !== 'sogou-web') return items

  const resolved = await Promise.all(
    items.map(async (item) => {
      const isSogouRedirect = /^https?:\/\/(?:[^/]+\.)?sogou\.com\/link\?/i.test(item.url)
      if (!isSogouRedirect) return item
      try {
        const { text } = await fetchText(item.url, engine.homepage)
        const redirectUrl = extractClientRedirectUrl(text)
        if (!redirectUrl || !/^https?:\/\//i.test(redirectUrl)) return item
        return {
          ...item,
          url: redirectUrl,
        }
      } catch {
        return item
      }
    }),
  )

  return resolved
}

async function fetchText(url: string, referer?: string) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
        referer: referer ?? url,
      },
    })

    if (!response.ok) {
      throw new HttpError(response.status, `请求失败: ${response.status} ${response.statusText}`)
    }

    return {
      finalUrl: response.url,
      text: await response.text(),
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new HttpError(504, '请求超时')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function searchOneEngine(
  engine: SearchEngine,
  query: string,
  time: SearchTime | undefined,
  limit: number,
) {
  const url = buildSearchUrl(engine, query, time)
  let lastError: unknown

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { text } = await fetchText(url, engine.homepage)
      if (looksBlocked(text)) {
        throw new HttpError(429, '搜索引擎返回了验证或拦截页面')
      }
      const items = await finalizeEngineItems(engine, parseSearchResults(text, engine).slice(0, limit))
      if (items.length === 0) {
        throw new HttpError(422, '没有解析出稳定结果')
      }
      return items
    } catch (error) {
      lastError = error
      if (attempt === 0) {
        await sleep(RETRY_DELAY_MS)
        continue
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('搜索失败')
}

async function listEnabledSearchEngines() {
  const config = await readSearchSourcesConfig()
  return ENGINES.filter((engine) => isSourceEnabled(config, 'web-search', engine.id))
}

async function chooseEngines(input: SearchRequest, intent: SearchIntent) {
  const enabledEngines = await listEnabledSearchEngines()

  if (Array.isArray(input.engines) && input.engines.length > 0) {
    const selected = input.engines
      .map((id) => enabledEngines.find((engine) => engine.id === String(id).trim()))
      .filter((engine): engine is SearchEngine => Boolean(engine))
    if (selected.length === 0) {
      throw new HttpError(400, 'No enabled search engine matched the requested engine ids.')
    }
    return selected
  }

  const region =
    input.region && input.region !== 'auto'
      ? input.region
      : isChineseQuery(input.query)
        ? 'cn'
        : 'global'

  const byIntent = enabledEngines.filter(
    (engine) =>
      engine.region === region &&
      (!engine.intentTags || engine.intentTags.includes(intent) || intent === 'general'),
  )

  const picked = byIntent.slice(0, 5)
  if (picked.length > 0) return picked

  const byRegion = enabledEngines.filter((engine) => engine.region === region).slice(0, 5)
  if (byRegion.length > 0) return byRegion

  throw new HttpError(400, 'No enabled search engine is currently available for this request.')
}

function aggregateAndRank(items: RawSearchItem[], limit: number): SearchItem[] {
  const merged = new Map<
    string,
    {
      title: string
      url: string
      snippet: string
      matchedBy: string[]
      primaryEngine: string
      primaryEngineId: string
    }
  >()

  for (const item of items) {
    const key = normalizeResultUrl(item.url)
    const current = merged.get(key)
    if (!current) {
      merged.set(key, {
        title: item.title,
        url: item.url,
        snippet: item.snippet,
        matchedBy: [item.engine],
        primaryEngine: item.engine,
        primaryEngineId: item.engineId,
      })
      continue
    }

    if (!current.matchedBy.includes(item.engine)) {
      current.matchedBy.push(item.engine)
    }
    if (!current.snippet && item.snippet) current.snippet = item.snippet
    if (item.title.length > current.title.length) current.title = item.title
  }

  return [...merged.values()]
    .map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.snippet,
      engine: item.primaryEngine,
      engineId: item.primaryEngineId,
      matchedBy: item.matchedBy,
      score: item.matchedBy.length * 100 + Math.min(item.snippet.length, 80),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

export async function listSearchEngines(): Promise<SearchEngineInfo[]> {
  const config = await readSearchSourcesConfig()
  return ENGINES.map((engine) => {
    const enabled = isSourceEnabled(config, 'web-search', engine.id)
    const state = withDisabledStatus(engine.status, engine.statusReason, enabled)
    return {
      id: engine.id,
      name: engine.name,
      region: engine.region,
      status: state.status,
      statusReason: state.statusReason,
      supportsTime: engine.supportsTime === true,
      intents: engine.intentTags ?? [],
      enabled,
    }
  })
}

export async function listSearchSourceGroups(): Promise<SearchSourceGroup[]> {
  const [config, engines, uapisCatalog] = await Promise.all([
    readSearchSourcesConfig(),
    listSearchEngines(),
    getUapisCatalog(),
  ])

  const webSearchItems: SearchSourceInfo[] = engines.map((engine) => ({
    id: engine.id,
    name: engine.name,
    family: 'web-search',
    kind: 'engine',
    status: engine.status,
    statusReason: engine.statusReason,
    enabled: engine.enabled,
    homepage: ENGINE_MAP.get(engine.id)?.homepage ?? '',
    region: engine.region,
    supportsTime: engine.supportsTime,
    intents: engine.intents,
    tags: ['Web Search', engine.region === 'cn' ? 'Chinese' : 'Global'],
  }))

  const skillMarketplaceItems: SearchSourceInfo[] = [
    {
      id: 'skills-sh',
      name: 'skills.sh',
      family: 'skill-marketplace',
      kind: 'marketplace',
      ...withDisabledStatus(
        'stable',
        'Used by the Skill Center for public skill discovery.',
        isSourceEnabled(config, 'skill-marketplace', 'skills-sh'),
      ),
      enabled: isSourceEnabled(config, 'skill-marketplace', 'skills-sh'),
      homepage: SKILL_MARKETPLACE_HOME,
      region: 'shared',
      supportsTime: false,
      intents: ['skills', 'marketplace', 'discovery'],
      tags: ['Skill Market', 'Discovery'],
    },
    {
      id: 'github-archive',
      name: 'GitHub Archive',
      family: 'skill-marketplace',
      kind: 'repository',
      ...withDisabledStatus(
        'stable',
        'Used by the Skill Center to preview and install repository-based skills.',
        isSourceEnabled(config, 'skill-marketplace', 'github-archive'),
      ),
      enabled: isSourceEnabled(config, 'skill-marketplace', 'github-archive'),
      homepage: GITHUB_HOME,
      region: 'shared',
      supportsTime: false,
      intents: ['skills', 'preview', 'install'],
      tags: ['Repository', 'Preview', 'Install'],
    },
  ]

  const uapisItems: SearchSourceInfo[] = uapisCatalog.apis
    .filter((api) => api.categoryId === 'search')
    .map((api) => ({
      id: api.id,
      name: api.name,
      family: 'uapis' as const,
      kind: 'api' as const,
      status: api.enabled ? ('stable' as const) : ('pass' as const),
      statusReason: api.enabled
        ? 'This UAPIs search API is enabled and available to the agent.'
        : 'This UAPIs search API is disabled and will not be used by the agent.',
      enabled: api.enabled,
      homepage: uapisCatalog.provider.home,
      region: 'shared' as const,
      supportsTime: false,
      intents: ['uapis', 'search', 'aggregate'],
      tags: [
        'UAPIs',
        'Search API',
        uapisCatalog.provider.apiKeyMode === 'api-key' ? 'API Key Mode' : 'Free IP Quota',
      ],
    }))

  return [
    {
      id: 'web-search',
      title: '联网搜索源',
      description: '这些来源会直接参与 Agent 的网页搜索与结果聚合。',
      items: webSearchItems,
    },
    {
      id: 'skill-marketplace',
      title: 'Skill 市场与安装源',
      description: '这些来源服务于 Skill 中心的搜索、预览和安装流程。',
      items: skillMarketplaceItems,
    },
    {
      id: 'uapis',
      title: 'UAPIs 搜索接口',
      description: '这些来源来自 UAPIs 工具箱，适合优先用于更聚焦的搜索请求。',
      items: uapisItems,
    },
  ]
}

export async function setSearchSourceEnabled(input: SetSearchSourceEnabledInput) {
  const family = SEARCH_SOURCE_FAMILIES.find((item) => item === input.family)
  if (!family) throw new HttpError(400, 'Invalid search source family.')

  const id = typeof input.id === 'string' ? input.id.trim() : ''
  if (!id) throw new HttpError(400, 'Search source id is required.')
  if (typeof input.enabled !== 'boolean') {
    throw new HttpError(400, 'enabled must be boolean')
  }

  if (family === 'uapis') {
    await setUapisApiEnabled(id, { enabled: input.enabled })
    const groups = await listSearchSourceGroups()
    const source = groups.flatMap((group) => group.items).find((item) => item.family === family && item.id === id)
    if (!source) throw new HttpError(404, 'Search source not found.')
    return source
  }

  if (family === 'web-search' && !ENGINE_MAP.has(id)) {
    throw new HttpError(404, 'Search engine not found.')
  }

  if (family === 'skill-marketplace' && !SKILL_MARKETPLACE_SOURCE_IDS.has(id)) {
    throw new HttpError(404, 'Skill marketplace source not found.')
  }

  const current = await readSearchSourcesConfig()
  const disabled = new Set(current.disabledSourceKeys)
  const key = makeSourceKey(family, id)
  if (input.enabled) disabled.delete(key)
  else disabled.add(key)

  await writeSearchSourcesConfig({
    disabledSourceKeys: [...disabled].sort(),
    updatedAt: Date.now(),
  })

  const groups = await listSearchSourceGroups()
  const source = groups.flatMap((group) => group.items).find((item) => item.family === family && item.id === id)
  if (!source) throw new HttpError(404, 'Search source not found.')
  return source
}

export async function aggregateSearch(input: SearchRequest): Promise<SearchResponse> {
  const query = typeof input.query === 'string' ? input.query.trim() : ''
  if (!query) {
    throw new HttpError(400, 'query 不能为空')
  }

  const limit =
    typeof input.limit === 'number' && Number.isFinite(input.limit)
      ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(input.limit)))
      : DEFAULT_LIMIT
  const intent = input.intent ?? inferIntent(query)
  const selectedEngines = await chooseEngines(input, intent)
  const searchQuery = buildSearchQuery(input)
  const usedDefaultStableSet = !Array.isArray(input.engines) || input.engines.length === 0
  const rawResults: RawSearchItem[] = []
  const succeededEngines: string[] = []
  const failedEngines: { engine: string; error: string }[] = []
  const perEngineLimit = Math.max(4, Math.ceil(limit / Math.max(1, selectedEngines.length)) + 2)

  for (const engine of selectedEngines) {
    try {
      const items = await searchOneEngine(engine, searchQuery, input.time, perEngineLimit)
      if (items.length > 0) {
        succeededEngines.push(engine.name)
        rawResults.push(...items)
      }
    } catch (error) {
      failedEngines.push({
        engine: engine.name,
        error: error instanceof Error ? error.message : '搜索失败',
      })
    }
  }

  return {
    query,
    searchQuery,
    intent,
    usedDefaultStableSet,
    selectedEngines: selectedEngines.map((engine) => ({
      id: engine.id,
      name: engine.name,
      region: engine.region,
    })),
    succeededEngines,
    failedEngines,
    results: aggregateAndRank(rawResults, limit),
  }
}

export async function readWebPage(url: string, maxChars = MAX_PAGE_CHARS): Promise<WebPageResponse> {
  const normalizedUrl = typeof url === 'string' ? url.trim() : ''
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    throw new HttpError(400, 'url 必须是 http 或 https 链接')
  }

  const { text: html, finalUrl } = await fetchText(normalizedUrl)
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = stripHtml(titleMatch?.[1] ?? '') || finalUrl
  const body = stripHtml(html).slice(0, Math.max(500, Math.min(50000, maxChars)))

  return {
    url: normalizedUrl,
    finalUrl,
    title,
    text: body,
    excerpt: body.slice(0, 400),
  }
}
