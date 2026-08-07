# Halcyon backend and website

The service behind the client badge, the online counter, the main menu message, the launcher update
feed, the cosmetics wardrobe and the public website. It is written against the Node standard
library alone, so there is nothing to install and nothing that can rot in a lockfile. State is two
json files.

## The website

The same port serves the site. On the vps that is `http://85.215.223.254:8787/`.

| Page | Who | What |
| --- | --- | --- |
| `/` | everyone | Landing page with live statistics and the latest announcements |
| `/download` | everyone | The published launcher builds, straight from the update feed |
| `/cosmetics` | everyone | The cape catalogue with real previews |
| `/status` | everyone | Online count, registrations, capes worn, uptime |
| `/register` | everyone | Account creation |
| `/login` | everyone | Sign in with username or email |
| `/account` | members | Link a Minecraft name, see owned capes, change password |
| `/admin` | admins | Announcements, cosmetics, grants, accounts, statistics |
| `/terms`, `/privacy`, `/imprint` | everyone | The legal pages |

**The first account ever registered becomes the admin.** Open the site right after deploying and
register before anyone else does. Reserve a name in advance instead by setting `ADMIN_USERNAME` in
the env file; that account is made an admin whenever it registers, no matter how many exist.

Admins are authenticated by their session cookie, so nothing in the panel needs the admin token.
The token still works for curl and for the publish script.

Passwords are stored as scrypt hashes with a per account salt, and session tokens are stored
hashed as well. The site is still plain http on the ip, so a password travels unencrypted; put
nginx and a certificate in front of it before inviting strangers.

## The api

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/v1/health` | GET | none | Liveness, uptime and the online count |
| `/v1/stats` | GET | none | Registrations, online players, cosmetics, uptime |
| `/v1/roster` | GET | none | Names of players seen within the presence window |
| `/v1/players` | GET | none | The same list with client and version detail |
| `/v1/heartbeat` | POST | client key | Announces that a player is online |
| `/v1/branding` | GET | none | Accent colour, badge glyph and menu message |
| `/v1/branding` | PUT | admin | Changes the branding without a new client build |
| `/v1/announcements` | GET | none | Messages to show in the launcher and on the site |
| `/v1/announcements` | PUT | admin | Replaces the announcement list |
| `/v1/auth/register` | POST | none | Creates an account and signs it in |
| `/v1/auth/login` | POST | none | Signs in, sets the session cookie |
| `/v1/auth/logout` | POST | session | Ends the session |
| `/v1/auth/me` | GET | none | The signed in account, or null |
| `/v1/account/overview` | GET | session | Profile, owned cosmetics, announcements |
| `/v1/account/minecraft` | POST | session | Links an in game name to the account |
| `/v1/account/password` | POST | session | Changes the password, ends every session |
| `/v1/admin/overview` | GET | admin | Statistics, accounts, cosmetics, grants, players |
| `/v1/admin/role` | POST | admin | Promotes or demotes an account |
| `/v1/admin/remove-account` | POST | admin | Deletes an account |
| `/v1/updates` | GET | none | The launcher update feed and the files behind it |
| `/v1/updates/<file>` | GET | none | Downloads one update artifact |
| `/v1/updates/<file>` | PUT, DELETE | admin | Publishes or removes an artifact |
| `/v1/cosmetics` | GET | none | The cape catalogue |
| `/v1/cosmetics` | PUT | admin | Creates or edits a cape |
| `/v1/cosmetics/<id>` | DELETE | admin | Removes a cape and revokes it everywhere |
| `/v1/cosmetics/grant` | POST | admin | Gives a cape to a player |
| `/v1/cosmetics/revoke` | POST | admin | Takes a cape back |
| `/v1/cosmetics/player/<name>` | GET | none | What one player owns and wears |
| `/v1/cosmetics/equip` | POST | client key | The player chooses what to wear |
| `/v1/cosmetics/worn` | GET | none | What every online player is wearing |
| `/v1/cosmetics/textures/<file>` | GET | none | The cape image itself |
| `/v1/cosmetics/textures/<file>` | PUT, DELETE | admin | Uploads or removes a cape image |

"admin" means either an `Authorization: Bearer <ADMIN_TOKEN>` header or a signed in admin session.

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
installs Node 22 if it is missing, creates a `halcyon` system user, copies the service and the
website to `/opt/halcyon-backend`, generates an admin token into `/etc/halcyon-backend.env` and
starts a systemd unit. It prints the admin token once; store it somewhere safe.

Check it:

```bash
curl http://127.0.0.1:8787/v1/health
sudo journalctl -u halcyon-backend -f
```

## Update to a newer version

`/opt/halcyon-backend` is a copy the installer makes, not a git checkout, so `git pull` does not
work there. Pull inside the clone and run the installer again; it copies the new source and the new
website over the installed ones and restarts the unit:

```bash
cd ~/YugiClient
git pull
sudo bash server/deploy/install.sh
```

The env file is never overwritten, so the admin token, the client key, the accounts and the stored
state all survive an update. If you no longer have the clone, make one anywhere and run the same
command; the only thing that matters is that `server/deploy/install.sh` is run from the repository.

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

This is plain http, so the client key and any password typed on the site travel unencrypted. For a
cosmetic roster that is an acceptable trade; for accounts it is not, so point a domain at the
machine and use the nginx setup below once real people sign up.

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

The easy way is the admin panel: sign in, open `/admin`, fill in the id, the name and the rarity,
pick the png and press publish, then type a player name and press grant.

By hand it looks like this. Read the token once with
`sudo grep ADMIN_TOKEN /etc/halcyon-backend.env`.

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

Cosmetics are given out by the admin and by nobody else. A player can only wear what was granted to
them: the equip endpoint refuses an id the player does not own, so a patched client cannot dress
itself.

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

The launcher reads `http://85.215.223.254:8787/v1/updates` by default, and the same files show up
on `/download`. Set `HALCYON_UPDATE_URL` to another feed root to override it, or to `github` to go
back to the GitHub releases feed.

