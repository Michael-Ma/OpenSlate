import base64
from contextlib import contextmanager
import importlib.util
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("narrate", Path(__file__).with_name("narrate.py"))
narrate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(narrate)


class NarrationMoneyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.manifest = self.folder / "demo.json"
        self.manifest.write_text(json.dumps({"narration": [{"id": "01", "text": "A short demo."}]}))
        self.calls = 0
        self.failure = False

        @contextmanager
        def create(**kwargs):
            self.calls += 1
            if self.failure:
                raise TimeoutError("Unknown outcome")
            usage = {"input_tokens": 10, "output_tokens": 50}
            yield SimpleNamespace(headers={"x-request-id": "fake-request"}, iter_lines=lambda: iter([
                "data: " + json.dumps({"type": "speech.audio.delta", "audio": base64.b64encode(bytes(4800)).decode()}),
                "data: " + json.dumps({"type": "speech.audio.done", "usage": usage}),
            ]))

        def client(**kwargs):
            self.assertEqual(kwargs["max_retries"], 0)
            return SimpleNamespace(audio=SimpleNamespace(speech=SimpleNamespace(with_streaming_response=SimpleNamespace(create=create))))

        self.enterContext(patch.dict(sys.modules, {"openai": SimpleNamespace(OpenAI=client)}))
        self.enterContext(patch.object(sys, "argv", ["narrate.py", str(self.manifest)]))

    def ledger(self):
        return json.loads((self.folder / "narration/ledger.json").read_text())

    def test_success_records_usage_and_replay_buys_nothing(self):
        narrate.main()
        narrate.main()
        self.assertEqual(self.calls, 1)
        self.assertEqual(self.ledger()[0]["state"], "done")
        self.assertAlmostEqual(self.ledger()[0]["costUsd"], 0.000606)

    def test_timeout_persists_unknown_and_refuses_replay(self):
        self.failure = True
        with self.assertRaises(TimeoutError):
            narrate.main()
        self.assertEqual(self.ledger()[0]["state"], "unknown")
        with self.assertRaisesRegex(ValueError, "reconciliation"):
            narrate.main()
        self.assertEqual(self.calls, 1)

    def test_changed_completed_text_does_not_buy_again(self):
        narrate.main()
        self.manifest.write_text(json.dumps({"narration": [{"id": "01", "text": "Changed."}]}))
        with self.assertRaisesRegex(ValueError, "reconciliation"):
            narrate.main()
        self.assertEqual(self.calls, 1)

    def test_overlong_input_refused_before_call(self):
        self.manifest.write_text(json.dumps({"narration": [{"id": "01", "text": "x" * 451}]}))
        with self.assertRaises(ValueError):
            narrate.main()
        self.assertEqual(self.calls, 0)

    def test_budget_refused_before_call(self):
        (self.folder / "narration").mkdir()
        (self.folder / "narration/ledger.json").write_text(json.dumps([{"id": "earlier", "costUsd": 0.09}]))
        with self.assertRaisesRegex(ValueError, "reserve"):
            narrate.main()
        self.assertEqual(self.calls, 0)

    def test_concurrent_run_refused_without_removing_other_lock(self):
        (self.folder / "narration").mkdir()
        lock = self.folder / "narration/narration.lock"
        lock.touch()
        with self.assertRaises(FileExistsError):
            narrate.main()
        self.assertTrue(lock.exists())
        self.assertEqual(self.calls, 0)

    def test_ledger_is_refreshed_after_lock_acquisition(self):
        original_open = Path.open
        def open_after_other_process_finishes(path, *args, **kwargs):
            if path.name == "narration.lock" and args == ("x",):
                ledger = [{"id": "01", "state": "done", "sha256": hashlib.sha256(b"A short demo.").hexdigest(), "costUsd": 0.001}]
                (self.folder / "narration/ledger.json").write_text(json.dumps(ledger))
            return original_open(path, *args, **kwargs)
        with patch.object(Path, "open", open_after_other_process_finishes):
            narrate.main()
        self.assertEqual(self.calls, 0)


if __name__ == "__main__":
    unittest.main()
