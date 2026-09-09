# Project instructions

When the user says "deploy", complete the full release workflow:

1. Bump the patch version in `manifest.json` and `package.json`.
2. Run the test suite.
3. Build `x-goals-release.zip` from the extension runtime files and copy it to `docs/x-goals-release.zip`.
4. Commit all release changes, including the website ZIP.
5. Push `main` to `origin` so GitHub Pages publishes the new ZIP at `https://xgoals.top/x-goals-release.zip`.
6. Verify the deployed site and ZIP version.
