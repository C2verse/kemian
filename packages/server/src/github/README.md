# GitHub

Signs people in with GitHub. `githubSignIn(options)` returns a `SignInProvider` that sends the browser to a GitHub OAuth app with PKCE, exchanges the callback code, reads the user, and returns the identity `github:<numeric user ID>`, with the login as its name.

GitHub only proves who the user is: no scopes are requested, and GitHub's token is discarded once the user is read. Numeric IDs are used because logins can be renamed and then claimed by someone else.

## Public Surface

- **`githubSignIn(options)`** with `GitHubSignInOptions`: the OAuth app's `clientId` and `clientSecret`, and optional `baseUrl`, `apiBaseUrl`, and `fetch` for GitHub Enterprise or tests.

## Files

| File         | Contents       |
| ------------ | -------------- |
| `sign-in.ts` | `githubSignIn` |

## Status

**working.** Tested against a fake GitHub, and signed in against github.com from the deployed demo. Refusing a github.com account without a level is tested only against the fake.
