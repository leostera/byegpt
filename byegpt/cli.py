from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Sequence

from byegpt.api import DEFAULT_BASE_URL, OpenAIAPIError, OpenAIClient, export_conversation_bundle, export_response_bundle
from byegpt.chatgpt_export import import_chatgpt_export_archive
from byegpt.utils import unique_preserving_order, utc_now, write_json


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="byegpt",
        description="Export supported ChatGPT and OpenAI API data surfaces.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    import_parser = subparsers.add_parser(
        "import-chatgpt-export",
        help="Import an official ChatGPT data export zip and normalize any JSON files.",
    )
    import_parser.add_argument("archive", type=Path, help="Path to the ChatGPT export zip file.")
    import_parser.add_argument("output", type=Path, help="Output directory for extracted data.")
    import_parser.set_defaults(handler=handle_import_chatgpt_export)

    export_parser = subparsers.add_parser(
        "export-api",
        help="Export known OpenAI API response and conversation IDs.",
    )
    export_parser.add_argument("output", type=Path, help="Output directory for exported JSON.")
    export_parser.add_argument(
        "--api-key",
        help="OpenAI API key. Defaults to OPENAI_API_KEY.",
    )
    export_parser.add_argument(
        "--base-url",
        default=os.environ.get("OPENAI_BASE_URL", DEFAULT_BASE_URL),
        help=f"Override the OpenAI API base URL. Defaults to {DEFAULT_BASE_URL}.",
    )
    export_parser.add_argument(
        "--conversation",
        action="append",
        default=[],
        help="Conversation ID to export. Repeat as needed.",
    )
    export_parser.add_argument(
        "--conversation-file",
        action="append",
        default=[],
        type=Path,
        help="File containing newline-delimited conversation IDs.",
    )
    export_parser.add_argument(
        "--response",
        action="append",
        default=[],
        help="Response ID to export. Repeat as needed.",
    )
    export_parser.add_argument(
        "--response-file",
        action="append",
        default=[],
        type=Path,
        help="File containing newline-delimited response IDs.",
    )
    export_parser.add_argument(
        "--include",
        action="append",
        default=[],
        help="Repeatable include parameter passed to item-list endpoints.",
    )
    export_parser.set_defaults(handler=handle_export_api)

    return parser


def handle_import_chatgpt_export(args: argparse.Namespace) -> int:
    manifest = import_chatgpt_export_archive(args.archive, args.output)
    print(
        f"Imported {manifest['summary']['file_count']} files "
        f"({manifest['summary']['normalized_json_file_count']} normalized JSON files) "
        f"into {args.output}"
    )
    return 0


def handle_export_api(args: argparse.Namespace) -> int:
    api_key = args.api_key or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("Missing API key. Use --api-key or set OPENAI_API_KEY.")

    conversation_ids = collect_ids(args.conversation, args.conversation_file)
    response_ids = collect_ids(args.response, args.response_file)

    if not conversation_ids and not response_ids:
        raise SystemExit(
            "Nothing to export. Pass at least one --conversation, --response, "
            "--conversation-file, or --response-file."
        )

    client = OpenAIClient(api_key=api_key, base_url=args.base_url)
    manifest: dict[str, object] = {
        "source": "openai-api",
        "base_url": args.base_url,
        "exported_at": utc_now(),
        "include": args.include,
        "conversations": [],
        "responses": [],
        "failures": [],
    }

    for conversation_id in conversation_ids:
        try:
            bundle = export_conversation_bundle(client, conversation_id, include=args.include)
            path = args.output / "conversations" / f"{conversation_id}.json"
            write_json(path, bundle)
            manifest["conversations"].append(
                {"id": conversation_id, "path": str(path.relative_to(args.output))}
            )
        except OpenAIAPIError as exc:
            manifest["failures"].append(
                {"kind": "conversation", "id": conversation_id, "error": str(exc)}
            )

    for response_id in response_ids:
        try:
            bundle = export_response_bundle(client, response_id, include=args.include)
            path = args.output / "responses" / f"{response_id}.json"
            write_json(path, bundle)
            manifest["responses"].append(
                {"id": response_id, "path": str(path.relative_to(args.output))}
            )
        except OpenAIAPIError as exc:
            manifest["failures"].append(
                {"kind": "response", "id": response_id, "error": str(exc)}
            )

    write_json(args.output / "manifest.json", manifest)

    failure_count = len(manifest["failures"])
    print(
        f"Exported {len(manifest['conversations'])} conversations and "
        f"{len(manifest['responses'])} responses into {args.output}."
    )
    if failure_count:
        print(f"{failure_count} export(s) failed. See manifest.json for details.", file=sys.stderr)
        return 1
    return 0


def collect_ids(cli_values: Sequence[str], file_paths: Sequence[Path]) -> list[str]:
    values: list[str] = list(cli_values)
    for path in file_paths:
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            values.append(line)
    return unique_preserving_order(values)


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.handler(args)
