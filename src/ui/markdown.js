// A small Markdown renderer for the rulebook (spec 032). Pure, no DOM.
// Supports headings, paragraphs, nested ordered and unordered lists, tables,
// block quotes, rules, code, bold, italic and links. HTML in the source is
// escaped, and HTML comments are dropped.

import { esc } from './format.js';

function inline(text) {
  let s = esc(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  s = s.replace(/(^|[^_\w])_([^_\s][^_]*)_(?!\w)/g, '$1<i>$2</i>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => (/^(https?:|#|\.{0,2}\/|[\w-]+\.)/.test(href) ? `<a href="${href}">${label}</a>` : label));
  return s;
}

const slug = (t) => t.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

function renderList(lines) {
  // lines: [{ indent, ordered, text }]
  let html = '';
  const stack = [];
  for (const l of lines) {
    while (stack.length && l.indent < stack[stack.length - 1].indent) html += `</li></${stack.pop().tag}>`;
    const top = stack[stack.length - 1];
    if (!top || l.indent > top.indent) {
      const tag = l.ordered ? 'ol' : 'ul';
      stack.push({ indent: l.indent, tag });
      html += `<${tag}><li>`;
    } else {
      html += '</li><li>';
    }
    html += inline(l.text);
  }
  while (stack.length) html += `</li></${stack.pop().tag}>`;
  return html;
}

export function renderMarkdown(src) {
  const lines = String(src).replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*$/))) {
      const level = m[1].length;
      out.push(`<h${level} id="${slug(m[2])}">${inline(m[2])}</h${level}>`);
      i++;
    } else if (/^```/.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('<hr>');
      i++;
    } else if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-+/.test(lines[i + 1])) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : ''));
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      const td = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c)}</${tag}>`;
      out.push(`<table><thead><tr>${head.map((c, k) => td('th', c, k)).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, k) => td('td', c, k)).join('')}</tr>`).join('')}</tbody></table>`);
    } else if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(body.join('\n'))}</blockquote>`);
    } else if (LIST_RE.test(line)) {
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        const lm = l.match(LIST_RE);
        if (lm) {
          items.push({ indent: lm[1].length, ordered: /\d/.test(lm[2]), text: lm[3] });
        } else if (l.trim() && /^\s+/.test(l) && items.length) {
          items[items.length - 1].text += ` ${l.trim()}`;
        } else break;
        i++;
      }
      out.push(renderList(items));
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*>|\s*\|)/.test(lines[i]) && !LIST_RE.test(lines[i])) para.push(lines[i++].trim());
      out.push(`<p>${inline(para.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}
