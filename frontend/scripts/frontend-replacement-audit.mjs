import fs from 'node:fs'
import path from 'node:path'

const cwd = process.cwd()
const root = path.basename(cwd) === 'frontend' ? path.dirname(cwd) : cwd
const frontend = path.join(root, 'frontend')

const failures = []
const details = []

function rel(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

function exists(file) {
  return fs.existsSync(file)
}

function read(file) {
  return fs.readFileSync(file, 'utf8')
}

function check(name, ok, detail = '') {
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
  else details.push(name)
}

function walk(target) {
  if (!exists(target)) return []
  const stat = fs.statSync(target)
  if (stat.isFile()) return [target]
  const output = []
  const ignored = new Set(['node_modules', 'dist', 'test-results', '.git'])
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const next = path.join(target, entry.name)
    if (entry.isDirectory()) output.push(...walk(next))
    else output.push(next)
  }
  return output
}

function apiPrefix(value) {
  return value.split('/').slice(0, 3).join('/')
}

function collectBackendApiPrefixes() {
  const app = read(path.join(root, 'backend', 'src', 'app.ts'))
  const prefixes = new Set()
  for (const match of app.matchAll(/app\.(?:use|get)\(\s*['"]([^'"]+)/gs)) {
    const route = match[1]
    if (route.startsWith('/api/')) prefixes.add(apiPrefix(route))
  }
  return prefixes
}

function collectFrontendApiPrefixes() {
  const sourceFiles = [
    path.join(frontend, 'src', 'data', 'api.ts'),
    path.join(frontend, 'src', 'runtime', 'runtime.ts'),
    path.join(frontend, 'src', 'pages', 'ChatPage.tsx'),
    path.join(frontend, 'src', 'app', 'AppErrorBoundary.tsx'),
  ]
  const prefixes = new Set()
  const source = sourceFiles.map(read).join('\n')
  for (const match of source.matchAll(/['"`]\/api([^'"`$]*)['"`]/g)) {
    prefixes.add(apiPrefix(`/api${match[1]}`))
  }
  for (const match of source.matchAll(/(?:request|upload)\(\s*['`]([^'`$]+)/g)) {
    prefixes.add(apiPrefix(`/api${match[1]}`))
  }
  return prefixes
}

const absentPaths = [
  path.join(root, 'frontend-next'),
  path.join(frontend, 'src', 'api'),
  path.join(frontend, 'src', 'mirror'),
  path.join(frontend, 'src', 'styles.css'),
  path.join(frontend, 'src', 'mirror-theme.css'),
  path.join(frontend, 'src', 'theme.ts'),
  path.join(frontend, 'src', 'theme-context.tsx'),
  path.join(frontend, 'e2e', 'baseline'),
  path.join(frontend, 'e2e', 'classic-regression.spec.ts'),
  path.join(frontend, 'e2e', 'mirror-a11y.spec.ts'),
  path.join(frontend, 'e2e', 'mirror-visual.spec.ts'),
  path.join(root, 'assets', 'readme', 'hero.svg'),
  path.join(root, 'assets', 'readme', 'preview-chat.svg'),
  path.join(root, 'assets', 'readme', 'preview-files.svg'),
  path.join(root, 'assets', 'readme', 'preview-search.svg'),
  path.join(root, 'assets', 'readme', 'preview-schedule.svg'),
]

for (const target of absentPaths) {
  check(`absent ${rel(target)}`, !exists(target))
}

const requiredPaths = [
  path.join(frontend, 'src', 'app'),
  path.join(frontend, 'src', 'components', 'shell'),
  path.join(frontend, 'src', 'components', 'ui'),
  path.join(frontend, 'src', 'contracts'),
  path.join(frontend, 'src', 'data'),
  path.join(frontend, 'src', 'features'),
  path.join(frontend, 'src', 'runtime'),
  path.join(frontend, 'src', 'state'),
  path.join(frontend, 'src', 'styles'),
  path.join(frontend, 'scripts', 'interaction-smoke.mjs'),
  path.join(frontend, 'scripts', 'visual-smoke.mjs'),
  path.join(frontend, 'scripts', 'readme-screenshots.mjs'),
  path.join(frontend, 'scripts', 'live-backend-smoke.mjs'),
  path.join(frontend, 'scripts', 'production-smoke.mjs'),
  path.join(frontend, 'e2e', 'smoke.spec.ts'),
  path.join(root, 'assets', 'readme', 'hero.png'),
  path.join(root, 'assets', 'readme', 'preview-today.png'),
  path.join(root, 'assets', 'readme', 'preview-chat.png'),
  path.join(root, 'assets', 'readme', 'preview-workspace.png'),
  path.join(root, 'assets', 'readme', 'preview-automations.png'),
]

for (const target of requiredPaths) {
  check(`present ${rel(target)}`, exists(target))
}

const packageJson = JSON.parse(read(path.join(frontend, 'package.json')))
for (const script of ['build', 'test', 'test:e2e', 'test:e2e:desktop', 'test:e2e:wide', 'test:e2e:mobile', 'test:e2e:webkit', 'test:visual', 'test:interactions', 'test:live-backend', 'test:production', 'docs:screenshots']) {
  check(`package script ${script}`, Boolean(packageJson.scripts?.[script]))
}

const scanFiles = [
  path.join(root, 'README.md'),
  path.join(root, 'README.en.md'),
  path.join(root, 'Dockerfile'),
  path.join(root, 'docker-compose.yml'),
  path.join(root, 'deploy'),
  path.join(frontend, 'index.html'),
  path.join(frontend, 'package.json'),
  path.join(frontend, 'playwright.config.ts'),
  path.join(frontend, 'src'),
  path.join(frontend, 'e2e'),
  path.join(frontend, 'scripts'),
].flatMap(walk)
  .filter((file) => path.basename(file) !== 'frontend-replacement-audit.mjs')

const forbiddenPatterns = [
  [/frontend-next/i, 'frontend-next'],
  [/10054/, 'old preview port 10054'],
  [/mirror-theme/i, 'mirror theme stylesheet'],
  [/ThemeEffectLayer/, 'old theme effect layer'],
  [/MirrorChrome/, 'old mirror shell'],
  [/classic-regression/i, 'old classic regression spec'],
  [/mirror-visual/i, 'old mirror visual spec'],
  [/frontend[\\/]+src[\\/]+api\b/i, 'old frontend src/api path'],
]

for (const file of scanFiles) {
  const content = read(file)
  for (const [pattern, label] of forbiddenPatterns) {
    if (pattern.test(content)) {
      failures.push(`forbidden ${label} in ${rel(file)}`)
    }
  }
}

const dockerfile = read(path.join(root, 'Dockerfile'))
check('Docker builds frontend from frontend/', dockerfile.includes('COPY frontend/package*.json') && dockerfile.includes('COPY frontend/ ./'))
check('Docker copies frontend dist', dockerfile.includes('/app/frontend/dist'))

const compose = read(path.join(root, 'docker-compose.yml'))
check('compose exposes frontend on 10052', compose.includes('"10052:80"') || compose.includes("'10052:80'") || compose.includes('- 10052:80'))

const nginx = read(path.join(root, 'deploy', 'nginx.conf'))
check('nginx proxies API to backend 10053', nginx.includes('proxy_pass http://127.0.0.1:10053'))

const viteConfig = read(path.join(frontend, 'vite.config.ts'))
check('Vite proxy supports BACKEND_URL override', viteConfig.includes('BACKEND_URL') && viteConfig.includes("'/api'") && viteConfig.includes('target: backendTarget'))

const readme = read(path.join(root, 'README.en.md')) + '\n' + read(path.join(root, 'README.md'))
check('README documents frontend verification', readme.includes('npm run test:interactions') && readme.includes('npm run test:visual') && readme.includes('npm run test:e2e'))
check('README documents live backend smoke', readme.includes('npm run test:live-backend') && readme.includes('DATA_DIR'))
check('README documents production smoke', readme.includes('npm run test:production') && readme.includes('frontend `dist`') && readme.includes('/api'))
check('README documents optional WebKit', readme.includes('test:e2e:webkit'))
check('README uses generated PNG screenshots', /assets\/readme\/hero\.png/.test(readme) && /assets\/readme\/preview-today\.png/.test(readme) && !/assets\/readme\/(?:hero|preview-[^"')]+)\.svg/.test(readme))

const ignoredBackendPrefixes = new Set(['/api/generated-images'])
const backendPrefixes = collectBackendApiPrefixes()
const frontendPrefixes = collectFrontendApiPrefixes()
const missingPrefixes = [...backendPrefixes].filter((prefix) => !frontendPrefixes.has(prefix) && !ignoredBackendPrefixes.has(prefix)).sort()
check('frontend API prefixes cover backend app routes', missingPrefixes.length === 0, missingPrefixes.join(', '))

if (failures.length) {
  console.error('frontend replacement audit failed')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('frontend replacement audit passed')
console.log(JSON.stringify({
  checked: details.length,
  ignoredStaticPrefixes: [...ignoredBackendPrefixes].sort(),
  backendApiPrefixes: [...backendPrefixes].sort(),
  frontendApiPrefixes: [...frontendPrefixes].sort(),
}, null, 2))
