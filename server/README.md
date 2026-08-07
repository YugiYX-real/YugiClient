# Halcyon backend

The service behind the client badge, the online counter, the main menu message, the launcher update
feed and the cosmetics wardrobe. It is written against the Node standard library alone, so there is
nothing to install and nothing that can rot in a lockfile. State is a single json file.

## What it does

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/v1/health` | GET | none | Liveness, uptime and the online count |
| `/v1/roster` | GET | none | Names of players seen within the presence window |
| `/v1/players` | GET | none | The same list with client and version detail |
| `/v1/heartbeat` | POST | client key | Announces that a player is online |
| `/v1/branding` | GET | none | Accent colour, badge glyph and menu message |
| `/v1/branding` | PUT | admin token | Changes the branding without a new client build |
| `/v1/announcements` | GET | none | Messages to show in the launcher |
| `/v1/announcements` | PUT | admin token | Replaces the announcement list |
| `/v1/updates` | GET | none | The launcher update feed and the files behind it |
| `/v1/updates/<file>` | GET | none | Downloads one update artifact |
| `/v1/updates/<file>` | PUT, DELETE | admin token | Publishes or removes an artifact |
| `/v1/cosmetics` | GET | none | The cape catalogue |
| `/v1/cosmetics` | PUT | admin token | Creates or edits a cape |
| `/v1/cosmetics/<id>` | DELETE | admin token | Removes a cape and revokes it everywhere |
| `/v1/cosmetics/grant` | POST | admin token | Gives a cape to a player |
| `/v1/cosmetics/revoke` | POST | admin token | Takes a cape back |
| `/v1/cosmetics/player/<name>` | GET | none | What one player owns and wears |
| `/v1/cosmetics/equip` | POST | client key | The player chooses what to wear |
| `/v1/cosmetics/worn` | GET | none | What every online player is wearing |
| `/v1/cosmetics/textures/<file>` | GET | none | The cape image itself |
| `/v1/cosmetics/textures/<file>` | PUT, DELETE | admin token | Uploads or removes a cape image |

The companion mod calls `/v1/heartbeat`, `/v1/roster`, `/v1/branding` and the cosmetics endpoints
once a minute. Every call is asynchronous and every failure is ignored, so the backend going down
never affects the game.

## Install on Ubuntu 24.04

```bash
git clone https://github.com/YugiYX-real/YugiClient.git
cd YugiClient
sudo bash server/deploy/install.sh
```

The repository is called `YugiClient`; the backend is the `server/` folder inside it. The script
installs Node 22 if it is missing, creates a `halcyon` system user, copies the service to
`/opt/halcyon-backend`, generates an admin token into `/etc/halcyon-backend.env` and starts a
systemd unit. It prints the admin token once; store it somewhere safe.

Check it:

```bash
curl http://127.0.0.1:8787/v1/health
sudo journalctl -u halcyon-backend -f
```

## Update to a newer version

`/opt/halcyon-backend` is a copy the installer makes, not a git checkout, so `git pull` does not
work there. Pull inside the clone and run the installer again; it copies the new source over the
installed one and restarts the unit:

```bash
cd ~/YugiClient
git pull
sudo bash server/deploy/install.sh
```

The env file is never overwritten, so the admin token, the client key and the stored state all
survive an update. If you no longer have the clone, make one anywhere and run the same command; the
only thing that matters is that `server/deploy/install.sh` is run from the repository.

## It runs on its own

The backend is a systemd service, not a process attached to your shell. It starts at boot, it is
restarted within three seconds if it ever crashes, and closing the ssh or PuTTY session does not
touch it. Nothing needs to stay open.

```bash
systemctl status halcyon-backend    # is it running
systemctl restart halcyon-backend   # after editing the env file
systemctl disable --now halcyon-backend  # stop it for good
```

## Serve it on the plain ip

The installer binds to loopback, so the address of the machine does not answer yet. One command
changes that:

```bash
sudo bash server/deploy/expose.sh
```

It rebinds the service to every interface, generates a client key if there is none, opens the port
in ufw when ufw is active, restarts the unit and prints the exact two lines to paste into the game
config. If the vps sits behind a provider firewall, allow tcp 8787 there as well.

This is plain http, so the client key travels unencrypted and anyone who watches the traffic can
read it. For a cosmetic roster that is an acceptable trade. Point a domain at the machine and use
the nginx setup below once you care.

## Expose it over https

Put nginx in front of the loopback service so the traffic is encrypted:

```bash
sudo apt install nginx certbot python3-certbot-nginx
sudo cp server/deploy/nginx-halcyon.conf /etc/nginx/sites-available/halcyon
sudo sed -i "s/halcyon.example.com/your.domain/" /etc/nginx/sites-available/halcyon
sudo ln -s /etc/nginx/sites-available/halcyon /etc/nginx/sites-enabled/halcyon
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your.domain
sudo ufw allow "Nginx Full"
```

With nginx in front, set `HOST=127.0.0.1` again in `/etc/halcyon-backend.env` and close the direct
port: `sudo ufw delete allow 8787/tcp`.

## Point the game at it

Edit `config/halcyon-companion.json` inside the instance:

```json
{
	"backendUrl": "http://85.215.223.254:8787",
	"backendKey": "the client key printed by expose.sh",
	"badgeAllPlayers": false
}
```

With a backend configured the roster is real, so `badgeAllPlayers` can go back to `false` and the
badge once again means "this player runs Halcyon".

## Hand out a cape

Cosmetics are given out by the admin and by nobody else. A player can only wear what was granted to
them: the equip endpoint refuses an id the player does not own, so a patched client cannot dress
itself. Read the token once with `sudo grep ADMIN_TOKEN /etc/halcyon-backend.env`.

```bash
TOKEN=your_admin_token
BASE=http://85.215.223.254:8787

