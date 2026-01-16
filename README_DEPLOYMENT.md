# Quick Deployment Guide

This document provides a quick reference for deploying the AI Query Platform on a remote Ubuntu server.

## Quick Start

### For First-Time Deployment

```bash
# 1. Connect to your server
ssh username@your-server-ip

# 2. Transfer files to server (from your local machine)
rsync -avz --exclude 'node_modules' --exclude '__pycache__' \
  /path/to/ai-platform/ username@your-server-ip:~/ai-platform/

# 3. SSH into server and navigate to project
cd ~/ai-platform

# 4. Run automated deployment
./deploy.sh
```

The deployment script will:
- Check and install Docker if needed
- Check and install Docker Compose if needed
- Create .env files from examples (if not present)
- Build and start all services
- Verify the deployment

### Manual .env Configuration

If this is your first deployment, you'll need to configure environment variables:

```bash
# Copy example files
cp .env.postgres.example .env.postgres
cp .env.admin-backend.example .env.admin-backend
cp .env.ai-runtime.example .env.ai-runtime
cp .env.frontend.example .env.frontend

# Generate secure secrets
openssl rand -base64 32  # For JWT_SECRET
openssl rand -base64 32  # For ENCRYPTION_KEY

# Edit each file with your actual values
nano .env.postgres        # Set secure PostgreSQL password
nano .env.admin-backend   # Set JWT_SECRET, ENCRYPTION_KEY
nano .env.ai-runtime      # Set API keys, JWT_SECRET, ENCRYPTION_KEY
nano .env.frontend        # Set API URLs
```

**Important:** Make sure JWT_SECRET and ENCRYPTION_KEY are the same in both `.env.admin-backend` and `.env.ai-runtime`.

### Run Deployment

```bash
./deploy.sh deploy
```

## Available Commands

The `deploy.sh` script supports multiple operations:

```bash
# Full deployment (builds and starts everything)
./deploy.sh deploy

# Start services (without rebuilding)
./deploy.sh start

# Stop all services
./deploy.sh stop

# Restart services
./deploy.sh restart

# Update application (rebuild and restart)
./deploy.sh update

# View live logs
./deploy.sh logs

# Show service status
./deploy.sh status
```

## Backup and Restore

### Create Backup

```bash
# Manual backup
./backup.sh

# Or using deploy script
./deploy.sh backup
```

Backups are stored in `~/backups/ai-platform/` by default.

### Restore from Backup

```bash
# List available backups
ls -lh ~/backups/ai-platform/db_backup_*.sql.gz

# Restore from specific backup
./restore.sh YYYYMMDD_HHMMSS
```

### Automated Daily Backups

```bash
# Add to crontab for daily 2 AM backups
crontab -e

# Add this line:
0 2 * * * /home/$USER/ai-platform/backup.sh >> /home/$USER/backup.log 2>&1
```

## Service URLs

After deployment, services are available at:

- **Frontend**: http://your-server-ip:3000
- **Admin Backend API**: http://your-server-ip:4000
- **AI Runtime API**: http://your-server-ip:8000
- **Admin API Docs**: http://your-server-ip:4000/api/docs
- **Runtime API Docs**: http://your-server-ip:8000/docs

## Production Setup (with SSL)

For production deployment with SSL:

1. Point your domain to the server IP
2. Install Nginx: `sudo apt install nginx`
3. Install Certbot: `sudo apt install certbot python3-certbot-nginx`
4. Obtain SSL certificate: `sudo certbot --nginx -d yourdomain.com`
5. Configure Nginx reverse proxy (see DEPLOYMENT_GUIDE.md)

## Common Operations

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f admin-backend
docker-compose logs -f ai-runtime

# Last 100 lines
docker-compose logs --tail=100 admin-backend
```

### Check Service Health

```bash
# All services
docker-compose ps

# Admin Backend health
curl http://localhost:4000/api/health

