from __future__ import annotations

import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
EXTENSION_DIR = ROOT / "extension"
DIST_DIR = ROOT / "dist"


def iter_extension_files() -> list[Path]:
    files: list[Path] = []
    for path in sorted(EXTENSION_DIR.rglob("*")):
        if not path.is_file():
            continue
        if "__pycache__" in path.parts:
            continue
        if path.name == ".DS_Store":
            continue
        files.append(path)
    return files


def main() -> None:
    manifest = json.loads((EXTENSION_DIR / "manifest.json").read_text())
    version = manifest["version"]

    DIST_DIR.mkdir(parents=True, exist_ok=True)
    archive_path = DIST_DIR / f"byegpt-extension-v{version}.zip"

    with ZipFile(archive_path, "w", compression=ZIP_DEFLATED) as archive:
        for path in iter_extension_files():
            archive.write(path, path.relative_to(EXTENSION_DIR))

    digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    digest_path = archive_path.with_suffix(archive_path.suffix + ".sha256")
    digest_path.write_text(f"{digest}  {archive_path.name}\n")

    print(archive_path)
    print(digest_path)


if __name__ == "__main__":
    main()
