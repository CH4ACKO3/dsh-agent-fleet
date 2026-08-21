# Frontal Team test fixtures

These files are verbatim local test inputs copied from
`/Users/ch4acko3/Documents/Frontal Lobe plugin-frontal-team`.

- `teams/` contains the four built-in Team templates.
- `tasks/realpde.md` is the RealPDE development task.
- `tasks/riemann-h0.md` and `tasks/riemann-h1.md` pair with `teams/research.json`.

The root `dsh-agent-fleet` plugin loads the Team identity, operating prompt, Channels, member roles,
member prompts, and startup coordinator from this format through `fleet_run start`. Desk behavior
and Frontal Team's additional runtime gates are intentionally not reproduced.