## Change the branding live

```bash
curl -X PUT https://your.domain/v1/branding \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"menuMessage":"Season two starts friday","accentColor":"#8B7CF6"}'
```

The next time a client syncs, the new message appears under the wordmark on the main menu.

## Configuration

Every setting is an environment variable in `/etc/halcyon-backend.env`; see `.env.example`.

| Variable | Meaning |
| --- | --- |
| `HOST`, `PORT` | Bind address. `127.0.0.1` behind nginx, `0.0.0.0` on the bare ip |
| `DATA_FILE` | Presence, branding, announcements and cosmetics |
| `ACCOUNT_FILE` | Website accounts and sessions, defaults beside `DATA_FILE` |
| `UPDATE_DIR` | Launcher artifacts, created at startup |
| `COSMETIC_DIR` | Cape images, created at startup |
| `PUBLIC_DIR` | The website files, `/opt/halcyon-backend/public` after an install |
| `ADMIN_USERNAME` | Optional. This username becomes an admin when it registers |
| `ADMIN_TOKEN` | Bearer token for curl and the publish script |
| `CLIENT_KEY` | Optional shared secret the game has to send |
| `PRESENCE_TTL_SECONDS` | How long a heartbeat counts as online |
| `RETENTION_DAYS` | How long an offline player is remembered |

## Notes on trust

Heartbeats and equip calls are self reported: a player name means "something claimed this name",
not "this account is verified". Ownership itself is held on the server, so a client cannot invent a
cape, but it could claim someone else's name. That is fine for cosmetics. If it ever gates
something that matters, the call needs to carry a Minecraft session token that the server validates
against Mojang, which is a deliberate next step rather than an oversight.

Sign in attempts are rate limited to a dozen a minute per address, and the api as a whole to 240,
while page views, cape images and installer downloads are not counted at all.
