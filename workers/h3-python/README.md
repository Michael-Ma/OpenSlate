# Future local H3 worker

This directory reserves the optional Python inference boundary. No Python runtime or model code is included in the skeleton.

The planned worker owns model loading, GPU admission, preprocessing, inference, and output artifacts. TypeScript retains project state, scheduling, policy, and editing. A versioned job/capability API will connect them.

Local H3 capability parity with the cloud service is not assumed. See the [component design](../../docs/design/COMPONENT-DESIGN.md).
