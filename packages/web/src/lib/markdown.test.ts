import { describe, it, expect } from 'vitest'
import { escapeHtml, renderMarkdown } from './markdown'

describe('escapeHtml', () => {
  it('转义 < > &', () => {
    expect(escapeHtml('<a> & </a>')).toBe('&lt;a&gt; &amp; &lt;/a&gt;')
  })
})

describe('renderMarkdown 安全（XSS）', () => {
  it('脚本标签被转义而不保留为 HTML 标签', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
  it('危险链接协议被替换为 #', () => {
    const html = renderMarkdown('[x](javascript:alert(1))')
    expect(html).toContain('href="#"')
    expect(html).not.toContain('javascript:')
  })
  it('安全外链保留且带 noopener', () => {
    const html = renderMarkdown('[官网](https://example.com)')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('rel="noopener noreferrer"')
  })
})

describe('renderMarkdown 结构', () => {
  it('渲染标题', () => {
    expect(renderMarkdown('# 标题')).toContain('<h1>标题</h1>')
    expect(renderMarkdown('### 小标题')).toContain('<h3>小标题</h3>')
  })
  it('渲染无序列表并正确闭合', () => {
    const html = renderMarkdown('- a\n- b')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>a</li>')
    expect(html).toContain('<li>b</li>')
    expect(html).toContain('</ul>')
  })
  it('渲染有序列表', () => {
    const html = renderMarkdown('1. a\n2. b')
    expect(html).toContain('<ol>')
    expect(html).toContain('<li>a</li>')
  })
  it('渲染 GFM 表格', () => {
    const md = '| 列1 | 列2 |\n| --- | --- |\n| a | b |'
    const html = renderMarkdown(md)
    expect(html).toContain('<table>')
    expect(html).toContain('<th>列1</th>')
    expect(html).toContain('<td>a</td>')
  })
  it('渲染行内粗体与代码', () => {
    const html = renderMarkdown('**粗** 和 `码`')
    expect(html).toContain('<strong>粗</strong>')
    expect(html).toContain('<code>码</code>')
  })
  it('渲染分隔线', () => {
    expect(renderMarkdown('---')).toContain('<hr/>')
  })
})
