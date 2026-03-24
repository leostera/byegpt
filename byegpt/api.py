from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Mapping

from byegpt.utils import utc_now

DEFAULT_BASE_URL = "https://api.openai.com/v1"


class OpenAIAPIError(RuntimeError):
    pass


@dataclass
class OpenAIClient:
    api_key: str
    base_url: str = DEFAULT_BASE_URL
    timeout_seconds: int = 60

    def get_json(self, path: str, query: Mapping[str, Any] | None = None) -> Any:
        url = self._build_url(path, query)
        request = urllib.request.Request(
            url,
            method="GET",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Accept": "application/json",
                "User-Agent": "byegpt/0.1.0",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise OpenAIAPIError(f"HTTP {exc.code} for {url}: {body.strip()}") from exc
        except urllib.error.URLError as exc:
            raise OpenAIAPIError(f"Network error for {url}: {exc.reason}") from exc

        try:
            return json.loads(payload)
        except json.JSONDecodeError as exc:
            raise OpenAIAPIError(f"OpenAI returned invalid JSON for {url}") from exc

    def collect_paginated_items(
        self, path: str, include: list[str] | None = None
    ) -> tuple[list[Any], int]:
        after: str | None = None
        page_count = 0
        items: list[Any] = []

        while True:
            query: dict[str, Any] = {}
            if after:
                query["after"] = after
            if include:
                query["include"] = include

            payload = self.get_json(path, query)
            page_count += 1

            if not isinstance(payload, dict):
                raise OpenAIAPIError(f"Expected an object while paging {path}")

            data = payload.get("data")
            if not isinstance(data, list):
                raise OpenAIAPIError(f"Expected a data array while paging {path}")

            items.extend(data)

            if not payload.get("has_more"):
                return items, page_count

            after = payload.get("last_id")
            if not after and data and isinstance(data[-1], dict):
                after = data[-1].get("id")

            if not after:
                raise OpenAIAPIError(f"Pagination for {path} reported more data without a cursor")

    def _build_url(self, path: str, query: Mapping[str, Any] | None = None) -> str:
        base = self.base_url.rstrip("/")
        full = f"{base}/{path.lstrip('/')}"
        if not query:
            return full
        encoded = urllib.parse.urlencode(query, doseq=True)
        return f"{full}?{encoded}"


def export_conversation_bundle(
    client: OpenAIClient, conversation_id: str, include: list[str] | None = None
) -> dict[str, Any]:
    conversation = client.get_json(f"conversations/{conversation_id}")
    items, page_count = client.collect_paginated_items(
        f"conversations/{conversation_id}/items", include=include
    )
    return {
        "exported_at": utc_now(),
        "kind": "conversation",
        "conversation": conversation,
        "items": items,
        "item_count": len(items),
        "page_count": page_count,
        "include": include or [],
    }


def export_response_bundle(
    client: OpenAIClient, response_id: str, include: list[str] | None = None
) -> dict[str, Any]:
    response = client.get_json(f"responses/{response_id}")
    input_items, page_count = client.collect_paginated_items(
        f"responses/{response_id}/input_items", include=include
    )
    return {
        "exported_at": utc_now(),
        "kind": "response",
        "response": response,
        "input_items": input_items,
        "input_item_count": len(input_items),
        "page_count": page_count,
        "include": include or [],
    }
