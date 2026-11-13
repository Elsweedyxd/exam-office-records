# Deploying Exam Office Records to a server and your own domain

You need two things, both of which the brief suggests:

| What | Where from | Cost (check current prices) |
|---|---|---|
| **Server** (a Linux "droplet") | **DigitalOcean** – https://www.digitalocean.com | Basic droplet, a few US$ a month. Students: the **GitHub Student Developer Pack** (https://education.github.com/pack) has historically included DigitalOcean credit. |
| **Domain name** | **Namecheap** – https://www.namecheap.com | Many domains are a few US$ for the first year. The Student Pack has historically included a free `.me` domain from Namecheap for a year. |

Alternatives that work the same way: Hetzner, Linode/Akamai, AWS Lightsail (servers); Porkbun, Cloudflare Registrar (domains).

**Two ways to deploy – pick one:**

- **Option A – DigitalOcean droplet** (steps 1–7 below): you set up the Linux server yourself.
- **Option B – Render** ([jump to Option B](#option-b-deploy-on-render)): no Linux commands; Render runs the server and HTTPS for you. Needs a **paid** instance with a disk.

The finished setup:

```
Browser ──https──▶ your-domain.com ──DNS A record──▶ Droplet IP
                                                 └─ Nginx (port 80/443, HTTPS certificate)
                                                      └─ Node.js app (port 3000, run by systemd)
                                                           └─ SQLite file /var/lib/exam-office/exam-office.db
```

---

# Option A: DigitalOcean droplet

## 1. Create the droplet (≈10 minutes)

1. Sign up at DigitalOcean (apply your Student Pack credit if you have it).
2. **Create → Droplets**
   - Image: **Ubuntu 24.04 LTS**
   - Size: **Basic, Regular, the smallest plan** (1 GB RAM is plenty)
   - Region: closest to your users (e.g. London or Frankfurt)
   - Authentication: **SSH key** (recommended) or a strong root password
3. Create it and copy its **public IPv4 address**, e.g. `203.0.113.25`.

## 2. Register the domain and point it at the droplet (≈10 minutes + DNS wait)

1. On Namecheap, search for and buy a domain, e.g. `examoffice-yourname.me`.
2. Go to **Domain List → Manage → Advanced DNS** and add:

   | Type | Host | Value | TTL |
   |---|---|---|---|
   | A Record | `@` | `203.0.113.25` (your droplet IP) | Automatic |
   | A Record | `www` | `203.0.113.25` | Automatic |

   Delete any default "parking page" records.
3. Wait for DNS (usually 5–30 minutes). Check with `ping examoffice-yourname.me` – it should show your droplet's IP.

## 3. Prepare the server

Connect from your laptop (Windows: PowerShell or Windows Terminal):

```bash
ssh root@203.0.113.25
```

Then run:

```bash
apt update && apt upgrade -y
# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs nginx unzip
# Firewall: allow SSH and web traffic only
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
# A dedicated user to run the app (not root) and a folder for the database
useradd --system --create-home --shell /usr/sbin/nologin examoffice
mkdir -p /var/lib/exam-office && chown examoffice:examoffice /var/lib/exam-office
```

## 4. Upload the app

From **your laptop**, in the folder that contains `exam-office.zip`:

```bash
scp exam-office.zip root@203.0.113.25:/opt/
```

Back on the **server**:

```bash
cd /opt && unzip -o exam-office.zip && cd exam-office
rm -rf node_modules data        # build modules for the server, start with a fresh database
npm ci --omit=dev
chown -R examoffice:examoffice /opt/exam-office
```

(Or use Git: push the project to a private GitHub repo and `git clone` it into `/opt/exam-office`.)

## 5. Run it permanently with systemd

Create `/etc/systemd/system/exam-office.service`:

```bash
nano /etc/systemd/system/exam-office.service
```

```ini
[Unit]
Description=Exam Office Records
After=network.target

[Service]
User=examoffice
WorkingDirectory=/opt/exam-office
ExecStart=/usr/bin/node --no-warnings=ExperimentalWarning server.js
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DATA_DIR=/var/lib/exam-office
Environment=ADMIN_CODE=change-this-to-your-own-secret
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now exam-office
systemctl status exam-office          # should say "active (running)"
curl -I http://localhost:3000/login   # should return 200
```

> If you change `ADMIN_CODE`, also update the "Demo code" hint in `views/signup.html`, or remove it.

## 6. Put Nginx in front (port 80 → 3000)

```bash
nano /etc/nginx/sites-available/exam-office
```

```nginx
server {
    listen 80;
    server_name examoffice-yourname.me www.examoffice-yourname.me;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/exam-office /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

Visit `http://examoffice-yourname.me` – the sign-in page should appear.

## 7. Turn on HTTPS (free, automatic renewal)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d examoffice-yourname.me -d www.examoffice-yourname.me --redirect -m you@example.com --agree-tos -n
```

Now `https://examoffice-yourname.me` works with a padlock, and the login cookie is automatically marked `Secure`.
**This is the live URL to put in your submission.**

---

## Updating the site later

```bash
scp exam-office.zip root@203.0.113.25:/opt/
ssh root@203.0.113.25
cd /opt && unzip -o exam-office.zip -x 'exam-office/data/*' 'exam-office/node_modules/*'
cd exam-office && npm ci --omit=dev && chown -R examoffice:examoffice . && systemctl restart exam-office
```

The database in `/var/lib/exam-office/` is untouched by updates.

## Backups

The whole database is one file. To copy it to your laptop:

```bash
scp root@203.0.113.25:/var/lib/exam-office/exam-office.db ./backup-exam-office.db
```

Or enable DigitalOcean's weekly droplet backups in the control panel.

## Troubleshooting

| Symptom | Check |
|---|---|
| Domain doesn't load | `ping your-domain` shows the droplet IP? DNS can take up to 24 h. |
| "502 Bad Gateway" | App not running: `journalctl -u exam-office -n 50` |
| Certbot fails | DNS must already point to the droplet, and port 80 must be open (`ufw status`). |
| `No such built-in module: node:sqlite` | Node is too old. Check `node -v` is 22.13 or newer. |

---

# Option B: Deploy on Render

Render (https://render.com) runs the Node.js app for you and gives it HTTPS. You don't need any Linux commands.

> **Important: use a paid instance with a persistent disk, not the free plan.**
> On Render's free plan the filesystem is *ephemeral*: local files, including SQLite databases, are deleted
> every time the service restarts, redeploys or "spins down" (which happens after 15 minutes with no visitors).
> All students, marks and accounts would keep resetting to the demo data, so the site would fail the brief's
> "data should persist" requirement. A persistent disk is only available on paid instances.
> See https://render.com/docs/free and https://render.com/docs/disks. Check current prices on Render's pricing page.

What the setup looks like:

```
Browser ──https──▶ your-domain.com ──DNS──▶ Render web service (runs npm start)
                                                └─ Persistent disk mounted at /var/data
                                                     └─ SQLite file /var/data/exam-office.db
```

## B1. Put the project on GitHub

Render deploys from a GitHub repository.

**Easiest way (no Git needed):**

1. Create a free account at https://github.com and click **New repository**.
   Name it e.g. `exam-office-records`, choose **Private**, and click **Create repository**.
2. On the new repository page click **uploading an existing file**.
3. Open the `exam-office` folder on your computer (the one that contains `server.js`).
   Select **everything inside it except** the `node_modules` and `data` folders, and drag it into the browser.
4. Click **Commit changes**.

**Or with Git**, from inside the project folder:

```bash
git init
git add .
git commit -m "Exam Office Records"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/exam-office-records.git
git push -u origin main
```

The included `.gitignore` file keeps `node_modules/` and the local database (`data/`) out of GitHub.

## B2. Create the web service

1. Sign up at https://render.com (you can sign in with GitHub).
2. Click **New → Web Service** and pick your `exam-office-records` repository.
3. Fill in:

   | Setting | Value |
   |---|---|
   | Name | `exam-office-records` (this becomes `exam-office-records.onrender.com`) |
   | Language / Runtime | Node |
   | Branch | `main` |
   | Root Directory | leave empty (unless `server.js` is inside a subfolder in your repo, then enter that folder name) |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Instance Type | the cheapest **paid** instance (not Free) |

4. Open **Advanced** and click **Add Disk**:

   | Setting | Value |
   |---|---|
   | Name | `data` |
   | Mount Path | `/var/data` |
   | Size | 1 GB (plenty: the database is tiny) |

5. Still under **Advanced**, add these **Environment Variables**:

   | Key | Value | Why |
   |---|---|---|
   | `DATA_DIR` | `/var/data` | Tells the app to save the database on the persistent disk |
   | `ADMIN_CODE` | a secret of your own, e.g. `Exams-7Kq2-Admin` | The code needed to sign up as an Administrator |
   | `NODE_VERSION` | `22` | Uses Node 22, which has the built-in SQLite the app needs |

   You don't need to set `PORT`: Render provides it and the app already reads it.

6. Optional: under **Health Check Path**, enter `/login`.
7. Click **Create Web Service**. The first deploy takes a few minutes. When the log shows
   `Exam Office Records running on http://localhost:...`, open `https://exam-office-records.onrender.com`.
   It should show the sign-in page, and you can sign in with the demo accounts.

> If you change `ADMIN_CODE`, also update or remove the "Demo code" hint in `views/signup.html`.

## B3. Check the data really persists

1. Sign in, add a test student, and enter a mark for them.
2. In Render, click **Manual Deploy → Deploy latest commit** (or **Restart service**).
3. When it is live again, search for your test student. If they are still there, the disk is working.
   If the data has gone back to the demo data, check that the disk's mount path and `DATA_DIR` are both exactly `/var/data`.

## B4. Connect your own domain

1. Buy a domain at Namecheap (see the table at the top of this file).
2. In Render, open your service → **Settings → Custom Domains → Add Custom Domain**. Add both
   `your-domain.com` and `www.your-domain.com`.
3. Render shows which DNS records to create. They are usually:

   | Type | Host | Value |
   |---|---|---|
   | A Record | `@` | the IP address Render shows you |
   | CNAME Record | `www` | `exam-office-records.onrender.com` |

   In Namecheap go to **Domain List → Manage → Advanced DNS**, delete the default parking records, and add the records **exactly as Render shows them**.
4. Back in Render, click **Verify**. Once DNS has updated (minutes, sometimes a few hours), Render issues
   the HTTPS certificate automatically.
5. `https://your-domain.com` now opens your app. **That is the live URL for your submission.**

## Updating the site on Render

- **Uploaded through the GitHub website:** upload the changed files to the repository again and commit.
- **Using Git:** `git add . && git commit -m "Update" && git push`

Render redeploys automatically. The database on the disk is kept.

## Backups on Render

Check the service's **Disks** page in Render for its snapshot and restore options (see https://render.com/docs/disks).
To check the database file is there, open the service's **Shell** tab and run `ls -la /var/data`.
The "Download CSV" button on the Marks records page is also a quick way to export every mark.

## Render troubleshooting

| Symptom | Check |
|---|---|
| Build fails: `No such built-in module: node:sqlite` | Set the environment variable `NODE_VERSION` to `22` (or newer) and redeploy. |
| Data resets to the demo data | The service is on the Free plan, or `DATA_DIR` doesn't match the disk's mount path (`/var/data`). |
| "Cannot find module" / `package.json` not found | `server.js` is in a subfolder of the repo. Set **Root Directory** to that folder. |
| Site loads slowly the first time | Normal for the first request after a deploy. Paid instances don't spin down. |
| Custom domain stuck on "Pending" | Make sure the Namecheap records match Render's exactly, and remove the old parking records. Then wait and click Verify again. |
