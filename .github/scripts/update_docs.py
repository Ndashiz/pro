#!/usr/bin/env python3
"""
Refreshes the auto-generated "Derniers commits" block in docs/architecture.html.

Why a script and not sed: the block is multi-line HTML, and `sed s|a|b|` cannot
take a replacement containing raw newlines — the previous inline version failed
with "unterminated `s' command" on every single run since it was added.

What it does NOT touch: the hand-written changelog (§18, id="changelog").
That section is curated by humans; this block is a separate, machine-owned
appendix with its own id.
"""

import html
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

DOC = "docs/architecture.html"
START = "<!-- AUTOCOMMITS_START -->"
END = "<!-- AUTOCOMMITS_END -->"
REPO = os.environ.get("REPO", "Ndashiz/lazypo2")

CSS = """.cl-sha { font-family:"DM Mono",monospace; font-size:12px; }
  .cl-sha a { color:var(--accent2); text-decoration:none; }
  .cl-sha a:hover { text-decoration:underline; }
  .cl-msg { color:var(--text); }
  .cl-author, .cl-date { color:var(--muted); font-size:12px; }
  .cl-date { white-space:nowrap; }"""


def git_log():
    """Last 10 commits as (sha, short_sha, subject, author, relative_date)."""
    sep = "\x1f"
    out = subprocess.run(
        ["git", "log", "-10", f"--pretty=format:%H{sep}%h{sep}%s{sep}%an{sep}%cr"],
        capture_output=True, text=True, check=True,
    ).stdout
    rows = []
    for line in out.splitlines():
        parts = line.split(sep)
        if len(parts) == 5:
            rows.append(parts)
    return rows


def build_block(rows):
    generated = datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M UTC")
    trs = "\n".join(
        "        <tr>"
        f'<td class="cl-sha"><a href="https://github.com/{REPO}/commit/{sha}"'
        ' target="_blank" rel="noopener">' + html.escape(short) + "</a></td>"
        f'<td class="cl-msg">{html.escape(subject)}</td>'
        f'<td class="cl-author">{html.escape(author)}</td>'
        f'<td class="cl-date">{html.escape(when)}</td>'
        "</tr>"
        for sha, short, subject, author, when in rows
    )
    return f"""{START}
  <section class="section" id="auto-commits">
    <div class="section-header">
      <div class="section-num">★</div>
      <h2>Derniers commits</h2>
    </div>
    <p>Bloc régénéré automatiquement à chaque push sur <code>main</code>
       (dernière mise à jour&nbsp;: {generated}). Pour les changements
       <em>expliqués</em>, voir <a href="#changelog">§18 — Dernières modifs</a>,
       maintenue à la main.</p>
    <table class="data-table" style="font-size:13px;">
      <thead>
        <tr><th>Commit</th><th>Description</th><th>Auteur</th><th>Date</th></tr>
      </thead>
      <tbody>
{trs}
      </tbody>
    </table>
  </section>
{END}"""


def main():
    try:
        with open(DOC, encoding="utf-8") as fh:
            doc = fh.read()
    except FileNotFoundError:
        sys.exit(f"✗ {DOC} not found")

    rows = git_log()
    if not rows:
        sys.exit("✗ git log returned nothing")
    block = build_block(rows)

    # 1. Replace the existing block, or insert one before </main>.
    if START in doc and END in doc:
        doc = re.sub(
            re.escape(START) + ".*?" + re.escape(END), lambda _: block, doc, flags=re.S
        )
        action = "replaced"
    elif "</main>" in doc:
        doc = doc.replace("</main>", block + "\n</main>", 1)
        action = "inserted"
    else:
        sys.exit("✗ no AUTOCOMMITS markers and no </main> to anchor to")

    # 2. TOC entry, once.
    if 'href="#auto-commits"' not in doc:
        anchor = '<a href="#changelog">★ Dernières modifs</a>'
        if anchor in doc:
            doc = doc.replace(
                anchor, anchor + '\n  <a href="#auto-commits">Derniers commits</a>', 1
            )

    # 3. Table CSS, once.
    if ".cl-sha" not in doc and "</style>" in doc:
        doc = doc.replace("</style>", f"  {CSS}\n</style>", 1)

    with open(DOC, "w", encoding="utf-8") as fh:
        fh.write(doc)

    print(f"✅ {action} commit block ({len(rows)} commits)")


if __name__ == "__main__":
    main()
