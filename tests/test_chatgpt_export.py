from __future__ import annotations

import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from byegpt.chatgpt_export import import_chatgpt_export_archive, safe_archive_path


class ChatGPTExportTests(unittest.TestCase):
    def test_safe_archive_path_blocks_traversal(self):
        self.assertIsNone(safe_archive_path("../escape.txt"))
        self.assertIsNone(safe_archive_path("/absolute.txt"))
        self.assertEqual(safe_archive_path("nested/file.json"), Path("nested/file.json"))

    def test_imports_zip_and_normalizes_json(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            archive_path = temp_path / "chatgpt.zip"
            output_path = temp_path / "out"

            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("conversations.json", json.dumps({"count": 1}))
                archive.writestr("chat.html", "<html></html>")

            manifest = import_chatgpt_export_archive(archive_path, output_path)

            self.assertEqual(manifest["summary"]["file_count"], 2)
            self.assertEqual(manifest["summary"]["json_file_count"], 1)
            self.assertTrue((output_path / "raw" / "conversations.json").exists())
            self.assertTrue((output_path / "raw" / "chat.html").exists())

            normalized = json.loads((output_path / "normalized" / "conversations.json").read_text())
            self.assertEqual(normalized["count"], 1)


if __name__ == "__main__":
    unittest.main()
