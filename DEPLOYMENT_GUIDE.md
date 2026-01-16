# AI Query Platform - Production Deployment Guide

This guide provides step-by-step instructions for deploying the AI Query Platform on a remote Ubuntu server.

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Server Requirements](#server-requirements)
3. [Initial Server Setup](#initial-server-setup)
4. [Install Dependencies](#install-dependencies)
5. [Deploy Application](#deploy-application)
6. [Configure Environment Variables](#configure-environment-variables)
7. [SSL/TLS Configuration (Recommended)](#ssltls-configuration)
8. [Build and Start Services](#build-and-start-services)
9. [Verify Deployment](#verify-deployment)
10. [Monitoring and Maintenance](#monitoring-and-maintenance)
11. [Troubleshooting](#troubleshooting)
12. [Backup and Recovery](#backup-and-recovery)

---

## Prerequisites

- Ubuntu 20.04 LTS or newer
- SSH access with sudo privileges
- Domain name (optional, but recommended for SSL)
- OpenAI API key
- Anthropic API key (optional)
- Minimum 4GB RAM, 2 CPU cores, 40GB disk space

---

## Server Requirements

### Recommended Specifications

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 2 cores | 4+ cores |
| RAM | 4 GB | 8+ GB |
| Disk | 40 GB | 100+ GB SSD |
| OS | Ubuntu 20.04 | Ubuntu 22.04 LTS |

### Required Ports

| Port | Service | Description |
|------|---------|-------------|
| 22 | SSH | Remote access |
| 80 | HTTP | Web traffic (redirect to HTTPS) |
| 443 | HTTPS | Secure web traffic |
| 3000 | Frontend | React application |
| 4000 | Admin Backend | NestJS API |
| 8000 | AI Runtime | FastAPI service |
| 5433 | PostgreSQL | Database (internal) |
| 6379 | Redis | Cache (internal) |

**Note:** Only ports 22, 80, 443 need to be exposed publicly. Others can remain internal.

---

## Initial Server Setup

### 1. Connect to Your Server

```bash
ssh username@your-server-ip
```

### 2. Update System Packages

```bash
sudo apt update && sudo apt upgrade -y
```

### 3. Create Deployment User (Optional but Recommended)

```bash
# Create deployment user
sudo adduser deployer

# Add to sudo group
sudo usermod -aG sudo deployer

# Switch to deployment user
su - deployer
```

### 4. Configure Firewall

```bash
# Enable UFW
sudo ufw enable

# Allow SSH (IMPORTANT: Do this first!)
sudo ufw allow 22/tcp

# Allow HTTP and HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Check status
sudo ufw status
```

---

## Install Dependencies

### 1. Install Docker

```bash
# Remove old versions
sudo apt remove docker docker-engine docker.io containerd runc

# Install prerequisites
sudo apt install -y apt-transport-https ca-certificates curl software-properties-common

# Add Docker GPG key
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Add Docker repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io

# Start and enable Docker
sudo systemctl start docker
sudo systemctl enable docker

# Add user to docker group
sudo usermod -aG docker $USER

# Log out and back in for group changes to take effect
exit
# Then reconnect via SSH
```

### 2. Install Docker Compose

```bash
# Download Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose

# Make executable
sudo chmod +x /usr/local/bin/docker-compose

# Verify installation
docker-compose --version
```

### 3. Install Git

```bash
sudo apt install -y git
```

### 4. Install Nginx (for reverse proxy)

```bash
sudo apt install -y nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

---

## Deploy Application

### 1. Choose Deployment Location

```bash
cd /home/$USER
mkdir -p apps
cd apps
```

### 2. Clone Repository or Transfer Files

**Option A: Clone from Git Repository**

```bash
git clone <your-repo-url> ai-platform
cd ai-platform
```

**Option B: Transfer Files via SCP (from your local machine)**

```bash
# Run this on your LOCAL machine
scp -r /home/sumit/projects/ai-platform username@your-server-ip:/home/username/apps/
```

**Option C: Use rsync for efficient transfer**

```bash
# Run this on your LOCAL machine (recommended for updates)
rsync -avz --exclude 'node_modules' --exclude '__pycache__' --exclude 'dist' \
  /home/sumit/projects/ai-platform/ \
  username@your-server-ip:/home/username/apps/ai-platform/
```

### 3. Verify Files

```bash
cd /home/$USER/apps/ai-platform
ls -la
```

You should see:
- admin-backend/
- ai-runtime/
- frontend/
- docker-compose.yml
- .env.*.example files

---

## Configure Environment Variables

### 1. Create Environment Files from Templates

```bash
cd /home/$USER/apps/ai-platform

# Copy example files
cp .env.postgres.example .env.postgres
cp .env.admin-backend.example .env.admin-backend
cp .env.ai-runtime.example .env.ai-runtime
cp .env.frontend.example .env.frontend
```

### 2. Generate Secure Secrets

```bash
# Generate JWT secret (32 characters)
openssl rand -base64 32

# Generate encryption key (32 characters)
openssl rand -base64 32

# Generate PostgreSQL password
openssl rand -base64 16
```

### 3. Configure PostgreSQL (.env.postgres)

```bash
nano .env.postgres
```

Update with secure values:

```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<generated-secure-password>
POSTGRES_DB=ai_query_platform
```

### 4. Configure Admin Backend (.env.admin-backend)

```bash
nano .env.admin-backend
```

Update with your values:

```env
NODE_ENV=production
DATABASE_URL=postgresql://postgres:<postgres-password>@postgres:5432/ai_query_platform
JWT_SECRET=<generated-jwt-secret>
JWT_EXPIRATION=24h
ENCRYPTION_KEY=<generated-encryption-key>
AI_RUNTIME_URL=http://ai-runtime:8000
REDIS_URL=redis://redis:6379
PORT=4000
```

### 5. Configure AI Runtime (.env.ai-runtime)

```bash
nano .env.ai-runtime
```

Update with your API keys:

```env
ADMIN_BACKEND_URL=http://admin-backend:4000
OPENAI_API_KEY=<your-openai-api-key>
ANTHROPIC_API_KEY=<your-anthropic-api-key>
EMBEDDING_MODEL=text-embedding-3-small
LLM_MODEL=gpt-4-turbo-preview
PGVECTOR_URL=postgresql://postgres:<postgres-password>@postgres:5432/ai_query_platform
REDIS_URL=redis://redis:6379
PORT=8000
LOG_LEVEL=INFO
JWT_SECRET=<same-jwt-secret-as-admin-backend>
ENCRYPTION_KEY=<same-encryption-key-as-admin-backend>
```

**Important:** JWT_SECRET and ENCRYPTION_KEY must match between admin-backend and ai-runtime.

### 6. Configure Frontend (.env.frontend)

```bash
nano .env.frontend
```

Update with your domain or server IP:

```env
# For domain-based deployment
VITE_API_URL=https://api.yourdomain.com
VITE_WS_URL=wss://runtime.yourdomain.com

# OR for IP-based deployment (development/testing)
VITE_API_URL=http://your-server-ip:4000
VITE_WS_URL=ws://your-server-ip:8000
```

### 7. Secure Environment Files

```bash
chmod 600 .env.*
```

---

## SSL/TLS Configuration

### Option 1: Using Certbot (Let's Encrypt) - Recommended

#### Prerequisites
- Domain name pointing to your server IP
- Ports 80 and 443 open

#### Install Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
```

#### Obtain SSL Certificates

```bash
# Replace with your actual domain
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com -d api.yourdomain.com -d runtime.yourdomain.com
```

#### Configure Nginx as Reverse Proxy

```bash
sudo nano /etc/nginx/sites-available/ai-platform
```

Add the following configuration:

```nginx
# Frontend
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

# Admin Backend API
server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# AI Runtime
server {
    listen 80;
    server_name runtime.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name runtime.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket support
    location /ws {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
}
```

#### Enable Configuration

```bash
# Create symbolic link
sudo ln -s /etc/nginx/sites-available/ai-platform /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

### Option 2: Without SSL (Development/Testing Only)

If you're deploying without a domain for testing, you can skip SSL and access services directly via IP:

```bash
# Update .env.frontend to use IP addresses
VITE_API_URL=http://your-server-ip:4000
VITE_WS_URL=ws://your-server-ip:8000
```

---

## Build and Start Services

### 1. Navigate to Project Directory

```bash
cd /home/$USER/apps/ai-platform
```

### 2. Pull Docker Images (if needed)

```bash
docker-compose pull postgres redis
```

### 3. Build and Start Services

```bash
# Build images (first time or after code changes)
docker-compose build

# Start services in detached mode
docker-compose up -d

# View logs
docker-compose logs -f
```

**Expected output:**
- postgres: healthy
- redis: healthy
- admin-backend: started
- ai-runtime: started
- frontend: started

### 4. Check Container Status

```bash
docker-compose ps
```

All services should show "Up" status.

### 5. Monitor Initial Startup

```bash
# Watch all logs
docker-compose logs -f

# Watch specific service
docker-compose logs -f admin-backend
docker-compose logs -f ai-runtime

# Press Ctrl+C to exit logs
```

---

## Verify Deployment

### 1. Check Service Health

```bash
# Admin Backend health check
curl http://localhost:4000/api/health

# AI Runtime health check
curl http://localhost:8000/api/health

# Frontend (should return HTML)
curl http://localhost:3000
```

### 2. Check Database Connection

```bash
# Connect to PostgreSQL container
docker exec -it ai-query-postgres psql -U postgres -d ai_query_platform

# List tables
\dt

# Exit
\q
```

### 3. Create Initial Super Admin User

```bash
# Connect to admin-backend container
docker exec -it ai-query-admin-backend sh

# Inside container, you may need to create a super admin via direct DB insert
# or use a seed script if available
exit
```

**Alternative: Direct database insert**

```bash
docker exec -it ai-query-postgres psql -U postgres -d ai_query_platform -c "
INSERT INTO admin_users (id, email, password_hash, role, first_name, last_name, is_active, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'admin@platform.local',
  '\$2b\$12\$EXAMPLE_HASH',
  'super_admin',
  'Admin',
  'User',
  true,
  NOW(),
  NOW()
);
"
```

**Note:** You'll need to generate a proper bcrypt hash for the password. You can use the registration endpoint or a bcrypt tool.

### 4. Access the Application

**With SSL (domain-based):**
- Frontend: https://yourdomain.com
- Admin API: https://api.yourdomain.com
- AI Runtime: https://runtime.yourdomain.com

**Without SSL (IP-based):**
- Frontend: http://your-server-ip:3000
- Admin API: http://your-server-ip:4000
- AI Runtime: http://your-server-ip:8000

### 5. Test Login Flow

1. Navigate to frontend URL
2. Enter admin email
3. Magic link should be generated
4. Use the magic link to authenticate

---

## Monitoring and Maintenance

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f admin-backend
docker-compose logs -f ai-runtime

# Last 100 lines
docker-compose logs --tail=100 admin-backend

# Since timestamp
docker-compose logs --since 2024-01-01T00:00:00 ai-runtime
```

### Restart Services

```bash
# Restart all services
docker-compose restart

# Restart specific service
docker-compose restart admin-backend
docker-compose restart ai-runtime
```

### Update Application

```bash
# Pull latest changes (if using git)
git pull origin main

# Rebuild images
docker-compose build

# Restart services with new images
docker-compose up -d

# Remove old images
docker image prune -f
```

### Database Migrations

```bash
# Run migrations for admin-backend
docker exec -it ai-query-admin-backend npm run migration:run

# Revert last migration
docker exec -it ai-query-admin-backend npm run migration:revert
```

### Monitor Resource Usage

```bash
# Container stats
docker stats

# Disk usage
docker system df

# Detailed disk usage
du -sh /home/$USER/apps/ai-platform
```

### Clean Up Docker Resources

```bash
# Remove stopped containers
docker container prune -f

# Remove unused images
docker image prune -f

# Remove unused volumes (CAREFUL!)
docker volume prune -f

# Remove everything unused (CAREFUL!)
docker system prune -af
```

---

## Troubleshooting

### Common Issues

#### 1. Container Won't Start

```bash
# Check logs
docker-compose logs <service-name>

# Check container status
docker-compose ps

# Restart container
docker-compose restart <service-name>
```

#### 2. Database Connection Failed

```bash
# Verify postgres is running
docker-compose ps postgres

# Check postgres logs
docker-compose logs postgres

# Verify connection string in .env files
cat .env.admin-backend | grep DATABASE_URL
cat .env.ai-runtime | grep PGVECTOR_URL

# Test connection
docker exec -it ai-query-postgres psql -U postgres -d ai_query_platform -c "SELECT version();"
```

#### 3. Port Already in Use

```bash
# Check what's using the port
sudo lsof -i :3000
sudo lsof -i :4000
sudo lsof -i :8000

# Stop the conflicting process or change ports in docker-compose.yml
```

#### 4. Permission Denied Errors

```bash
# Fix ownership
sudo chown -R $USER:$USER /home/$USER/apps/ai-platform

# Fix .env file permissions
chmod 600 .env.*
```

#### 5. Out of Memory

```bash
# Check memory usage
free -h

# Check Docker memory
docker stats

# Add swap space
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

#### 6. SSL Certificate Issues

```bash
# Renew certificates
sudo certbot renew

# Test renewal
sudo certbot renew --dry-run

# Check certificate expiry
sudo certbot certificates
```

---

## Backup and Recovery

### 1. Backup Database

```bash
# Create backup directory
mkdir -p /home/$USER/backups

# Backup PostgreSQL
docker exec -t ai-query-postgres pg_dump -U postgres ai_query_platform | gzip > /home/$USER/backups/db_backup_$(date +%Y%m%d_%H%M%S).sql.gz

# Automated daily backup (cron)
crontab -e

# Add this line for daily 2 AM backup
0 2 * * * docker exec -t ai-query-postgres pg_dump -U postgres ai_query_platform | gzip > /home/$USER/backups/db_backup_$(date +\%Y\%m\%d_\%H\%M\%S).sql.gz
```

### 2. Restore Database

```bash
# Stop services
docker-compose down

# Start only postgres
docker-compose up -d postgres

# Wait for postgres to be ready
sleep 10

# Restore backup
gunzip < /home/$USER/backups/db_backup_YYYYMMDD_HHMMSS.sql.gz | docker exec -i ai-query-postgres psql -U postgres -d ai_query_platform

# Start all services
docker-compose up -d
```

### 3. Backup Environment Files

```bash
# Backup .env files (SECURE THESE!)
tar czf /home/$USER/backups/env_backup_$(date +%Y%m%d_%H%M%S).tar.gz .env.*

# Encrypt backup
gpg -c /home/$USER/backups/env_backup_*.tar.gz
```

### 4. Backup Docker Volumes

```bash
# Backup postgres data
docker run --rm -v ai-platform_postgres_data:/data -v /home/$USER/backups:/backup ubuntu tar czf /backup/postgres_volume_$(date +%Y%m%d_%H%M%S).tar.gz -C /data .

# Backup redis data
docker run --rm -v ai-platform_redis_data:/data -v /home/$USER/backups:/backup ubuntu tar czf /backup/redis_volume_$(date +%Y%m%d_%H%M%S).tar.gz -C /data .
```

### 5. Automate Backups with Script

Create `/home/$USER/backup.sh`:

```bash
#!/bin/bash

BACKUP_DIR="/home/$USER/backups"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=7

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup database
docker exec -t ai-query-postgres pg_dump -U postgres ai_query_platform | gzip > $BACKUP_DIR/db_backup_$DATE.sql.gz

# Backup environment files
tar czf $BACKUP_DIR/env_backup_$DATE.tar.gz -C /home/$USER/apps/ai-platform .env.*

# Remove backups older than retention period
find $BACKUP_DIR -name "db_backup_*.sql.gz" -mtime +$RETENTION_DAYS -delete
find $BACKUP_DIR -name "env_backup_*.tar.gz" -mtime +$RETENTION_DAYS -delete

echo "Backup completed: $DATE"
```

Make executable and schedule:

```bash
chmod +x /home/$USER/backup.sh

# Add to cron for daily 2 AM execution
crontab -e
# Add: 0 2 * * * /home/$USER/backup.sh >> /home/$USER/backup.log 2>&1
```

---

## Security Checklist

- [ ] Firewall configured (UFW enabled)
- [ ] SSH key-based authentication enabled
- [ ] Root login disabled
- [ ] Strong passwords for PostgreSQL
- [ ] JWT_SECRET and ENCRYPTION_KEY are strong and unique
- [ ] API keys secured in .env files (not in code)
- [ ] .env files have 600 permissions
- [ ] SSL/TLS certificates installed and auto-renewal configured
- [ ] Regular backups scheduled
- [ ] Docker containers run as non-root users
- [ ] Nginx configured with security headers
- [ ] Rate limiting enabled on Nginx
- [ ] Monitoring and alerting configured
- [ ] Log rotation configured

---

## Production Optimization

### Enable Log Rotation

```bash
# Create logrotate config
sudo nano /etc/logrotate.d/docker-containers

# Add:
/var/lib/docker/containers/*/*.log {
  rotate 7
  daily
  compress
  size=10M
  missingok
  delaycompress
  copytruncate
}
```

### Configure Docker Daemon Limits

```bash
sudo nano /etc/docker/daemon.json

# Add:
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}

# Restart Docker
sudo systemctl restart docker
```

### Enable Auto-Restart on Failure

Already configured in docker-compose.yml with `restart: unless-stopped`.

---

## Support and Maintenance Contacts

- **Application Issues**: Check logs first
- **Server Issues**: Contact hosting provider
- **Security Issues**: Follow security disclosure policy

---

## Quick Reference Commands

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# View logs
docker-compose logs -f

# Restart service
docker-compose restart <service-name>

# Update and restart
git pull && docker-compose build && docker-compose up -d

# Backup database
docker exec -t ai-query-postgres pg_dump -U postgres ai_query_platform | gzip > backup.sql.gz

# Check status
docker-compose ps

# Shell into container
docker exec -it ai-query-admin-backend sh
```

---

## Next Steps

After successful deployment:

1. Create super admin user
2. Configure email service for magic links
3. Set up monitoring (Prometheus, Grafana)
4. Configure log aggregation (ELK stack)
5. Set up alerting (PagerDuty, Slack)
6. Document operational procedures
7. Train team on system operations
8. Schedule regular security audits

---

**Congratulations!** Your AI Query Platform is now deployed and ready for use.

For additional support, refer to the project documentation or contact the development team.
