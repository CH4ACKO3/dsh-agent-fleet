from __future__ import annotations

import json
import platform

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

    versions = {
        "python": platform.python_version(),
        "numpy": numpy.__version__,
        "ortools": ortools.__version__,
        "psutil": psutil.__version__,
        "scipy": scipy.__version__,
        "z3": z3.get_version_string(),
    }
    checks = {
        "cp_sat": "optimal",
        "highs_milp": "optimal",
        "logical_cpus_visible": psutil.cpu_count(logical=True),
        "z3": "sat",
    }
    print(json.dumps({"checks": checks, "versions": versions}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
