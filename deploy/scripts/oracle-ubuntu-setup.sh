#!/usr/bin/env bash
set -euo pipefail

# Run on a fresh Oracle Cloud Ubuntu VM as a sudo-capable user.
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx ca-certificates curl git ufw

# Node.js 22 LTS via NodeSource.
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable

sudo systemctl enable --now nginx

echo "Oracle VM base setup complete. Clone/upload the project, configure .env, then run npm ci and PM2."
