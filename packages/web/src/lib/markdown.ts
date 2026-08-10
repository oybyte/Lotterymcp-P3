// 轻量、无依赖的 Markdown 渲染器，覆盖本项目日报实际使用的语法子集
// （标题、无序/有序列表、分隔线、段落、行内 code/bold/italic/链接、GFM 表格）。
// 文本先经 escapeHtml，因此内容中的 < > & 不会被当作 HTML 解释，可安全用于 dangerouslySetInnerHTML。

export const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const renderInline = (text: string) => {
  let out = escapeHtml(text)
  out = out.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`)
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, rawUrl) => {
    const url = String(rawUrl)
    const safe = /^(https?:\/\/|\/|#)/.test(url) ? url : '#'
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`
  })
  return out
}

export const renderMarkdown = (markdown: string): string => {
  const lines = markdown.split('\n')
  const html: string[] = []
  let listTag: 'ul' | 'ol' | null = null
  const closeList = () => {
    if (listTag) {
      html.push(`</${listTag}>`)
      listTag = null
    }
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i].replace(/\s+$/, '')
    if (line.trim() === '') {
      closeList()
      i += 1
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      closeList()
      const level = heading[1].length
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`)
      i += 1
      continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      closeList()
      html.push('<hr/>')
      i += 1
      continue
    }
    if (line.startsWith('|')) {
      const block: string[] = [line]
      let j = i + 1
      while (j < lines.length && lines[j].trim().startsWith('|')) {
        block.push(lines[j].trim())
        j += 1
      }
      const separator = block[1]
      const isTable = !!separator && /^\|[\s:|-]+\|$/.test(separator) && separator.replace(/[^|-]/g, '').includes('-')
      if (isTable) {
        closeList()
        const parseRow = (row: string) =>
          row
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((cell) => cell.trim())
        const header = parseRow(block[0])
        const rows = block.slice(2).map(parseRow)
        html.push(
          '<table><thead><tr>' +
            header.map((cell) => `<th>${renderInline(cell)}</th>`).join('') +
            '</tr></thead><tbody>' +
            rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`).join('') +
            '</tbody></table>',
        )
        i = j
        continue
      }
    }
    const unordered = /^[-*]\s+(.*)$/.exec(line)
    if (unordered) {
      if (listTag !== 'ul') {
        closeList()
        html.push('<ul>')
        listTag = 'ul'
      }
      html.push(`<li>${renderInline(unordered[1])}</li>`)
      i += 1
      continue
    }
    const ordered = /^\d+\.\s+(.*)$/.exec(line)
    if (ordered) {
      if (listTag !== 'ol') {
        closeList()
        html.push('<ol>')
        listTag = 'ol'
      }
      html.push(`<li>${renderInline(ordered[1])}</li>`)
      i += 1
      continue
    }
    closeList()
    html.push(`<p>${renderInline(line)}</p>`)
    i += 1
  }
  closeList()
  return html.join('\n')
}
