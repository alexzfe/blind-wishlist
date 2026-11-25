# Family Christmas Wishlists

A small self-hosted site where your family keeps Christmas wishlists and marks gifts as bought, without revealing who bought them. Your own list never shows what's been bought.

- Needs only **Node.js 22 or newer**. There's nothing to `npm install`.
- Everything is saved to one file, `data/wishlists.json`.
- Made for phones and tablets as much as computers. "Add to Home Screen" gives it a "Wishlists" icon.
- Self-contained: the page loads its fonts, icon and script from this server only.

## Run it

```bash
FAMILY_CODE="pick-a-passcode" node server.js
```

(`npm start` does the same.) Then open http://localhost:3000.

## Who's who

Each phone, tablet or computer remembers who is using it. The first time someone opens the lists there, after the passcode, a full-screen "Who are you?" asks them to tap their name or write a new one, and to confirm it. It can't be skipped. Writing a name that's already on the list picks that person instead of adding a twin. The top of the page always says who they are, with a "Not Sam? Switch" button to change it (or go back). Purchases are hidden from your own list, so being signed in as the right person matters.

### Personal links (optional)

To spare someone the "Who are you?" step, tap the link icon on their card and send them the link it shows. The first device to open it is signed in as that person. Then the link stops working, so a forwarded copy can't sign anyone else in. If the wrong person opens it first, the right person sees "already used" and can tap their name or ask for a new link. A device that already knows who it is ignores personal links, so a link opened there by mistake stays unused.

The link doesn't include the family passcode, so they still enter that once. Until a link is used, the button keeps showing the same one, and after it's used the button makes a new one. Opening a link in a chat app's preview doesn't use it up.

## Settings

All settings are optional environment variables.

| Variable      | Default                  | What it does |
|---------------|--------------------------|--------------|
| `FAMILY_CODE` | (none)                   | A shared passcode. Each device asks for it once. **Strongly recommended on a public server.** Without it, anyone who finds the address can see and edit the lists. Pick a few random words (like `maple-sled-cocoa-42`), not a short PIN: after 10 wrong tries an address is locked out for 10 minutes, but someone with many addresses can keep guessing. |
| `PORT`        | `3000`                   | Port to listen on. |
| `HOST`        | `0.0.0.0`                | Address to listen on. Use `127.0.0.1` when it sits behind a reverse proxy on the same machine. |
| `DATA_FILE`   | `./data/wishlists.json`  | Where the lists are saved. |
| `NODE_ENV`    | (none)                   | Set to `production` and the server refuses to start without `FAMILY_CODE`, so a missing passcode fails loudly instead of opening the lists to anyone. The Docker image sets this. |

## Hosting options

### A Linux server (VPS) with systemd

1. Copy this folder to the server, for example `/opt/christmaswishlist`.
2. Create `/etc/systemd/system/christmaswishlist.service`:

   ```ini
   [Unit]
   Description=Family wishlists
   After=network.target

   [Service]
   WorkingDirectory=/opt/christmaswishlist
   ExecStart=/usr/bin/node server.js
   Environment=FAMILY_CODE=pick-a-passcode
   Environment=HOST=127.0.0.1
   Restart=always
   User=www-data

   [Install]
   WantedBy=multi-user.target
   ```

3. Give the service user its data folder: `sudo mkdir -p /opt/christmaswishlist/data && sudo chown www-data /opt/christmaswishlist/data`
4. Start it: `sudo systemctl enable --now christmaswishlist`

### Docker

```bash
docker build -t christmaswishlist .
docker run -d --name christmaswishlist --restart unless-stopped \
  -p 3000:3000 -e FAMILY_CODE="pick-a-passcode" \
  -v christmaswishlist-data:/data christmaswishlist
```

The `christmaswishlist-data` volume keeps the lists when the container is rebuilt. The image runs in production mode, so it won't start without `FAMILY_CODE`.

### Platforms like Render, Railway or Fly.io

Point the platform at this folder (or the Dockerfile). Set `FAMILY_CODE`, and attach a **persistent disk/volume** with `DATA_FILE` set to a path on it (for example `/data/wishlists.json`). Without a persistent disk, the lists are wiped on each redeploy.

## HTTPS

Put it behind HTTPS so the passcode isn't sent in the clear. The easiest way is [Caddy](https://caddyserver.com), which gets certificates automatically. A whole `Caddyfile`:

```
wishlist.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

## Backups

Before the first change each day, the server copies the lists to `data/backups/wishlists-YYYY-MM-DD.json` and keeps the last 14 days. These copies sit on the same disk, so for real safety also copy the `data` folder somewhere else now and then.

To restore, stop the server, copy the backup you want over `data/wishlists.json` and start the server again.

In Docker the lists live in the `/data` volume, so restore inside it, and keep the files owned by the `node` user (uid 1000) or saves will fail. For example, for a volume named `wishlist-prod-data`:

```bash
docker compose stop
docker run --rm -v wishlist-prod-data:/data alpine sh -c 'cp /data/backups/wishlists-YYYY-MM-DD.json /data/wishlists.json && chown 1000:1000 /data/wishlists.json'
docker compose start
```

To roll back the app itself (not the data), deploy an older release again: every build keeps its image, so tagging an older commit as a new `v*` release puts it back without rebuilding.

## Tests

`npm test` runs the server tests (no browser needed). `npm run test:e2e` runs the browser tests, including small phone, phone and tablet screens held both ways: the first time, it installs Playwright into a git-ignored `.playwright/` folder (it isn't a project dependency), and it uses the system Chromium at `/usr/bin/chromium` (set `CHROME=/path/to/browser` for another one). CI runs `npm test` only, so run the browser tests yourself before a release.

## Releases

`.github/workflows/release.yml` deploys this copy to its own server:

- A pull request runs `npm test`.
- A merge to `main` runs the tests, builds a Docker image tagged with the commit, and deploys it to staging.
- Pushing a `v*` tag (for example `git tag v1.2.0 && git push origin v1.2.0`) deploys the image already built for that commit to production and creates a GitHub Release. Production never rebuilds, so tag a commit that staging has already run.

If you host it yourself some other way, ignore this file.

## Good to know

- Behind a reverse proxy (Caddy, nginx) the server reads the visitor's address from the end of `X-Forwarded-For`, but only for requests coming from this machine or a private network. Make sure your proxy sets that header; Caddy does by default.
- Nothing records who marked an item as bought. The data file does show which items are bought, so don't peek at it if you want your own gifts to stay a surprise.
- The data file also holds any personal links not used yet, so keep it (and the backups) private.
- Run only **one copy** of the server per data file.
- Open pages check for other people's changes every 15 seconds, and when you come back to the tab.
