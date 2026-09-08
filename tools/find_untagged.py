"""Report visible text in the frontend HTML that carries no data-i18n tag.

A companion to check_i18n.py: that script proves every key referenced exists,
this one proves nothing visible was missed. Run from the project root:

    python tools/find_untagged.py
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(ROOT, 'frontend')

PAGES = ['dashboard', 'students', 'attendance', 'reports', 'settings', 'login']

# Text that is not copy: symbols, numbers, HTML entities, the doctype, and the
# {placeholder} tokens the message editor offers as click-to-insert chips —
# those are literal template syntax and must read the same in both languages.
IGNORE = re.compile(r'^(?:[\W\d_]+'
                    r'|&\w+;|&#\d+;'
                    r'|[\W\d_]*(?:&\w+;|&#\d+;)[\W\d_]*'
                    r'|!DOCTYPE\s+html>'
                    r'|\{[a-z_]+\})$', re.I)
SCRIPTY = re.compile(r'<(script|style)\b.*?</\1>', re.S | re.I)
COMMENT = re.compile(r'<!--.*?-->', re.S)
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
        'meta', 'param', 'source', 'track', 'wbr'}


def visible_runs(html):
    """Yield (line_no, text, tag_name, covered) for each run of text between tags.

    `covered` is True when the run sits inside an element carrying data-i18n or
    data-i18n-html — the whole subtree of a data-i18n-html element is replaced
    wholesale, so nested <b>/<a>/<code> inside one needs no tag of its own.
    """
    # Blank out scripts, styles and comments while keeping line numbers intact.
    def blank(match):
        return re.sub(r'[^\n]', ' ', match.group(0))
    html = COMMENT.sub(blank, SCRIPTY.sub(blank, html))

    # Stack of (tag_name, is_i18n_root) for every element currently open.
    stack = []
    for match in re.finditer(r'<(/?)([A-Za-z][\w-]*)([^>]*?)(/?)>|([^<]+)', html):
        closing, name, attrs, selfclose, text = match.groups()
        if text is not None:
            if text.strip():
                line = html.count('\n', 0, match.start(5)) + 1
                covered = any(flag for _, flag in stack)
                tagname = stack[-1][0] if stack else '(root)'
                yield line, text.strip(), tagname, covered
            continue
        name = name.lower()
        if closing:
            # Pop back to the matching open tag; unclosed voids just disappear.
            for i in range(len(stack) - 1, -1, -1):
                if stack[i][0] == name:
                    del stack[i:]
                    break
        elif not selfclose and name not in VOID:
            stack.append((name, 'data-i18n' in attrs))


def main():
    problems = 0
    for page in PAGES:
        path = os.path.join(FRONTEND, '%s.html' % page)
        if not os.path.exists(path):
            continue
        html = io.open(path, encoding='utf-8').read()
        hits = []
        for line, text, tagname, covered in visible_runs(html):
            if covered or IGNORE.match(text):
                continue
            hits.append((line, text, tagname))
        print('%-11s %d untagged run(s)' % (page, len(hits)))
        for line, text, tagname in hits:
            problems += 1
            snippet = ' '.join(text.split())
            if len(snippet) > 70:
                snippet = snippet[:67] + '...'
            print('   %s.html:%-4d <%s>  %s' % (page, line, tagname, snippet))
    print()
    print('%d untagged run(s) total.' % problems)
    return 0


if __name__ == '__main__':
    sys.exit(main())