# AI Runtime health
curl http://localhost:8000/api/health
```

### Access Database

```bash
# Connect to PostgreSQL
docker exec -it ai-query-postgres psql -U postgres -d ai_query_platform

# Inside psql:
\dt                # List tables
\d admin_users     # Describe table
SELECT * FROM admin_users;
\q                 # Exit
```

### Container Management

```bash
# Shell into container
docker exec -it ai-query-admin-backend sh
docker exec -it ai-query-ai-runtime bash

# Restart specific service
docker-compose restart admin-backend

# View resource usage
docker stats
```

### Update Application

```bash
# Pull latest code (if using git)
git pull origin main

# Rebuild and restart
./deploy.sh update

# Or manually
docker-compose build
docker-compose up -d
```

## Troubleshooting

### Services Won't Start

```bash
# Check logs for errors
docker-compose logs

# Check individual service
docker-compose logs admin-backend

# Restart problematic service
docker-compose restart admin-backend
```

### Database Connection Issues

```bash
# Check if postgres is running
docker-compose ps postgres

# Check postgres logs
docker-compose logs postgres

# Verify connection string
cat .env.admin-backend | grep DATABASE_URL
```

### Port Already in Use

```bash
# Check what's using the port
sudo lsof -i :3000
sudo lsof -i :4000
sudo lsof -i :8000

# Stop the process or change port in docker-compose.yml
```

### Out of Disk Space

```bash
# Check disk usage
df -h

# Check Docker disk usage
docker system df

# Clean up unused resources
docker system prune -a
```

### Services Keep Restarting

```bash
# Check logs for crash reason
docker-compose logs -f

# Check resource usage
docker stats

# Check system memory
free -h
```

## Security Checklist

Before going to production:

- [ ] Change all default passwords
- [ ] Set strong JWT_SECRET and ENCRYPTION_KEY
- [ ] Secure API keys in .env files
- [ ] Set .env file permissions to 600
- [ ] Enable firewall (UFW)
- [ ] Install SSL certificates
- [ ] Disable root SSH login
- [ ] Set up fail2ban
- [ ] Configure automated backups
- [ ] Set up monitoring and alerts
- [ ] Review and update security headers in Nginx

## Environment Variables Reference

### Required Variables

| Service | Variable | Description |
|---------|----------|-------------|
| postgres | POSTGRES_PASSWORD | Database password |
| admin-backend | JWT_SECRET | JWT signing key (must match ai-runtime) |
| admin-backend | ENCRYPTION_KEY | Data encryption key (must match ai-runtime) |
| ai-runtime | OPENAI_API_KEY | OpenAI API key |
| ai-runtime | JWT_SECRET | JWT signing key (must match admin-backend) |
| ai-runtime | ENCRYPTION_KEY | Data encryption key (must match admin-backend) |
| frontend | VITE_API_URL | Admin backend URL |
| frontend | VITE_WS_URL | AI runtime WebSocket URL |

### Optional Variables

| Service | Variable | Default | Description |
|---------|----------|---------|-------------|
| ai-runtime | ANTHROPIC_API_KEY | - | Anthropic API key (optional) |
| ai-runtime | LOG_LEVEL | INFO | Logging level (DEBUG, INFO, WARNING, ERROR) |
| admin-backend | NODE_ENV | production | Node environment |
| ai-runtime | LLM_MODEL | gpt-4-turbo-preview | Default LLM model |
| ai-runtime | EMBEDDING_MODEL | text-embedding-3-small | Embedding model |

## Getting Help

1. Check logs: `docker-compose logs -f`
2. Review [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for detailed instructions
3. Check service health endpoints
4. Verify environment variables
5. Check Docker container status

## Next Steps After Deployment

1. Create super admin user
2. Configure email service for magic links
3. Set up monitoring (Prometheus, Grafana)
4. Configure automated backups
5. Set up log aggregation
6. Document runbooks for your team
7. Set up staging environment
8. Configure CI/CD pipeline

---

For comprehensive deployment instructions, see [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md).
