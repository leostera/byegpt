from __future__ import annotations

import unittest

from byegpt.api import OpenAIAPIError, OpenAIClient, export_conversation_bundle, export_response_bundle


class StubClient(OpenAIClient):
    def __init__(self, responses):
        super().__init__(api_key="test-key", base_url="https://example.invalid/v1")
        self.responses = responses

    def get_json(self, path, query=None):
        key = (path, tuple(sorted((query or {}).items())))
        try:
            return self.responses[key]
        except KeyError as exc:
            raise AssertionError(f"Unexpected request: {key}") from exc


class APITests(unittest.TestCase):
    def test_collects_paginated_conversation_items(self):
        client = StubClient(
            {
                ("conversations/conv_123", ()): {"id": "conv_123", "object": "conversation"},
                ("conversations/conv_123/items", ()): {
                    "data": [{"id": "msg_1"}, {"id": "msg_2"}],
                    "has_more": True,
                    "last_id": "msg_2",
                },
                ("conversations/conv_123/items", (("after", "msg_2"),)): {
                    "data": [{"id": "msg_3"}],
                    "has_more": False,
                    "last_id": "msg_3",
                },
            }
        )

        bundle = export_conversation_bundle(client, "conv_123")

        self.assertEqual(bundle["conversation"]["id"], "conv_123")
        self.assertEqual(bundle["item_count"], 3)
        self.assertEqual([item["id"] for item in bundle["items"]], ["msg_1", "msg_2", "msg_3"])

    def test_collects_response_input_items(self):
        client = StubClient(
            {
                ("responses/resp_123", ()): {"id": "resp_123", "object": "response"},
                ("responses/resp_123/input_items", ()): {
                    "data": [{"id": "input_1"}],
                    "has_more": False,
                    "last_id": "input_1",
                },
            }
        )

        bundle = export_response_bundle(client, "resp_123")

        self.assertEqual(bundle["response"]["id"], "resp_123")
        self.assertEqual(bundle["input_item_count"], 1)
        self.assertEqual(bundle["input_items"][0]["id"], "input_1")

    def test_requires_cursor_when_has_more(self):
        client = StubClient({})

        def broken_get_json(path, query=None):
            return {"data": [{"object": "message"}], "has_more": True}

        client.get_json = broken_get_json  # type: ignore[method-assign]

        with self.assertRaises(OpenAIAPIError):
            client.collect_paginated_items("conversations/conv_123/items")


if __name__ == "__main__":
    unittest.main()
