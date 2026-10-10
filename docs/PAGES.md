# ExpressionForge website (GitHub Pages)

The public website is built from static files in [`site/`](../site) and is published by [`.github/workflows/pages.yml`](../.github/workflows/pages.yml).

**Expected URL:** https://matrtech.github.io/ExpressionForge/

## Deployment

1. Changes to `site/**` or the Pages workflow are reviewed in a pull request. The main CI workflow checks JavaScript syntax and runs the site tests.
2. Merging into `main` triggers the **Deploy GitHub Pages** workflow. The workflow uploads `site/` as a Pages artifact and deploys it with `actions/deploy-pages`.
3. `actions/configure-pages` requests automatic Pages enablement (`enablement: true`). If organization or repository policies prevent this, an admin must open **Settings → Pages → Build and deployment → Source: GitHub Actions** and rerun the workflow.
4. The workflow's `github-pages` environment contains the deployed URL. Repository settings or organization policies can still block publication.

The workflow requires `contents: read`, `pages: write`, and `id-token: write` permissions. It does not use an external hosting service or credentials.

## Local preview

From the repository root:

```bash
python -m http.server 8080 --directory site
```

Open http://localhost:8080. Alternatively, serve the `site/` directory with any static web server.

## Site scope

The site is an **independent static project website**, not a deployed ASP.NET Core host. Its interactive example generates the real JSON AST shape and shows *illustrative* SQL, but does **not** call the query compiler or a database.

To run the real metadata-driven editor, validation, SQL compiler and optional data preview, follow [the main README](../README.md#try-it).

The site uses project-relative asset paths so it works under the `/ExpressionForge/` GitHub Pages subpath. Avoid hardcoded root-relative `/styles.css` URLs.

## Maintaining the site

- `site/index.html`: accessible landing page, documentation and playground controls.
- `site/styles.css`: responsive design; no external CSS framework or CDN dependency.
- `site/app.js`: standalone, browser-only AST demonstration.
- `site/favicon.svg`: small project icon.
- `tests/ExpressionForge.Site.Tests/site.test.cjs`: tests for AST shape, SQL illustration and relative assets.

Update the public roadmap when a release actually ships. Do not label a planned milestone as released before the package version and GitHub Release are published.
