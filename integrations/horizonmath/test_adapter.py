import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


def module(name):
    specification = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    loaded = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(loaded)
    return loaded


class ScoringTests(unittest.TestCase):
    def test_numeric_judge_unavailable_is_not_a_pass(self):
        result = module("grade").summarize({"mode": "numeric", "success": False,
                                           "error_type": "compliance_indeterminate", "expected_value": "SECRET"})
        self.assertEqual(result["status"], "indeterminate")
        self.assertIsNone(result["score"])
        self.assertNotIn("SECRET", json.dumps(result))

    def test_valid_construction_that_only_matches_baseline_is_not_pass(self):
        grade = module("grade")
        result = grade.summarize({"mode": "benchmark", "valid": True,
                                  "baseline_comparison": {"result": "matches_baseline"}})
        self.assertEqual(result["score"], 0)
        result = grade.summarize({"mode": "benchmark", "valid": True,
                                  "baseline_comparison": {"result": "beats_baseline"}})
        self.assertEqual(result["score"], 1)

    def test_export_has_no_reference_fields(self):
        checkout = Path(__file__).resolve().parents[2] / "output/upstream-horizonmath"
        if not checkout.exists():
            self.skipTest("Official checkout absent; run prepare.py after fetching the pinned revision")
        with tempfile.TemporaryDirectory() as temporary:
            manifest = module("prepare").export(checkout, Path(temporary))
            self.assertGreater(len(manifest["tasks"]), 100)
            self.assertEqual(len({task["id"] for task in manifest["tasks"]}), len(manifest["tasks"]))
            for task in manifest["tasks"]:
                self.assertNotIn("numeric_value", task)
                self.assertNotIn("source_note", task)
                self.assertTrue(Path(task["task"]).is_file())


if __name__ == "__main__":
    unittest.main()
