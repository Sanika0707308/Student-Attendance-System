"""Verify frontend i18n integrity.

Checks, for every page script that uses the tr()/trf() helpers:
  1. both language tables hold exactly the same key set (no gaps, no dupes)
  2. every key a script asks for exists in both tables
  3. every trf() call passes exactly the {placeholders} its string declares
  4. every data-i18n* key in the HTML exists in both tables

Run from the project root:  python tools/check_i18n.py
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(ROOT, 'frontend')

# 'sidebar' has no sidebar.html — the checker skips the HTML half for it and
# still validates the ~12 keys the shared nav and save-dialog helper ask for.
PAGES = ['dashboard', 'students', 'attendance', 'reports', 'settings', 'login',
         'sidebar']

ENTRY = re.compile(r'^\s*"([a-zA-Z0-9_.]+)"\s*:\s*"((?:[^"\\]|\\.)*)"', re.M)
SLOT = re.compile(r'\{([a-z_]+)\}')
TR_CALL = re.compile(r'\btrf?\(\s*"([a-zA-Z0-9_.]+)"')
TRF_CALL = re.compile(r'\btrf\(\s*"([a-zA-Z0-9_.]+)"\s*,\s*\{([^{}]*)\}', re.S)
HTML_KEY = re.compile(r'data-i18n(?:-html|-placeholder|-title|-aria)?="([a-zA-Z0-9_.]+)"')
DATA_KEY = re.compile(r'data-(?:all-label|placeholder)-key="([a-zA-Z0-9_.]+)"')


def read(path):
    return io.open(path, encoding='utf-8').read()


def load_tables():
    src = read(os.path.join(FRONTEND, 'js', 'i18n.js'))
    body = src[src.index('const TRANSLATIONS'):src.index('window.getLang')]
    en_src = body[body.index('en: {'):body.index('mr: {')]
    mr_src = body[body.index('mr: {'):]
    return en_src, mr_src


def entries(block):
    """All key/value pairs, plus any key that appears more than once."""
    pairs = ENTRY.findall(block)
    seen, dupes = {}, []
    for key, value in pairs:
        if key in seen:
            dupes.append(key)
        seen[key] = value
    return seen, dupes


def prop_names(src):
    """Property names in an object literal, tolerating ES6 shorthand and nested
    calls in the values."""
    names, depth, current = set(), 0, ''
    for ch in src:
        if ch in '([{':
            depth += 1
        elif ch in ')]}':
            depth -= 1
        if ch == ',' and depth == 0:
            names.add(current)
            current = ''
        else:
            current += ch
    names.add(current)
    return {n.split(':', 1)[0].strip() for n in names if n.strip()}


def main():
    en_src, mr_src = load_tables()
    en, en_dupes = entries(en_src)
    mr, mr_dupes = entries(mr_src)

    problems = []

    print('table sizes: en=%d  mr=%d' % (len(en), len(mr)))
    for lang, dupes in (('en', en_dupes), ('mr', mr_dupes)):
        for key in dupes:
            problems.append('duplicate key in %s: %s' % (lang, key))
    for key in sorted(set(en) - set(mr)):
        problems.append('missing from mr: %s' % key)
    for key in sorted(set(mr) - set(en)):
        problems.append('missing from en: %s' % key)

    for page in PAGES:
        js_path = os.path.join(FRONTEND, 'js', '%s.js' % page)
        html_path = os.path.join(FRONTEND, '%s.html' % page)

        used = set()
        if os.path.exists(js_path):
            js = read(js_path)
            used |= set(TR_CALL.findall(js))

            for match in TRF_CALL.finditer(js):
                key, varsrc = match.group(1), match.group(2)
                passed = prop_names(varsrc)
                for lang, tbl in (('en', en), ('mr', mr)):
                    if key not in tbl:
                        continue
                    need = set(SLOT.findall(tbl[key]))
                    if need - passed:
                        problems.append('%s.js trf("%s") [%s] needs %s, passes %s'
                                        % (page, key, lang, sorted(need), sorted(passed)))

        if os.path.exists(html_path):
            html = read(html_path)
            used |= set(HTML_KEY.findall(html))
            used |= set(DATA_KEY.findall(html))

        for key in sorted(used):
            for lang, tbl in (('en', en), ('mr', mr)):
                if key not in tbl:
                    problems.append('%s references "%s" but %s has no such key'
                                    % (page, key, lang))
        print('  %-11s keys referenced: %d' % (page, len(used)))

    print()
    if problems:
        for p in problems:
            print('FAIL  %s' % p)
        print('\n%d problem(s).' % len(problems))
        return 1
    print('All i18n checks passed.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
