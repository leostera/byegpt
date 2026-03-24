from __future__ import annotations

import json
import shutil
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

from byegpt.utils import ensure_directory, sha256_bytes, utc_now, write_json


def import_chatgpt_export_archive(archive_path: Path, output_dir: Path) -> dict[str, Any]:
    raw_root = output_dir / "raw"
    normalized_root = output_dir / "normalized"
    ensure_directory(raw_root)
    ensure_directory(normalized_root)

    manifest: dict[str, Any] = {
        "source": "chatgpt-export-zip",
        "archive_path": str(archive_path),
        "exported_at": utc_now(),
        "entries": [],
        "skipped_entries": [],
        "summary": {
            "file_count": 0,
            "json_file_count": 0,
            "normalized_json_file_count": 0,
        },
    }

    with zipfile.ZipFile(archive_path) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue

            relative_path = safe_archive_path(info.filename)
            if relative_path is None:
                manifest["skipped_entries"].append(
                    {"archive_path": info.filename, "reason": "unsafe archive path"}
                )
                continue

            data = archive.read(info)
            raw_path = raw_root / relative_path
            ensure_directory(raw_path.parent)
            raw_path.write_bytes(data)

            entry: dict[str, Any] = {
                "archive_path": info.filename,
                "raw_path": str(raw_path.relative_to(output_dir)),
                "size_bytes": info.file_size,
                "sha256": sha256_bytes(data),
            }
            manifest["summary"]["file_count"] += 1

            if raw_path.suffix.lower() == ".json":
                manifest["summary"]["json_file_count"] += 1
                try:
                    parsed = json.loads(data.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                    entry["json_error"] = str(exc)
                else:
                    normalized_path = normalized_root / relative_path
                    write_json(normalized_path, parsed)
                    entry["normalized_path"] = str(normalized_path.relative_to(output_dir))
                    manifest["summary"]["normalized_json_file_count"] += 1

            manifest["entries"].append(entry)

    write_json(output_dir / "manifest.json", manifest)
    return manifest


def safe_archive_path(name: str) -> Path | None:
    pure = PurePosixPath(name)
    if pure.is_absolute():
        return None
    if any(part == ".." for part in pure.parts):
        return None
    if not pure.parts:
        return None
    return Path(*pure.parts)
