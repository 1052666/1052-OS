const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9._-]{12,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._=-]{12,}\b/gi,
  /\b(password|passwd|pwd)\s*=\s*[^&\s]+/gi,
  /\b([A-Za-z][A-Za-z0-9+.-]*):\/\/[^/\s:@]+:[^/\s@]+@/g,
]

export function redactSensitiveText(input: string) {
  let next = input
  for (const pattern of SECRET_PATTERNS) {
    next = next.replace(pattern, (match) => {
      if (pattern.source.includes('://')) {
        return match.replace(/\/\/([^:/\s]+):([^@/\s]+)@/, '//[REDACTED]:[REDACTED]@')
      }
      if (/^Bearer /i.test(match)) return 'Bearer [REDACTED]'
      if (/password|passwd|pwd/i.test(match)) {
        const [key] = match.split('=')
        return `${key}=[REDACTED]`
      }
      return '[REDACTED]'
    })
  }
  return next
}

export function looksSensitive(input: string) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(input))
}
