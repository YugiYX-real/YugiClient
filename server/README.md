# Halcyon backend

The service behind the client badge, the online counter and the main menu message. It is written
against the Node standard library alone, so there is nothing to install and nothing that can rot in
a lockfile. State is a single json file.

## What it does

| Endpoint            | Method | Auth        | Purpose                                          |
| ------------------- | ------ | ----------- | ------------------------------------------------ |
| `/v1/health`        | GET    | none        | Liveness, uptime and the online count            |
| `/v1/roster`        | GET    | none        | Names of players seen within the presence window |
| `/v1/players`       | GET    | none        | The same list with client and version detail     |
| `/v1/heartbeat`     | POST   | client key  | Announces that a player is online                |
| `/v1/branding`      | GET    | none        | Accent colour, badge glyph and menu message      |
| `/v1/branding`      | PUT    | admin token | Changes the branding without a new client build  |
| `/v1/announcements` | GET    | none        | Messages to show in the launcher                 |
| `/v1/announcements` | PUT    | admin token | Replaces the announcement list                   |

The companion mod calls `/v1/heartbeat`, `/v1/roster` and `/v1/branding` once a minute. Every call
is asynchronous and every failure is ignored, so the backend going down never affects the game.

## Install on Ubuntu 24.04

```bash
git clone https://github.com/YugiYX-real/YugiClient.git
cd YugiClient
sudo bash server/deploy/install.sh
```

The script installs Node 22 if it is missing, creates a `halcyon` system user, copies the service to
`/opt/halcyon-backend`, generates an admin token into `/etc/halcyon-backend.env` and starts a
systemd unit. It prints the admin token once; store it somewhere safe.

Check it:

```bash
curl http://127.0.0.1:8787/v1/health
sudo journalctl -u halcyon-backend -f
```

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
adding themselves to the roster.

## Notes on trust

Heartbeats are self reported: a player name in the roster means "something claimed this name", not
"this account is verified". That is fine for a cosmetic badge. If the badge ever gates something
that matters, the heartbeat needs to carry a Minecraft session token that the server validates
against Mojang, which is a deliberate next step rather than an oversight.
