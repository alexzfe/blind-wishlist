# Family Christmas Wishlists

The name of the game is **simple**. This is a small family app that one person hosts and maintains. Keep it small enough to read in one sitting, and every change should leave it at least as simple as it was.

What simple means here:

- **No packages.** It runs on Node.js 22+ and its standard library alone. Use `node:test` for tests. Use a browser tool such as Playwright only as a test-time tool, outside `package.json` dependencies.
- **No build step.** `public/` is served exactly as written: plain HTML, CSS and JavaScript.
- **One process, one JSON file.** Storage stays `data/wishlists.json`.
- **Self-contained.** The page loads fonts, images and scripts from this server only, with no outside calls.
- **Family trust.** One shared passcode guards the whole site. Everyone with it can still change everything through the server, and that's intended. To avoid accidents, the page hides renaming and removing people, and adding or editing wishes on other people's lists, unless admin mode is on (5 taps on "Nobody").

When a fix or feature has a simple version and a thorough one, build the simple one and mention the thorough one to the user. If something can't be done without a package, a build step, a database or a new service, stop and ask before adding it.
