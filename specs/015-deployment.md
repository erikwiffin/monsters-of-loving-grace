# 015 — Deployment to GitHub Pages

The playable game is a static site hosted on GitHub Pages at the repository's project URL (`https://<owner>.github.io/<repo>/`).

## Static site constraints

- There is no application server, database, account system, external API, online multiplayer or real-money system.
- Every asset is local; there are no mandatory CDN dependencies. Fonts are system fonts.
- The site is HTML, CSS and native ES modules, with no build step. `index.html` is the entry point.
- Every URL is relative, so the site works under a repository subpath without configuration.
- ES modules need HTTP(S), so local play uses a static server. `bin/serve.mjs` is provided and contains no game logic.

## Continuous integration

A GitHub Actions workflow (`.github/workflows/pages.yml`) runs on every push, every pull request and manual dispatch:

1. **test**: runs the full test suite and a short mixed-policy simulation batch on the current Node.js LTS.
2. **build**: on `main` only, after tests pass, copies the site files (`index.html`, `styles.css`, `assets/`, `src/`) into `_site/` and uploads them as the Pages artifact.
3. **deploy**: on `main` only, deploys the artifact to the `github-pages` environment in a separate job.

Upload and deploy must stay in separate jobs, because deploying from the same job that uploaded the artifact proved unreliable. Workflow actions are kept on their latest stable major versions, so the workflow runs on current Node.js runtimes without deprecation warnings.

## Repository settings

Pages is configured with the source set to "GitHub Actions". `main` is the default branch and is allowed to deploy to the `github-pages` environment. These settings cannot be changed from the workflow, and are documented in the README.
