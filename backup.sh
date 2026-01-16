#!/bin/bash

###############################################################################
# AI Query Platform - Backup Script
# Automated backup of database, volumes, and configuration files
###############################################################################

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/ai-platform}"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS="${RETENTION_DAYS:-7}"

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

# Create backup directory
mkdir -p "$BACKUP_DIR"

log_info "Starting backup process..."
log_info "Backup directory: $BACKUP_DIR"

# Backup database
backup_database() {
    log_info "Backing up PostgreSQL database..."

    if ! docker ps | grep -q "ai-query-postgres"; then
        log_error "PostgreSQL container is not running"
        return 1
    fi

    local db_backup_file="$BACKUP_DIR/db_backup_$DATE.sql.gz"

    docker exec -t ai-query-postgres pg_dump -U postgres ai_query_platform | gzip > "$db_backup_file"

    local size=$(du -h "$db_backup_file" | cut -f1)
    log_success "Database backup created: $db_backup_file ($size)"
}

# Backup environment files
backup_env_files() {
    log_info "Backing up environment files..."

    local env_backup_file="$BACKUP_DIR/env_backup_$DATE.tar.gz"

    tar czf "$env_backup_file" .env.* 2>/dev/null || {
        log_warning "No .env files found to backup"
        return 0
    }

    local size=$(du -h "$env_backup_file" | cut -f1)
    log_success "Environment files backup created: $env_backup_file ($size)"
}

# Backup Docker volumes
backup_volumes() {
    log_info "Backing up Docker volumes..."

    # Backup postgres volume
    local postgres_volume_backup="$BACKUP_DIR/postgres_volume_$DATE.tar.gz"
    docker run --rm \
        -v ai-platform_postgres_data:/data \
        -v "$BACKUP_DIR":/backup \
        ubuntu tar czf "/backup/postgres_volume_$DATE.tar.gz" -C /data .

    local size=$(du -h "$postgres_volume_backup" | cut -f1)
    log_success "PostgreSQL volume backup created: $postgres_volume_backup ($size)"

    # Backup redis volume
    local redis_volume_backup="$BACKUP_DIR/redis_volume_$DATE.tar.gz"
    docker run --rm \
        -v ai-platform_redis_data:/data \
        -v "$BACKUP_DIR":/backup \
        ubuntu tar czf "/backup/redis_volume_$DATE.tar.gz" -C /data .

    local size=$(du -h "$redis_volume_backup" | cut -f1)
    log_success "Redis volume backup created: $redis_volume_backup ($size)"
}

# Clean old backups
cleanup_old_backups() {
    log_info "Cleaning up backups older than $RETENTION_DAYS days..."

    local deleted=0

    # Delete old database backups
    find "$BACKUP_DIR" -name "db_backup_*.sql.gz" -mtime +$RETENTION_DAYS -type f -delete && deleted=$((deleted + 1)) || true

    # Delete old env backups
    find "$BACKUP_DIR" -name "env_backup_*.tar.gz" -mtime +$RETENTION_DAYS -type f -delete && deleted=$((deleted + 1)) || true

    # Delete old volume backups
    find "$BACKUP_DIR" -name "postgres_volume_*.tar.gz" -mtime +$RETENTION_DAYS -type f -delete && deleted=$((deleted + 1)) || true
    find "$BACKUP_DIR" -name "redis_volume_*.tar.gz" -mtime +$RETENTION_DAYS -type f -delete && deleted=$((deleted + 1)) || true

    if [ $deleted -gt 0 ]; then
        log_success "Deleted $deleted old backup files"
    else
        log_info "No old backups to delete"
    fi
}

# Create backup manifest
create_manifest() {
    local manifest_file="$BACKUP_DIR/backup_manifest_$DATE.txt"

    cat > "$manifest_file" <<EOF
AI Query Platform Backup Manifest
Date: $(date)
Backup ID: $DATE

Files:
$(ls -lh "$BACKUP_DIR"/*_$DATE.* 2>/dev/null || echo "No backup files found")

Docker Containers:
$(docker-compose ps 2>/dev/null || echo "Docker Compose not available")

Docker Volumes:
$(docker volume ls | grep ai-platform || echo "No volumes found")

Total Backup Size:
$(du -sh "$BACKUP_DIR" | cut -f1)
EOF

    log_success "Backup manifest created: $manifest_file"
}

# Verify backups
verify_backups() {
    log_info "Verifying backup integrity..."

    local errors=0

    # Verify database backup
    if [ -f "$BACKUP_DIR/db_backup_$DATE.sql.gz" ]; then
        if gunzip -t "$BACKUP_DIR/db_backup_$DATE.sql.gz" 2>/dev/null; then
            log_success "Database backup integrity verified"
        else
            log_error "Database backup is corrupted"
            errors=$((errors + 1))
        fi
    fi

    # Verify env backup
    if [ -f "$BACKUP_DIR/env_backup_$DATE.tar.gz" ]; then
        if tar tzf "$BACKUP_DIR/env_backup_$DATE.tar.gz" >/dev/null 2>&1; then
            log_success "Environment files backup integrity verified"
        else
            log_error "Environment files backup is corrupted"
            errors=$((errors + 1))
        fi
    fi

    # Verify volume backups
    for volume_backup in "$BACKUP_DIR"/*_volume_$DATE.tar.gz; do
        if [ -f "$volume_backup" ]; then
            if tar tzf "$volume_backup" >/dev/null 2>&1; then
                log_success "Volume backup integrity verified: $(basename $volume_backup)"
            else
                log_error "Volume backup is corrupted: $(basename $volume_backup)"
                errors=$((errors + 1))
            fi
        fi
    done

    if [ $errors -gt 0 ]; then
        log_error "Backup verification found $errors error(s)"
        return 1
    fi

    log_success "All backups verified successfully"
    return 0
}

# Main backup process
main() {
    echo "=========================================="
    echo "  AI Query Platform Backup"
    echo "=========================================="
    echo ""

    backup_database
    backup_env_files
    backup_volumes
    verify_backups
    create_manifest
    cleanup_old_backups

    echo ""
    echo "=========================================="
    echo "  Backup Summary"
    echo "=========================================="
    echo ""
    echo "Backup Location: $BACKUP_DIR"
    echo "Backup Date: $DATE"
    echo "Total Size: $(du -sh "$BACKUP_DIR" | cut -f1)"
    echo ""

    # List recent backups
    log_info "Recent backups:"
    ls -lht "$BACKUP_DIR" | head -10

    echo ""
    log_success "Backup completed successfully!"
    echo ""
    echo "To restore from this backup, run:"
    echo "  ./restore.sh $DATE"
}

# Run main function
main
