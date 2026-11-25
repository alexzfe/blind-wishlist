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
| `FAMILY_CODE` | (none)                   | A shared passcode. Each device asks for it once. **Strongly recommended on a public server.** Without it, anyone who finds the address can see and edit the lists. |
| `PORT`        | `3000`                   | Port to listen on. |
| `HOST`        | `0.0.0.0`                | Address to listen on. Use `127.0.0.1` when it sits behind a reverse proxy on the same machine. |
| `DATA_FILE`   | `./data/wishlists.json`  | Where the lists are saved. |

## Hosting options

### A Linux server (VPS) with systemd

1. Copy this folder to the server, for example `/opt/wishlists`.
2. Create `/etc/systemd/system/wishlists.service`:

   ```ini
   [Unit]
   Description=Family wishlists
   After=network.target

   [Service]
   WorkingDirectory=/opt/wishlists
   ExecStart=/usr/bin/node server.js
   Environment=FAMILY_CODE=pick-a-passcode
   Environment=HOST=127.0.0.1
   Restart=always
   User=www-data

   [Install]
   WantedBy=multi-user.target
   ```

3. Give the service user its data folder: `sudo mkdir -p /opt/wishlists/data && sudo chown www-data /opt/wishlists/data`
4. Start it: `sudo systemctl enable --now wishlists`

### Docker

```bash
docker build -t wishlists .
docker run -d --name wishlists --restart unless-stopped \
  -p 3000:3000 -e FAMILY_CODE="pick-a-passcode" \
  -v wishlists-data:/data wishlists
```

The `wishlists-data` volume keeps the lists when the container is rebuilt.

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

Copy `data/wishlists.json` somewhere safe now and then. To restore, stop the server, put the file back and start the server again.

## Good to know

- Nothing records who marked an item as bought. The data file does show which items are bought, so don't peek at it if you want your own gifts to stay a surprise.
- Run only **one copy** of the server per data file.
- Open pages check for other people's changes every 15 seconds.
