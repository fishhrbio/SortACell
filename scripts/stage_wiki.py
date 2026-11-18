"""Stage repository wiki Markdown with GitHub wiki URLs, without network access."""

import argparse
import re
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("owner", help="GitHub user or organization that owns SortACell")
    parser.add_argument("destination", type=Path, help="A new local directory for the staged pages")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9-]{0,38}", args.owner):
        parser.error("Use a valid GitHub owner name.")
    source = Path(__file__).resolve().parents[1] / "wiki"
    pages = {path.stem for path in source.glob("*.md") if not path.name.startswith("_")}
    base = "https://github.com/" + args.owner + "/SortACell/wiki"

    def link(match):
        page, fragment = match.groups()
        if page not in pages:
            return match.group(0)
        suffix = "" if page == "Home" else "/" + page
        return "(" + base + suffix + (fragment or "") + ")"

    args.destination.mkdir(parents=True, exist_ok=False)
    for path in sorted(source.glob("*.md")):
        body = path.read_text(encoding="utf-8")
        staged = re.sub(r"\(([\w-]+)\.md(#[\w-]+)?\)", link, body)
        (args.destination / path.name).write_text(staged, encoding="utf-8")
    print(f"Staged {len(pages)} pages and the sidebar in {args.destination.resolve()}.")


if __name__ == "__main__":
    main()
