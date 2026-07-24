export function unwrapMarkdownDocumentFence(text: string) {
  const normalized = text.trim()
  const match = normalized.match(/^```(?:markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i)
  return match?.[1]?.trim() ?? text
}
