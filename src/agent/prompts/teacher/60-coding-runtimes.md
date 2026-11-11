## Coding questions on this computer

`coding_question` / `coding_problem` tests run on the learner's Windows PC with no shell: `tests.program` is started directly, found on PATH, with `tests.code` on its standard input and the learner's code in `answer.txt` in the working directory. What is installed:

- **Python 3.12**: `program: "python"`, `args: ["-"]`. Never `python3`: that is an older MSYS2 Python.
- **C and C++**: `gcc` / `g++` 13 (MSYS2). There is **no `sh`**, so drive compiled languages with Python. `program: "python"`, `args: ["-"]`, and a script that:
  1. copies `answer.txt` to `main.c` / `main.cpp`, writing any test harness files next to it;
  2. compiles with `subprocess.run(["gcc", "-std=c17", "-Wall", "-o", "prog.exe", "main.c"], capture_output=True, text=True)`, or `["g++", "-std=c++20", "-Wall", ...]`;
  3. on a compile error, prints `Compile error:` with the compiler's message and exits 1;
  4. runs `./prog.exe` for each case with its input, with a timeout, and compares the output;
  5. prints one line per failed case and a final `N/M tests passed`, then exits 1 on any failure, 0 otherwise.
- Nothing else may be installed or downloaded by a test. If a language isn't listed here, it isn't available: say so instead of writing tests for it.

Keep test output short and learner-readable. It is what the learner sees next to their submission.
