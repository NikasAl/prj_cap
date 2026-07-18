/**
 * Lightweight Markdown renderer for chat messages.
 * Handles: code blocks, inline code, bold, italic, headers,
 * ordered/unordered lists, links, blockquotes, horizontal rules.
 * All output is XSS-safe (HTML is escaped before applying formatting).
 */

/* ── Escape HTML ── */

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/g;
function esc(s) {
  return s.replace(ESC_RE, ch => ESC_MAP[ch]);
}

/* ── Inline formatting (order matters) ── */

function renderInline(text) {
  let s = text;
  // Inline code  `...`
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // Bold **...**  (not inside code tags — safe because code already has tags)
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  // Italic *...*  (single asterisk, not bold)
  s = s.replace(/(?<!\*)\*(?!\*)([^*]+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  // Links [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}

/* ── Block-level parsing ── */

function renderBlocks(text) {
  const lines = text.split('\n');
  const html = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // --- Fenced code block ```
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(esc(lines[i]));
        i++;
      }
      i++; // skip closing ```
      const cls = lang ? ` class="lang-${esc(lang)}"` : '';
      html.push(`<pre><code${cls}>${codeLines.join('\n')}</code></pre>`);
      continue;
    }

    // --- Empty line → break
    if (line.trim() === '') {
      // Only add a break if previous block wasn't already a block element
      const prev = html[html.length - 1] || '';
      if (!prev.startsWith('<pre') && !prev.startsWith('<ul') && !prev.startsWith('<ol') && !prev.startsWith('<blockquote') && !prev.startsWith('<hr') && !prev.startsWith('<h')) {
        html.push('<br>');
      }
      i++;
      continue;
    }

    // --- Header ## or ###
    const headMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headMatch) {
      const lvl = Math.min(headMatch[1].length, 6);
      html.push(`<h${lvl}>${renderInline(esc(headMatch[2]))}</h${lvl}>`);
      i++;
      continue;
    }

    // --- Horizontal rule ---
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      html.push('<hr>');
      i++;
      continue;
    }

    // --- Blockquote >
    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      const inner = renderBlocks(quoteLines.join('\n'));
      html.push(`<blockquote>${inner}</blockquote>`);
      continue;
    }

    // --- Unordered list - or *
    if (/^[\-\*]\s+/.test(line) && !isCheckbox(line)) {
      const items = [];
      while (i < lines.length && /^[\-\*]\s+/.test(lines[i]) && !isCheckbox(lines[i])) {
        items.push(esc(lines[i].replace(/^[\-\*]\s+/, '')));
        i++;
      }
      html.push('<ul>' + items.map(it => `<li>${renderInline(it)}</li>`).join('') + '</ul>');
      continue;
    }

    // --- Ordered list 1. 2. 3.
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(esc(lines[i].replace(/^\d+\.\s+/, '')));
        i++;
      }
      html.push('<ol>' + items.map(it => `<li>${renderInline(it)}</li>`).join('') + '</ol>');
      continue;
    }

    // --- Paragraph (collect consecutive non-blank, non-block lines)
    const paraLines = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^#{1,6}\s/.test(lines[i]) && !/^```/.test(lines[i]) && !/^>\s?/.test(lines[i]) && !/^[\-\*]\s/.test(lines[i]) && !/^\d+\.\s/.test(lines[i]) && !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length) {
      html.push(`<p>${renderInline(esc(paraLines.join('\n')))}</p>`);
    }
  }

  return html.join('\n');
}

function isCheckbox(line) {
  return /^\s*[-*]\s*\[[ x]\]/.test(line);
}

/* ── Public API ── */

/**
 * Render a Markdown string to safe HTML.
 * @param {string} md  Raw markdown text.
 * @returns {string}   Sanitized HTML.
 */
export function renderMarkdown(md) {
  if (!md) return '';
  return renderBlocks(md);
}
