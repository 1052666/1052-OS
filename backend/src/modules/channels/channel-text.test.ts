import { describe, expect, it } from 'vitest'
import { unwrapMarkdownDocumentFence } from './channel-text.js'

describe('channel text normalization', () => {
  it('unwraps a full markdown document fence before channel delivery', () => {
    expect(
      unwrapMarkdownDocumentFence('```markdown\n# 标题\n\n| A | B |\n|---|---|\n| 1 | 2 |\n```'),
    ).toBe('# 标题\n\n| A | B |\n|---|---|\n| 1 | 2 |')
  })

  it('keeps ordinary code blocks inside a larger reply', () => {
    const text = '下面是代码：\n\n```ts\nconsole.log(1)\n```'

    expect(unwrapMarkdownDocumentFence(text)).toBe(text)
  })
})
