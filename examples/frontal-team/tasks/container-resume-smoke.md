# Container resume smoke test

Collaborate to create `e2e-output/result.txt` in the shared workspace with exactly this content:

```text
dsh-agent-fleet resume works
```

The implementation owner must register the file with `fleet_resource`. A different member must
read the file, verify its exact content, and report the evidence in the main Channel. Use at least
one Meeting for coordination.

Do not open a `finish` Vote until `e2e-control/allow-finish` exists. While it is absent, record the
current state in the main Channel and remain available for later Fleet follow-up. After it appears,
recheck the artifact and finish through an approved `finish` Vote whose statement names the file
and the independent verification.
