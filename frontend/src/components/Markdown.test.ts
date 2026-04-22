import { describe, expect, it } from 'vitest'
import remarkParse from 'remark-parse'
import remarkDirective from 'remark-directive'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import type { Node } from 'unist'

function remarkFixInvalidDirectives() {
  return (tree: Node) => {
    visit(tree, 'textDirective' as any, (node: any, index: any, parent: any) => {
      if (!parent || index == null) return
      const name = String(node.name ?? '')
      if (/^[a-zA-Z_]/.test(name)) return
      let text = ':' + name
      if (Array.isArray(node.children)) {
        const label = node.children.map((c: any) => c.value ?? '').join('')
        if (label) text += '[' + label + ']'
      }
      if (node.attributes && typeof node.attributes === 'object') {
        const attrs = Object.entries(node.attributes as Record<string, string>)
          .map(([k, v]) => k + '="' + String(v) + '"')
          .join(' ')
        if (attrs) text += '{' + attrs + '}'
      }
      parent.children[index] = { type: 'text', value: text }
    })
  }
}

async function process(markdown: string) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkFixInvalidDirectives)
  const tree = processor.parse(markdown)
  return processor.run(tree)
}

function extractText(tree: Node): string {
  const texts: string[] = []
  visit(tree, 'text', (node: any) => {
    texts.push(node.value)
  })
  return texts.join('')
}

function hasNode(tree: Node, type: string): boolean {
  let found = false
  visit(tree, type as any, () => {
    found = true
  })
  return found
}

describe('remarkFixInvalidDirectives', () => {
  it('应将时间格式 4:00 还原为文本', async () => {
    const tree = await process('每天4:00开始运行')
    expect(extractText(tree)).toBe('每天4:00开始运行')
    expect(hasNode(tree, 'textDirective')).toBe(false)
  })

  it('应将时间格式 16:30 还原为文本', async () => {
    const tree = await process('时间：每天 16:30')
    expect(extractText(tree)).toBe('时间：每天 16:30')
  })

  it('应将 9:00 还原为文本', async () => {
    const tree = await process('从9:00到18:00')
    expect(extractText(tree)).toBe('从9:00到18:00')
  })

  it('不应影响以字母开头的合法 textDirective', async () => {
    const tree = await process(':red[文本]')
    expect(hasNode(tree, 'textDirective')).toBe(true)
  })

  it('不应影响以字母开头的 textDirective（无内容）', async () => {
    const tree = await process(':abc')
    expect(hasNode(tree, 'textDirective')).toBe(true)
  })

  it('不应影响以字母开头的 textDirective（带属性）', async () => {
    const tree = await process(':tip[提示]{class="note"}')
    expect(hasNode(tree, 'textDirective')).toBe(true)
  })

  it('不应影响容器指令 :::note', async () => {
    const tree = await process(':::note\n内容\n:::')
    expect(hasNode(tree, 'containerDirective')).toBe(true)
  })

  it('应将数字开头带属性的指令还原并保留属性文本', async () => {
    const tree = await process(':00{color="red"}')
    expect(extractText(tree)).toBe(':00{color="red"}')
    expect(hasNode(tree, 'textDirective')).toBe(false)
  })

  it('应将数字开头带内容的指令还原并保留内容', async () => {
    const tree = await process(':30[hello]')
    expect(extractText(tree)).toBe(':30[hello]')
    expect(hasNode(tree, 'textDirective')).toBe(false)
  })

  it('应处理纯数字指令名', async () => {
    const tree = await process(':123')
    expect(extractText(tree)).toBe(':123')
    expect(hasNode(tree, 'textDirective')).toBe(false)
  })
})
