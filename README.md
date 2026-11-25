# Family Christmas Wishlists

A small self-hosted site where your family keeps Christmas wishlists and marks gifts as bought, without revealing who bought them. Your own list never shows what's been bought.

- Needs only **Node.js 18 or newer**. There's nothing to `npm install`.
- Everything is saved to one file, `data/wishlists.json`.

## Run it

```bash
FAMILY_CODE="pick-a-passcode" node server.js
```

Then open http://localhost:3000.

## Settings

All settings are optional environment variables.

| Variable      | Default                  | What it does |
|---------------|--------------------------|--------------|
| `FAMILY_CODE` | (none)                   | A shared passcode. Each device asks for it once. **Strongly recommended on a public server.** Without it, anyone who finds the address can see and edit the lists. Pick a few random words (like `maple-sled-cocoa-42`), not a short PIN: after 10 wrong tries an address is locked out for 10 minutes, but someone with many addresses can keep guessing. |
| `PORT`        | `3000`                   | Port to listen on. |
| `HOST`        | `0.0.0.0`                | Address to listen on. Use `127.0.0.1` when it sits behind a reverse proxy on the same machine. |
| `DATA_FILE`   | `./data/wishlists.json`  | Where the lists are saved. |

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

The `christmaswishlist-data` volume keeps the lists when the container is rebuilt.

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

## Good to know

- Behind a reverse proxy (Caddy, nginx) the server reads the visitor's address from the end of `X-Forwarded-For`, but only for requests coming from this machine or a private network. Make sure your proxy sets that header; Caddy does by default.

- Nothing records who marked an item as bought. The data file does show which items are bought, so don't peek at it if you want your own gifts to stay a surprise.
- Run only **one copy** of the server per data file.
- Open pages check for other people's changes every 15 seconds.
