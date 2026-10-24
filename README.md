# Fire Res is a Myth: guild site

Everyone who opens the site sees the same roster, loot grid and catalog.
Visitors need the site password to get in. Once in they can view; only people with the officer password can edit.
There are no dependencies. You need Node 18 or newer.

## Run it

    ADMIN_PASSWORD="pick-a-long-password" node server.js

Open http://localhost:3000. Data is saved to `data/data.json`
(the previous save is kept as `data.json.bak`). Back this folder up.

Settings (environment variables):
- SITE_PASSWORD   password to enter the site at all (default: friamwinsagain, so set your own if you want a different one)
- ADMIN_PASSWORD  officer password for editing, required, at least 8 characters
- PORT            default 3000
- DATA_DIR        default ./data
- TRUST_PROXY     set to 1 when behind Caddy or nginx so login rate limits use the real visitor IP

## Put it on your domain

You need HTTPS, because the officer password is sent to the server when you log in.

### Option A: a small VPS (any Linux box with Node 18+)
1. Copy this folder to the server and start it with the command above, ideally under systemd or pm2 so it restarts.
2. Install Caddy (caddyserver.com). A Caddyfile with these two lines gives you automatic HTTPS:

       yourdomain.com {
         reverse_proxy localhost:3000
       }

3. Point your domain's A record at the server's IP address, and set TRUST_PROXY=1.

### Option B: Docker, Render, Railway or Fly.io
Use the included Dockerfile. Mount a persistent volume at `/data` or the data is lost on every deploy.
Set ADMIN_PASSWORD in the service's environment settings, then add your domain in the host's dashboard and
create the DNS record it shows you.

## Using it
- Visitors enter the site password once (remembered for 30 days on that browser), then see the data and cannot change it.
- Officers type the password into the box under the title and press Log in. The browser remembers it until you press Log out.
- The first time, if you have data in the old version of the site in that browser, press Upload this browser's saved data.
- If two officers save at the same moment, the second save is refused and that officer's screen refreshes. They just repeat the change.
- Changes from other officers show up within about 10 seconds.
