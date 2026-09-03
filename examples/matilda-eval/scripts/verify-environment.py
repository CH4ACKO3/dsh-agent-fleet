from __future__ import annotations

import json
import platform
import subprocess
import tempfile
from pathlib import Path

import numpy
import ortools
import psutil
import scipy
import z3
from ortools.sat.python import cp_model
from scipy.optimize import Bounds, milp


def main() -> None:
    z3_value = z3.Int("z3_smoke_value")
    z3_solver = z3.Solver()
    z3_solver.add(z3_value == 1)
    assert z3_solver.check() == z3.sat

    cp_sat_model = cp_model.CpModel()
    cp_sat_value = cp_sat_model.new_int_var(0, 1, "cp_sat_smoke_value")
    cp_sat_model.add(cp_sat_value == 1)
    cp_sat_solver = cp_model.CpSolver()
    assert cp_sat_solver.solve(cp_sat_model) == cp_model.OPTIMAL

    highs_result = milp(
        c=numpy.array([1.0]),
        integrality=numpy.array([1]),
        bounds=Bounds(numpy.array([1.0]), numpy.array([1.0])),
    )
    assert highs_result.success and highs_result.x is not None
    assert numpy.allclose(highs_result.x, numpy.array([1.0]))

    login_python = subprocess.run(
        ["sh", "-lc", "command -v python3 && python3 -c 'import z3; print(z3.get_version_string())'"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    assert login_python[0] == "/usr/local/bin/python3"
    assert login_python[1] == z3.get_version_string()

    login_lean = subprocess.run(
        ["sh", "-lc", "command -v lean && command -v lake && lean --version && lake --version"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    assert login_lean[0] == "/usr/local/bin/lean"
    assert login_lean[1] == "/usr/local/bin/lake"

    lean_version = subprocess.run(
        ["lean", "--version"], check=True, capture_output=True, text=True
    ).stdout.splitlines()[0]
    lake_version = subprocess.run(
        ["lake", "--version"], check=True, capture_output=True, text=True
    ).stdout.splitlines()[0]
    with tempfile.TemporaryDirectory(prefix="fleet-lean-smoke-") as directory:
        proof = Path(directory) / "MathlibSmoke.lean"
        proof.write_text(
            "import Mathlib\n\nexample : (2 : Nat) + 2 = 4 := by norm_num\n",
            encoding="utf-8",
        )
        subprocess.run(
            ["lean-mathlib", str(proof)], check=True, capture_output=True, text=True
        )

    versions = {
        "python": platform.python_version(),
        "numpy": numpy.__version__,
        "ortools": ortools.__version__,
        "psutil": psutil.__version__,
        "scipy": scipy.__version__,
        "z3": z3.get_version_string(),
        "lake": lake_version,
        "lean": lean_version,
    }
    checks = {
        "cp_sat": "optimal",
        "highs_milp": "optimal",
        "login_shell_python": "venv",
        "login_shell_lean": "available",
        "logical_cpus_visible": psutil.cpu_count(logical=True),
        "mathlib": "compiled",
        "z3": "sat",
    }
    print(json.dumps({"checks": checks, "versions": versions}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
