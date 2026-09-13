# Fresh local checkout validation

Validated September 12, 2026, using a source archive of local commit `3f974bbf7d242619e4be88a2368171affd31a1e2`. No existing dependency directories, builds or application data were copied. Installation downloaded all **86 locked packages** into a separate initially empty package cache. All **389 exported source files**, including the lockfile, remained byte-identical afterward. [Machine-readable checks](clean-checkout-evidence.json) retain the exact archive identity and 14 passing audit checks.

| Step | Result | Elapsed |
|---|---|---|
| Frozen-lockfile dependency installation | Passed; 86 downloads, zero reused packages | 3.159 s |
| Complete workspace build | Passed | 2.924 s |
| Documented launcher probe | Passed; interface, API, local token and ownership | 2.079 s |
| Documented headless demo | Passed; review, scoped edit and uncertain-submission restart | 1.579 s |
| Launcher with both media tools configured as unavailable | Passed | 1.890 s |

These are observations on this host, not performance guarantees. The probe/demo commands also rebuild their source. Runtime checks made zero model or media API calls; dependency installation contacted the public package registry.

## What the launcher proved

The built process served the interface and JavaScript bundle on loopback. Health was public, project access required the local token, and an authenticated request created a project. The new token file had mode0600 and the token itself was absent from logs. A duplicate launcher failed before token handling while the original retained its project, event cursor and token. The same installation-owner inode survived, and ownership was reacquired after shutdown. An open event stream closed with the process; the first run shut down in7ms.

The same checks passed with explicit nonexistent FFmpeg/ffprobe paths, so this default launcher path did not depend on those tools. Native Codex was never selected. The headless fixture recorded four initial fake accepts, two after an edit, zero duplicates across uncertain-submission recovery, and exact reuse of the other shot. Its one-second placeholder preview is not the planned film. Private demo evidence was retained outside the system temporary directory.

## Installation conditions and limits

This was macOS arm64 with Node24.15.0 and pnpm10.33.0. The SQLite dependency's installation invoked node-gyp11.5.0, Python3.11.4 and make; an Xcode developer toolchain and Node build caches already existed. Thus the test establishes fresh source/dependency installation on this configured Mac, not an installation on a bare operating system. No signed desktop bundle, Linux or Windows environment was tested. This was an export of a local commit, not a remote GitHub clone; these milestones remain unpushed.

Two setup failures are retained in the private evidence. The harness initially supplied an unsupported pnpm userconfig command argument; changing it to `npm_config_userconfig` corrected the harness. A subsequent offline-cache install could not find a locked tarball. The successful check used a separate empty package cache and a normal public-registry install. This does not establish a fully offline installer.

The launcher probe covers HTTP and process behavior. It does not add browser visual or live-provider evidence. See [launcher contracts](LOCAL-LAUNCHER.md), [recovery validation](INSTALLATION-RECOVERY-VALIDATION.md) and [current status](STATUS.md) for those separate boundaries.
