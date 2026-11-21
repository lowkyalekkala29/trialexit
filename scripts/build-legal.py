"""Renders PRIVACY.md and TERMS.md into landing/privacy.html and landing/terms.html."""
import html, re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
HEAD = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title} — TrialExit</title>
<style>body{{margin:0;background:#f6f7f9;color:#111827;font:16px/1.65 -apple-system,'Segoe UI',system-ui,sans-serif}}main{{max-width:760px;margin:0 auto;padding:32px 20px 80px}}
a{{color:#16a34a}}h1{{font-size:30px;letter-spacing:-.5px}}h2{{font-size:19px;margin-top:32px}}table{{border-collapse:collapse;width:100%;font-size:14px;background:#fff}}td,th{{border:1px solid #e4e7eb;padding:8px 10px;text-align:left;vertical-align:top}}code{{background:#eef0f3;padding:1px 5px;border-radius:5px;font-size:.9em}}
.top{{display:flex;align-items:center;gap:9px;text-decoration:none;color:#111827;font-weight:700}}.mk{{width:26px;height:26px;border-radius:7px;background:#16a34a;color:#fff;display:grid;place-items:center}}</style></head>
<body><main><a class="top" href="./"><span class="mk">✓</span>TrialExit</a>'''

def inline(t):
    t = html.escape(t)
    t = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', t)
    t = re.sub(r'`(.+?)`', r'<code>\1</code>', t)
    return re.sub(r'\[(.+?)\]\((https?://[^)]+)\)', r'<a href="\2">\1</a>', t)

def render(md):
    out, para, inlist, intable = [], [], False, False
    def flush():
        nonlocal para
        if para: out.append('<p>' + inline(' '.join(para)) + '</p>'); para = []
    for l in md.splitlines():
        if l.startswith('|'):
            flush(); cells = [c.strip() for c in l.strip('|').split('|')]
            if set(''.join(cells)) <= set('-: '): continue
            tag = 'td' if intable else 'th'
            if not intable: out.append('<table>'); intable = True
            out.append('<tr>' + ''.join(f'<{tag}>{inline(c)}</{tag}>' for c in cells) + '</tr>'); continue
        if intable: out.append('</table>'); intable = False
        if l.startswith('- '):
            flush()
            if not inlist: out.append('<ul>'); inlist = True
            out.append('<li>' + inline(l[2:])); continue
        if inlist and l.startswith('  ') and l.strip(): out[-1] += ' ' + inline(l.strip()); continue
        if inlist: out.append('</ul>'); inlist = False
        if l.startswith('# '): flush(); out.append(f'<h1>{inline(l[2:])}</h1>')
        elif l.startswith('## '): flush(); out.append(f'<h2>{inline(l[3:])}</h2>')
        elif not l.strip(): flush()
        else: para.append(l.strip())
    flush()
    if inlist: out.append('</ul>')
    if intable: out.append('</table>')
    return '\n'.join(out)

for src, dst, title in [('PRIVACY.md', 'privacy.html', 'Privacy'), ('TERMS.md', 'terms.html', 'Terms')]:
    (root / 'landing' / dst).write_text(HEAD.format(title=title) + render((root / src).read_text()) + '</main></body></html>')
print('rendered landing/privacy.html, landing/terms.html')
