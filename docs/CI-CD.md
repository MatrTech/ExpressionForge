# CI/CD and release management

ExpressionForge uses GitHub Actions for pull-request validation, main-branch artifacts, and verified version-change releases.

## Continuous integration

Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)

Runs for every pull request, pushes to `main`, and manual dispatch. The job:

1. Restores and builds the .NET 10 solution in Release mode, treating warnings as errors.
2. Runs MSTest and uploads TRX results, even if the tests fail.
3. Separately runs SQL Server 2022 Testcontainers integration tests (Docker required), checking real null and collection semantics.
4. Checks the editor JavaScript syntax and parameter-binding tests with Node.
5. Packs the `ExpressionForge.Core` NuGet candidate and uploads it as a short-lived build artifact.
6. On `main` only, publishes and uploads a framework-dependent ASP.NET Core API artifact.

Artifacts are retained for 14 days. A CI artifact is **not** a published release.

## Release delivery

Workflow: [`.github/workflows/release.yml`](../.github/workflows/release.yml)

The workflow runs automatically when `Directory.Build.props` changes on `main`, or when a stable version tag such as `v0.2.0` is pushed manually. For a version-change release, it creates the tag and GitHub Release **only after every release check passes**. It refuses to release unless:

- The package version is exactly `MAJOR.MINOR.PATCH`.
- Manual release tags match the package version and point to commits on `main`.
- Automatic releases run only from a version change merged into `main` and refuse existing tags or releases.
- Restore, warnings-as-errors build, unit tests, SQL Server integration tests, editor syntax/binding tests, and NuGet pack all succeed.

Only then does the workflow create a version tag and GitHub Release with curated notes (or generated notes when no version-specific file exists), a `.nupkg` file, and a framework-dependent API `.tar.gz` archive.

**NuGet.org publishing is intentionally not enabled.** No API key, trusted publisher or package ownership has been configured. A GitHub Release is not the same as publishing a package to NuGet.org.

## Release checklist

1. Complete and verify the milestone acceptance criteria, including required integration tests.
2. Update `Directory.Build.props`, visible editor version, README, and release notes together.
3. Open a pull request; wait for green CI and review; merge to `main`.
4. Verify the `main` CI workflow has completed successfully.
5. The version-change push starts the release workflow automatically. Wait for its own unit, SQL Server, editor and website checks to pass.
6. Verify the published tag, GitHub Release and downloaded artifacts before announcing the version. Manual tag releases remain a fallback.

Never create a version tag for unfinished milestones.

## Recommended GitHub repository settings

These settings require repository administration and are **not configured by these workflows**:

- Protect `main` with a ruleset: require pull requests and the `build-test` status check.
- Require branches to be up to date before merging; block force pushes and deletion.
- Require review approval for external contributors.
- Enable automatic deletion of merged feature branches if desired.
- Set Actions workflow permissions to allow the release workflow's scoped `contents: write` permission.

The GitHub integration currently cannot modify repository rulesets or branch protection. A repository administrator must apply those settings in GitHub.

## Future gates

Package vulnerability auditing, coverage reporting and NuGet.org trusted publishing are follow-up improvements. Do not claim those checks are enforced before they are implemented.
