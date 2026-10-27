@README.md

## Working Here

- **Identify users by numeric ID**, never by login.
- **Request no scopes and keep no GitHub token**: Kemian needs the identity, not access to the user's GitHub.
- Keep `baseUrl`, `apiBaseUrl`, and `fetch` injectable: the unit tests stub `fetch`, and the demo's end-to-end tests point the URLs at a local fake GitHub.
