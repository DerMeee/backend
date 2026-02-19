# Nginx Setup for www.dermee.dz

Your app runs in Docker on port 3000, but:
- **www.dermee.dz** serves the default Nginx page (port 80)
- **Port 3000** is likely blocked by the VPS firewall (only 80/443 open for web traffic)
- Nginx must proxy requests to your NestJS app

## Steps on your VPS (via SSH)

### 1. Ensure Docker is running with your app
```bash
cd /path/to/your/backend   # wherever you deployed
docker compose ps          # verify api + postgres are running
```

### 2. Install Nginx (if not already)
```bash
sudo apt update
sudo apt install nginx -y
```

### 3. Deploy the Nginx config
Copy `nginx/dermee.conf` to your VPS, then:

**Option A – sites-available (Debian/Ubuntu):**
```bash
sudo cp nginx/dermee.conf /etc/nginx/sites-available/dermee.conf
sudo ln -sf /etc/nginx/sites-available/dermee.conf /etc/nginx/sites-enabled/
```

**Option B – conf.d (CentOS/AlmaLinux):**
```bash
sudo cp nginx/dermee.conf /etc/nginx/conf.d/dermee.conf
```

### 4. Disable the default site (so Nginx stops showing its welcome page)
```bash
# Debian/Ubuntu
sudo rm -f /etc/nginx/sites-enabled/default

# Or edit default and remove/comment its server block
```

### 5. Test and reload Nginx
```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 6. Confirm DNS
Ensure **www.dermee.dz** and **dermee.dz** resolve to your VPS IP:
```bash
nslookup www.dermee.dz
```

---

## If it still fails

### App not responding from Nginx
```bash
# On VPS - check if app responds on localhost
curl -v http://127.0.0.1:3000
curl http://127.0.0.1:3000/health
```

### Firewall (ufw)
```bash
# Allow HTTP and HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status
sudo ufw enable   # if needed
```

### Docker not listening on 127.0.0.1:3000
In `docker-compose.yml`, the `api` service already maps `3000:3000`. That should reach `127.0.0.1:3000` on the host. Ensure:
- Containers are up: `docker compose ps`
- Logs are clean: `docker compose logs api`