# 1. upload the image, a 64x32 or 64x64 cape sheet
curl -X PUT --data-binary @aurora.png \
  -H "authorization: Bearer $TOKEN" \
  "$BASE/v1/cosmetics/textures/aurora.png"

# 2. put it in the catalogue
curl -X PUT "$BASE/v1/cosmetics" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"id":"aurora","name":"Aurora","rarity":"legendary","description":"Founder cape"}'

# 3. give it to a player
curl -X POST "$BASE/v1/cosmetics/grant" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"name":"YugiYX","id":"aurora"}'
```

The id is derived from the file name by convention only; a cape may carry an explicit `texture`
instead, either a path on this server or a full url. Take a cape back with `/v1/cosmetics/revoke`
and the same body, or delete it entirely with `curl -X DELETE -H "authorization: Bearer $TOKEN"
"$BASE/v1/cosmetics/aurora"`, which also strips it from everyone who owned it.

In game the wardrobe is the **Cosmetics** button along the bottom of the main menu, or right shift
followed by Cosmetics. Only granted capes are listed.

## Publish a launcher update

Build the launcher locally, then push the artifacts and the `latest.yml` beside them:

```bash
npm run build
npx electron-builder --win --publish never
HALCYON_BACKEND_URL=http://85.215.223.254:8787 HALCYON_ADMIN_TOKEN=$TOKEN \
  node scripts/publish-backend.mjs
```

The launcher reads `http://85.215.223.254:8787/v1/updates` by default. Set `HALCYON_UPDATE_URL` to
another feed root to override it, or to `github` to go back to the GitHub releases feed.

## Change the branding live

```bash
curl -X PUT https://your.domain/v1/branding \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"menuMessage":"Season two starts friday","accentColor":"#8B7CF6"}'
```

The next time a client syncs, the new message appears under the wordmark on the main menu.

## Configuration

Every setting is an environment variable in `/etc/halcyon-backend.env`; see `.env.example`. The two
that matter most are `ADMIN_TOKEN`, without which the write endpoints stay disabled, and
`CLIENT_KEY`, which turns the heartbeat into an authenticated call if you do not want strangers
adding themselves to the roster. `UPDATE_DIR` and `COSMETIC_DIR` decide where artifacts and cape
images live; both default to folders beside `DATA_FILE` and are created at startup.

## Notes on trust

Heartbeats and equip calls are self reported: a player name means "something claimed this name",
not "this account is verified". Ownership itself is held on the server, so a client cannot invent a
cape, but it could claim someone else's name. That is fine for cosmetics. If it ever gates
something that matters, the call needs to carry a Minecraft session token that the server validates
against Mojang, which is a deliberate next step rather than an oversight.
