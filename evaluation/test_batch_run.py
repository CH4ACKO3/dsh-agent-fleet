import argparse
import importlib.util
import json
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("batch_run", Path(__file__).with_name("batch-run.py"))
batch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(batch)


class BatchTests(unittest.TestCase):
    def test_ale_evidence_exports_only_unique_fleet_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "official/run/origin_log/dsh-fleet"
            evaluation = source / "dsh-fleet-evaluation"
            evaluation.mkdir(parents=True)
            (source / "dsh-fleet-task.md").write_text("actual task")
            (evaluation / "events.jsonl").write_text('{"type":"work_started"}\n')
            (evaluation / "answer.txt").write_text("actual answer")
            (source / "rawsession.jsonl").write_text("private raw session")
            (root / "official/events.jsonl").write_text("native ALE events")
            evidence = batch.normalize_ale_evidence(root)
            self.assertEqual(evidence["sourceStatus"], "unique")
            self.assertEqual(set(evidence["copied"]), {"task.md", "events.jsonl", "answer.txt"})
            self.assertEqual((root / "results/task.md").read_text(), "actual task")
            self.assertEqual((root / "results/events.jsonl").read_text(), '{"type":"work_started"}\n')
            self.assertEqual(len(list((root / "results").iterdir())), 3)

    def test_ale_evidence_rejects_ambiguous_sources_and_does_not_use_native_events(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for run in ("one", "two"):
                source = root / "official" / run / "origin_log/dsh-fleet"
                source.mkdir(parents=True)
                (source / "dsh-fleet-task.md").write_text(run)
            self.assertEqual(batch.normalize_ale_evidence(root)["sourceStatus"], "ambiguous")
            self.assertFalse((root / "results").exists())
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "official/run/origin_log/dsh-fleet"
            source.mkdir(parents=True)
            (source / "dsh-fleet-task.md").write_text("actual task")
            (root / "official/events.jsonl").write_text('{"type":"native_only"}\n')
            self.assertEqual(batch.normalize_ale_evidence(root)["copied"], ["task.md"])
            self.assertFalse((root / "results/events.jsonl").exists())

    def test_ale_evidence_rejects_oversize_and_invalid_events(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "official/run/origin_log/dsh-fleet"
            evaluation = source / "dsh-fleet-evaluation"
            evaluation.mkdir(parents=True)
            (source / "dsh-fleet-task.md").write_bytes(b"a" * (64 * 1024 + 1))
            (evaluation / "answer.txt").write_bytes(b"a" * (32 * 1024 + 1))
            (evaluation / "events.jsonl").write_text("not JSON\n")
            evidence = batch.normalize_ale_evidence(root)
            self.assertEqual(evidence["copied"], [])
            self.assertEqual(set(evidence["rejected"]), {"task.md", "events.jsonl", "answer.txt"})

    def test_ale_evidence_rejects_path_escape_and_symlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            root = parent / "episode"
            source = root / "official/run/origin_log/dsh-fleet"
            source.mkdir(parents=True)
            outside = parent / "heldout.txt"
            outside.write_text("heldout")
            with self.assertRaises(ValueError):
                batch.checked_episode_path(root, outside)
            try:
                (source / "dsh-fleet-task.md").symlink_to(outside)
            except OSError:
                self.skipTest("symlink creation unavailable")
            evidence = batch.normalize_ale_evidence(root)
            self.assertEqual(evidence["copied"], [])
            self.assertIn("task.md", evidence["rejected"])
            (source / "dsh-fleet-task.md").unlink()
            (source / "dsh-fleet-evaluation").symlink_to(parent, target_is_directory=True)
            (parent / "answer.txt").write_text("heldout answer")
            evidence = batch.normalize_ale_evidence(root)
            self.assertIn("answer.txt", evidence["rejected"])
            self.assertFalse((root / "results/answer.txt").exists())
            (root / "results").rmdir()
            (root / "results").symlink_to(parent, target_is_directory=True)
            self.assertEqual(batch.normalize_ale_evidence(root)["sourceStatus"], "unsafe")

    def test_ale_env_file_is_literal_and_forwarded(self):
        try:
            import yaml
        except ImportError:
            self.skipTest("PyYAML required for native ALE adapter tests")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "env.yaml").write_text("snapshots: {}")
            (root / "agent.yaml").write_text("harness: example")
            (root / "experiment.yaml").write_text(yaml.safe_dump({"agent": str(root / "agent.yaml"), "environment": str(root / "env.yaml")}))
            secret = root / "provider.env"
            secret.write_text("# comment\n\nMODEL_TOKEN=literal$(not-a-command)\n")
            output = root / "output"
            output.mkdir()
            with patch.object(batch, "run", return_value=0) as execute:
                result = batch.ale({"task": {"experiment": str(root / "experiment.yaml"), "agentPatch": "/opt/test.patch.yml"},
                                    "envFile": str(secret), "dryRun": True, "timeoutMs": 300001}, output)
            self.assertEqual(result["status"], "dry_run")
            self.assertEqual(execute.call_args.kwargs["env"]["MODEL_TOKEN"], "literal$(not-a-command)")
            self.assertEqual(yaml.safe_load((output / "experiment.yaml").read_text())["wall_time_s"], 331)
            self.assertEqual(yaml.safe_load((output / "agent.yaml").read_text())["config"]["timeout_ms"], 300001)

    def test_timeout_terminates_child(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = batch.run([sys.executable, "-c", "import time; time.sleep(60)"], Path(temporary) / "log", 0.05)
            self.assertEqual(result, 124)

    def test_cancel_reaches_running_child(self):
        with tempfile.TemporaryDirectory() as temporary:
            timer = threading.Timer(0.05, batch.CANCELLED.set)
            timer.start()
            try:
                self.assertEqual(batch.run([sys.executable, "-c", "import time; time.sleep(60)"], Path(temporary) / "log", 30), 130)
            finally:
                timer.cancel()
                batch.CANCELLED.clear()

    def test_failed_ale_exit_never_adopts_score(self):
        try:
            import yaml
        except ImportError:
            self.skipTest("PyYAML required for native ALE adapter tests")
        for exit_code in (3, 124):
            with self.subTest(exit_code=exit_code), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                (root / "env.yaml").write_text("snapshots: {}")
                (root / "agent.yaml").write_text("harness: example")
                (root / "experiment.yaml").write_text(yaml.safe_dump({"agent": str(root / "agent.yaml"), "environment": str(root / "env.yaml")}))
                output = root / "output"
                output.mkdir()
                (output / "official").mkdir()
                (output / "official/eval_result.json").write_text(json.dumps({"eval_status": "success", "score": 1}))
                with patch.object(batch, "run", return_value=exit_code):
                    result = batch.ale({"task": {"experiment": str(root / "experiment.yaml")}}, output)
                self.assertNotEqual(result["status"], "completed")
                self.assertNotIn("score", result)

    def test_wrong_answer_is_not_retried_and_resume_hashes_prompt(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            prompt = root / "task.md"
            prompt.write_text("original prompt")
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps({"tasks": [{"id": "one", "task": str(prompt)}]}))
            args = argparse.Namespace(manifest=manifest, output=root / "output", task=[], limit=None, source_commit="snapshot",
                                      image=None, grader_image=None, timeout_ms=1000, cpus=1, memory="1g", env=[], env_file=None,
                                      dry_run=False, resume=False, parallel=1, retries=3)

            def wrong_answer(job):
                result = {"status": "completed", "score": 0}
                batch.write_json(Path(job["output"]) / "result.json", result)
                return result

            with patch.object(batch, "execute_job", side_effect=wrong_answer) as execute:
                self.assertEqual(batch.batch(args), 0)
                self.assertEqual(execute.call_count, 1)
                args.resume = True
                self.assertEqual(batch.batch(args), 0)
                self.assertEqual(execute.call_count, 1)
                prompt.write_text("changed prompt")
                with self.assertRaisesRegex(ValueError, "identical source"):
                    batch.batch(args)


if __name__ == "__main__":
    unittest.main()
