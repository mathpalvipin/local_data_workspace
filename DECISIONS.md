# Decisions

## Vanilla TS for the data layer, React added later
Profiling with React in the tree makes it ambiguous whether a long task
is my parsing or React's reconciliation. Building the data layer standalone
means every millisecond in the flame chart is attributable.
Cost: a small refactor when React comes in.

## Generated test data over a public dataset
Needed guaranteed coverage of nullable fields, high- and low-cardinality
strings, and embedded commas. A seeded PRNG makes profiling runs
comparable across days.


## Measured a naive baseline before optimizing
Synchronous main-thread parse of a 47MB CSV, captured with 4x CPU
throttling. Profile in perf/baseline.json.

- read to string: ___ms
- parse: ___ms
- total blocked: ___ms
- longest single task: ___ms
- heap after load: ___MB

Purpose: without a control, "I used a worker" is an unverifiable claim.
The call tree also reveals whether the cost is string scanning or object
allocation — which determines whether workers alone are sufficient or
whether the data layout needs to change too.