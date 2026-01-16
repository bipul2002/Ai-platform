#!/bin/bash

###############################################################################
# AI Query Platform - Restore Script
# Restore database, volumes, and configuration from backup
###############################################################################

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/ai-platform}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check if backup ID provided
if [ -z "$1" ]; then
    log_error "Please provide backup ID (date)"
    echo ""
    echo "Usage: $0 YYYYMMDD_HHMMSS"
    echo ""
    echo "Available backups:"
    ls -1 "$BACKUP_DIR"/db_backup_*.sql.gz 2>/dev/null | sed 's/.*db_backup_/  /' | sed 's/.sql.gz//' || echo "  No backups found"
    exit 1
fi

BACKUP_ID="$1"

echo "=========================================="
echo "  AI Query Platform Restore"
echo "=========================================="
echo ""
log_warning "This will restore from backup: $BACKUP_ID"
log_warning "Current data will be REPLACED!"
echo ""
read -p "Are you sure you want to continue? (type 'yes' to confirm): " confirm

if [ "$confirm" != "yes" ]; then
    log_info "Restore cancelled"
    exit 0
fi

# Verify backup files exist
verify_backup_files() {
    log_info "Verifying backup files..."

    local missing=0

    if [ ! -f "$BACKUP_DIR/db_backup_$BACKUP_ID.sql.gz" ]; then
        log_error "Database backup not found: $BACKUP_DIR/db_backup_$BACKUP_ID.sql.gz"
        missing=$((missing + 1))
    fi

    if [ $missing -gt 0 ]; then
        log_error "Cannot proceed with restore - backup files missing"
        exit 1
    fi

    log_success "Backup files verified"
}

# Stop services
stop_services() {
    log_info "Stopping services..."
    docker-compose down
    log_success "Services stopped"
}

# Restore database
restore_database() {
    log_info "Restoring database..."

    # Start only postgres
    docker-compose up -d postgres

    # Wait for postgres to be ready
    log_info "Waiting for PostgreSQL to be ready..."
    sleep 10

    local max_attempts=30
    local attempt=0

    while [ $attempt -lt $max_attempts ]; do
        if docker exec ai-query-postgres pg_isready -U postgres >/dev/null 2>&1; then
            break
        fi
        attempt=$((attempt + 1))
        echo -n "."
        sleep 2
    done
    echo ""

    # Drop existing database and recreate
    log_warning "Dropping existing database..."
    docker exec -i ai-query-postgres psql -U postgres -c "DROP DATABASE IF EXISTS ai_query_platform;"
    docker exec -i ai-query-postgres psql -U postgres -c "CREATE DATABASE ai_query_platform;"

    # Restore backup
    log_info "Restoring from backup..."
    gunzip < "$BACKUP_DIR/db_backup_$BACKUP_ID.sql.gz" | docker exec -i ai-query-postgres psql -U postgres -d ai_query_platform

    log_success "Database restored"
}

# Restore environment files
restore_env_files() {
    if [ -f "$BACKUP_DIR/env_backup_$BACKUP_ID.tar.gz" ]; then
        log_info "Restoring environment files..."

        # Backup current env files
        if ls .env.* 1> /dev/null 2>&1; then
            tar czf ".env_backup_before_restore_$(date +%Y%m%d_%H%M%S).tar.gz" .env.*
            log_info "Current env files backed up"
        fi

        # Restore env files
        tar xzf "$BACKUP_DIR/env_backup_$BACKUP_ID.tar.gz"

        log_success "Environment files restored"
    else
        log_warning "No environment files backup found for $BACKUP_ID"
    fi
}

# Restore volumes
restore_volumes() {
    log_info "Restoring Docker volumes..."

    # Stop postgres to restore volume
    docker-compose down postgres

    # Restore postgres volume
    if [ -f "$BACKUP_DIR/postgres_volume_$BACKUP_ID.tar.gz" ]; then
        log_info "Restoring PostgreSQL volume..."

        # Remove existing volume
        docker volume rm ai-platform_postgres_data 2>/dev/null || true

        # Create new volume
        docker volume create ai-platform_postgres_data

        # Restore data
        docker run --rm \
            -v ai-platform_postgres_data:/data \
            -v "$BACKUP_DIR":/backup \
            ubuntu bash -c "cd /data && tar xzf /backup/postgres_volume_$BACKUP_ID.tar.gz"

        log_success "PostgreSQL volume restored"
    else
        log_warning "No PostgreSQL volume backup found"
    fi

    # Restore redis volume
    if [ -f "$BACKUP_DIR/redis_volume_$BACKUP_ID.tar.gz" ]; then
        log_info "Restoring Redis volume..."

        # Remove existing volume
        docker volume rm ai-platform_redis_data 2>/dev/null || true

        # Create new volume
        docker volume create ai-platform_redis_data

        # Restore data
        docker run --rm \
            -v ai-platform_redis_data:/data \
            -v "$BACKUP_DIR":/backup \
            ubuntu bash -c "cd /data && tar xzf /backup/redis_volume_$BACKUP_ID.tar.gz"

        log_success "Redis volume restored"
    else
        log_warning "No Redis volume backup found"
    fi
}

# Start all services
start_services() {
    log_info "Starting all services..."
    docker-compose up -d

    # Wait for services to be healthy
    log_info "Waiting for services to become healthy..."
    sleep 15

    local max_attempts=30
    local attempt=0

    while [ $attempt -lt $max_attempts ]; do
        local healthy=true

        if ! docker-compose ps postgres | grep -q "Up (healthy)" 2>/dev/null; then
            healthy=false
        fi

        if ! docker-compose ps redis | grep -q "Up (healthy)" 2>/dev/null; then
            healthy=false
        fi

        if $healthy; then
            log_success "All services are healthy"
            break
        fi

        attempt=$((attempt + 1))
        echo -n "."
        sleep 2
    done
    echo ""
}

# Verify restoration
verify_restoration() {
    log_info "Verifying restoration..."

    local errors=0

    # Check database connection
    if ! docker exec ai-query-postgres psql -U postgres -d ai_query_platform -c "SELECT 1;" >/dev/null 2>&1; then
        log_error "Cannot connect to database"
        errors=$((errors + 1))
    else
        log_success "Database connection verified"
    fi

    # Check services
    if ! curl -sf http://localhost:4000/api/health >/dev/null 2>&1; then
        log_warning "Admin Backend health check failed"
        errors=$((errors + 1))
    else
        log_success "Admin Backend is healthy"
    fi

    if ! curl -sf http://localhost:8000/api/health >/dev/null 2>&1; then
        log_warning "AI Runtime health check failed"
        errors=$((errors + 1))
    else
        log_success "AI Runtime is healthy"
    fi

    if [ $errors -gt 0 ]; then
        log_warning "Restoration completed with $errors warning(s)"
        log_info "Check logs with: docker-compose logs -f"
    else
        log_success "All services verified successfully"
    fi
}

# Main restore process
main() {
    verify_backup_files
    stop_services
    restore_database
    restore_env_files
    # restore_volumes  # Uncomment if you want to restore volumes
    start_services
    sleep 10
    verify_restoration

    echo ""
    echo "=========================================="
    echo "  Restore Complete"
    echo "=========================================="
    echo ""
    log_success "System restored from backup: $BACKUP_ID"
    echo ""
    echo "Service URLs:"
    echo "  Frontend:       http://localhost:3000"
    echo "  Admin Backend:  http://localhost:4000"
    echo "  AI Runtime:     http://localhost:8000"
    echo ""
}

# Run main function
main
