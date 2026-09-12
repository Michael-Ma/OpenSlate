# Future same-machine H3 worker

This directory reserves an optional Python inference boundary after v0. No Python runtime or model code is included. V0 runs for one user on one computer and starts with the H3 cloud API; local deployment of OpenSlate does not mean offline generation.

The planned worker owns model loading, GPU admission, preprocessing, inference, and output artifacts. TypeScript retains project state, scheduling, policy, and editing. A versioned loopback job/capability API on the same computer can connect them. The Python service will not own SQLite or application approval/budget decisions; local receipts and restart reconciliation still matter. Remote GPU hosting, distributed scheduling and shared-database deployment are outside v0 and need a separate future design.

Local H3 capability parity with the cloud service is not assumed. See the [component design](../../docs/design/COMPONENT-DESIGN.md).
