# 1.0 API/ABI, incremental generation and candidate artifacts

This is an acceptance record, not release authorization. No stable tag or Maven
Central publication is produced by these checks. All fixtures are public Neton
fixtures; no downstream product is required.

## Final candidate: passed

Commit: `d2d176b3deb3c2b51e55aee92f0fbf9d765a9a05`.
[Backend CI run 40640599603](https://github.com/netonframework/neton/actions/runs/40640599603).
All required jobs and the `Neton release gates` aggregate passed on this exact
commit: ABI, all KSP targets including ARM64 native execution, all three reference
runtime targets, full framework/engine suites, PostgreSQL/Redis contracts, native
Core suites and the signed candidate-artifact rehearsal.

Downloaded reference manifests were independently checked for matching revision,
four migration commands, two healthy cycles >=60 seconds, exit code 0, closed port
and zero connections observed before teardown.

| Target | Release executable SHA-256 | Shutdown seconds (cycles 1 / 2) |
| --- | --- | --- |
| macosArm64 | `0e1a88d66d1e7ceaef8ab862e5355d99dbb494b2eeca08dd56dddbf17ee3547e` | 0.024 / 0.264 |
| linuxX64 | `bc23666fef711d02f454663c87e57bc30ac95433b07ff74481e4a7e6bef43223` | 0.115 / 0.114 |
| mingwX64 | `cc54f2b03b4a027acba43f65d60335d5ba3accc7aa29a6d408ac2c8f57109752` | 0.094 / 0.031 |

macOS/Linux used SIGTERM; Windows used CTRL_BREAK_EVENT for the owned process
group. Forced process termination was not used as acceptance evidence.

The final artifact-only consumer used `1.0.0-candidate.d2d176b3deb3`. Its
repository contained exactly 97 coordinates and 423 signed payloads, with matching
POM/Gradle metadata, checksums and BOM constraints. Both builds and all migrations
passed, followed by two >=60-second healthy cycles with zero connections and closed
ports after graceful exit (0.290/0.350 seconds, observed before teardown).
Consumer executable SHA-256:
`fb521a8fdcb0c85fb7f6348f0e07b05aae76f2aad3bacc47af1dfc2cc0426750`.
The ephemeral public signing key and its fingerprint are retained in the CI
artifact's public-key file and evidence manifest, rather than copied into this page.
Evidence and the signed repository are retained as
`candidate-artifacts-d2d176b3deb3c2b51e55aee92f0fbf9d765a9a05` in the same run.

The accepted implementation is on `ci/1.0-abi-incremental`; this record does not
claim that those changes have been merged into main or that main was revalidated.

## Verified intermediate candidate

Framework commit: `9362673a01533902b741efc9f88a84def9314c00`.
[Backend CI](https://github.com/netonframework/neton/actions/runs/40637754680).

| Gate | Observed result |
| --- | --- |
| Compiled API/ABI | All 17 published Kotlin libraries passed; PostgreSQL, MySQL and SQLite database API comparisons passed |
| KSP incremental | Clean/no-op/add/modify/delete passed on macOS ARM64, Windows x64 and Linux x64; Linux ARM64 cross-build plus separate native execution passed |
| macOS reference | Two release builds, migration up/up/status/verify and two >=60-second healthy cycles passed |
| Linux x64 reference | Same complete runtime contract passed |
| Windows reference | Two release builds passed; PostgreSQL initialization failed on disposable-directory access before runtime acceptance |

The macOS shutdown durations were 0.233/0.306 seconds; Linux durations were
0.064/0.114 seconds. Each cycle observed one connection while serving and zero
after graceful exit, with the port closed. Observations occurred before database
cleanup. These results do not imply Windows runtime acceptance or overall release
readiness.

## First signed-artifact rehearsal

Framework commit: `65fa05fbd5fe95efca3c0f0a53c67de33b5fa6a7`.
[Backend CI](https://github.com/netonframework/neton/actions/runs/40637914108).
Artifact: `candidate-artifacts-65fa05fbd5fe95efca3c0f0a53c67de33b5fa6a7`.

- Candidate version: `1.0.0-candidate.65fa05fbd5fe`.
- Exact inventory: 97 publication coordinates, 423 cryptographically verified
  signed payloads, matching checksums, POM/Gradle metadata and BOM constraints.
- Signing identity: ephemeral test key; public key and fingerprint retained.
  Verification was also repeated independently on the downloaded repository.
- The standalone consumer resolved its dependencies and generated/compiled its
  Kotlin sources, but release optimization exhausted Gradle's default heap.
- Therefore `passed` remained false. No runtime or complete candidate acceptance
  is claimed for this run. The consumer harness was subsequently given the same
  explicit 2 GB heap as the framework, without disabling release optimization.

## Intermediate corrections and remaining release decisions

Windows runtime correction was verified at
`73c36a4e77487ce867a7c523990120b755876ae0` in
[CI run 40638651554](https://github.com/netonframework/neton/actions/runs/40638651554).
Its four migration commands passed. Both healthy cycles exceeded 60 seconds,
then exited with code 0 after `CTRL_BREAK_EVENT` in 0.063/0.109 seconds. Each
observed one serving connection and zero after exit, with the port closed before
teardown. The directory ACL change granted only the gate user's SID on its owned
temporary directory; it did not grant Everyone/Users access or modify parent ACLs.

The later `662728e51d31be239208bc820bec3358a73e90a0` run exposed a separate
full-framework compilation failure: concurrent KSP/example compilation exhausted
the 512 MB Metaspace limit. The correction bounds Gradle workers to two, permits
1 GB Metaspace, and uses non-reused Gradle processes between CI phases. No tests,
examples or release optimizations were removed. This failure also prevents an
overall passing claim for that intermediate commit.

The final single-commit aggregate above closes these implementation gates and keeps
all earlier failure records. Production signing approval, final public-API freeze
review and post-publication Central-only verification remain separate decisions.
No stable release or release tag was created. The staged database publication uses
the PostgreSQL driver; MySQL/SQLite API comparisons do not claim separate published
driver artifacts. Artifact-consumer runtime was macOS ARM64; the three-platform
source-built reference matrix and four-target KSP execution remain distinct evidence.
