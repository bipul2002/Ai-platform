#!/bin/bash

###############################################################################
# AI Query Platform - Automated Deployment Script
# This script automates the deployment process on Ubuntu servers
###############################################################################

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    log_error "Please do not run this script as root"
    exit 1
fi

echo "=========================================="
echo "  AI Query Platform Deployment Script"
echo "=========================================="
echo ""

# Check if .env files exist
check_env_files() {
    log_info "Checking for environment files..."

    local missing_files=()

    if [ ! -f ".env.postgres" ]; then
        missing_files+=(".env.postgres")
    fi
    if [ ! -f ".env.admin-backend" ]; then
        missing_files+=(".env.admin-backend")
    fi
    if [ ! -f ".env.ai-runtime" ]; then
        missing_files+=(".env.ai-runtime")
    fi
    if [ ! -f ".env.frontend" ]; then
        missing_files+=(".env.frontend")
    fi

    if [ ${#missing_files[@]} -gt 0 ]; then
        log_warning "Missing environment files: ${missing_files[*]}"
        read -p "Would you like to create them from examples? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            for file in "${missing_files[@]}"; do
                if [ -f "${file}.example" ]; then
                    cp "${file}.example" "$file"
                    log_success "Created $file from example"
                    log_warning "Please edit $file and update with your actual values"
                else
                    log_error "Example file ${file}.example not found"
                    exit 1
                fi
            done

            log_warning "Environment files created. Please edit them with your actual values."
            log_info "Run this script again after updating the .env files."
            exit 0
        else
            log_error "Cannot proceed without environment files"
            exit 1
        fi
    else
        log_success "All environment files present"
    fi
}

# Check if Docker is installed
check_docker() {
    log_info "Checking for Docker installation..."

    if ! command -v docker &> /dev/null; then
        log_warning "Docker is not installed"
        read -p "Would you like to install Docker? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            install_docker
        else
            log_error "Docker is required to proceed"
            exit 1
        fi
    else
        log_success "Docker is installed: $(docker --version)"
    fi
}

# Install Docker
install_docker() {
    log_info "Installing Docker..."

    # Remove old versions
    sudo apt-get remove docker docker-engine docker.io containerd runc 2>/dev/null || true

    # Update package index
    sudo apt-get update

    # Install prerequisites
    sudo apt-get install -y \
        apt-transport-https \
        ca-certificates \
        curl \
        software-properties-common

    # Add Docker GPG key
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

    # Add Docker repository
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    # Install Docker
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io

    # Start Docker
    sudo systemctl start docker
    sudo systemctl enable docker

    # Add current user to docker group
    sudo usermod -aG docker $USER

    log_success "Docker installed successfully"
    log_warning "You may need to log out and back in for Docker group changes to take effect"
}

# Check if Docker Compose is installed
check_docker_compose() {
    log_info "Checking for Docker Compose installation..."

    if ! command -v docker-compose &> /dev/null; then
        log_warning "Docker Compose is not installed"
        read -p "Would you like to install Docker Compose? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            install_docker_compose
        else
            log_error "Docker Compose is required to proceed"
            exit 1
        fi
    else
        log_success "Docker Compose is installed: $(docker-compose --version)"
    fi
}

# Install Docker Compose
install_docker_compose() {
    log_info "Installing Docker Compose..."

    sudo curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose

    log_success "Docker Compose installed successfully"
}

# Verify environment variables
verify_env_variables() {
    log_info "Verifying environment variables..."

    local errors=()

    # Check for placeholder values that need to be changed
    if grep -q "your-secure-password-here" .env.postgres 2>/dev/null; then
        errors+=("PostgreSQL password still has placeholder value")
    fi

    if grep -q "change-this-to-a-secure-random-string" .env.admin-backend 2>/dev/null; then
        errors+=("JWT_SECRET in admin-backend still has placeholder value")
    fi

    if grep -q "your-openai-api-key-here" .env.ai-runtime 2>/dev/null; then
        errors+=("OpenAI API key still has placeholder value")
    fi

    if [ ${#errors[@]} -gt 0 ]; then
        log_error "Environment variable issues found:"
        for error in "${errors[@]}"; do
            echo "  - $error"
        done
        log_warning "Please update your .env files before deploying"
        exit 1
    fi

    log_success "Environment variables look good"
}

# Stop existing containers
stop_existing() {
    log_info "Stopping existing containers..."

    if docker-compose ps -q 2>/dev/null | grep -q .; then
        docker-compose down
        log_success "Stopped existing containers"
    else
        log_info "No existing containers to stop"
    fi
}

# Pull Docker images
pull_images() {
    log_info "Pulling base Docker images..."

    docker-compose pull postgres redis

    log_success "Base images pulled"
}

# Build application images
build_images() {
    log_info "Building application images..."
    log_warning "This may take 5-10 minutes on first build..."

    docker-compose build --no-cache

    log_success "Application images built"
}

# Start services
start_services() {
    log_info "Starting services..."

    docker-compose up -d

    log_success "Services started"
}

# Wait for services to be healthy
wait_for_health() {
    log_info "Waiting for services to become healthy..."

    local max_attempts=60
    local attempt=0

    while [ $attempt -lt $max_attempts ]; do
        local healthy=true

        # Check postgres
        if ! docker-compose ps postgres | grep -q "Up (healthy)"; then
            healthy=false
        fi

        # Check redis
        if ! docker-compose ps redis | grep -q "Up (healthy)"; then
            healthy=false
        fi

        if $healthy; then
            log_success "All services are healthy"
            return 0
        fi

        attempt=$((attempt + 1))
        echo -n "."
        sleep 2
    done

    echo ""
    log_error "Services did not become healthy in time"
    log_info "Check logs with: docker-compose logs"
    return 1
}

# Verify deployment
verify_deployment() {
    log_info "Verifying deployment..."

    local errors=()

    # Check admin-backend health
    if ! curl -sf http://localhost:4000/api/health > /dev/null 2>&1; then
        errors+=("Admin Backend health check failed")
    fi

    # Check ai-runtime health
    if ! curl -sf http://localhost:8000/api/health > /dev/null 2>&1; then
        errors+=("AI Runtime health check failed")
    fi

    # Check frontend
    if ! curl -sf http://localhost:3000 > /dev/null 2>&1; then
        errors+=("Frontend is not accessible")
    fi

    if [ ${#errors[@]} -gt 0 ]; then
        log_error "Deployment verification failed:"
        for error in "${errors[@]}"; do
            echo "  - $error"
        done
        log_info "Check logs with: docker-compose logs -f"
        return 1
    fi

    log_success "All services verified successfully"
    return 0
}

# Show status
show_status() {
    echo ""
    echo "=========================================="
    echo "  Deployment Status"
    echo "=========================================="
    echo ""

    docker-compose ps

    echo ""
    echo "=========================================="
    echo "  Access URLs"
    echo "=========================================="
    echo ""
    echo "Frontend:       http://localhost:3000"
    echo "Admin Backend:  http://localhost:4000"
    echo "AI Runtime:     http://localhost:8000"
    echo ""
    echo "Swagger UI (Admin): http://localhost:4000/api/docs"
    echo "Swagger UI (Runtime): http://localhost:8000/docs"
    echo ""
}

# Show next steps
show_next_steps() {
    echo "=========================================="
    echo "  Next Steps"
    echo "=========================================="
    echo ""
    echo "1. Create super admin user:"
    echo "   See DEPLOYMENT_GUIDE.md for instructions"
    echo ""
    echo "2. Configure SSL (production):"
    echo "   Follow SSL/TLS Configuration in DEPLOYMENT_GUIDE.md"
    echo ""
    echo "3. Set up backups:"
    echo "   ./backup.sh"
    echo ""
    echo "4. Monitor logs:"
    echo "   docker-compose logs -f"
    echo ""
    echo "5. View container stats:"
    echo "   docker stats"
    echo ""
    echo "=========================================="
}

# Backup function
create_backup() {
    log_info "Creating backup..."

    local backup_dir="backups"
    local date=$(date +%Y%m%d_%H%M%S)

    mkdir -p $backup_dir

    # Backup database
    docker exec -t ai-query-postgres pg_dump -U postgres ai_query_platform | gzip > $backup_dir/db_backup_$date.sql.gz

    # Backup env files
    tar czf $backup_dir/env_backup_$date.tar.gz .env.*

    log_success "Backup created in $backup_dir/"
}

# Main deployment flow
main() {
    case "${1:-deploy}" in
        deploy)
            log_info "Starting deployment process..."
            check_env_files
            verify_env_variables
            check_docker
            check_docker_compose
            stop_existing
            pull_images
            build_images
            start_services
            sleep 5
            wait_for_health
            sleep 5
            verify_deployment
            show_status
            show_next_steps
            log_success "Deployment completed successfully!"
            ;;

        backup)
            create_backup
            ;;

        restart)
            log_info "Restarting services..."
            docker-compose restart
            log_success "Services restarted"
            ;;

        stop)
            log_info "Stopping services..."
            docker-compose down
            log_success "Services stopped"
            ;;

        start)
            log_info "Starting services..."
            docker-compose up -d
            wait_for_health
            verify_deployment
            show_status
            log_success "Services started"
            ;;

        logs)
            docker-compose logs -f
            ;;

        status)
            show_status
            ;;

        update)
            log_info "Updating application..."
            docker-compose down
            docker-compose build
            docker-compose up -d
            wait_for_health
            verify_deployment
            show_status
            log_success "Update completed"
            ;;

        *)
            echo "Usage: $0 {deploy|backup|restart|stop|start|logs|status|update}"
            echo ""
            echo "Commands:"
            echo "  deploy   - Full deployment (default)"
            echo "  backup   - Create database and config backup"
            echo "  restart  - Restart all services"
            echo "  stop     - Stop all services"
            echo "  start    - Start all services"
            echo "  logs     - View live logs"
            echo "  status   - Show service status"
            echo "  update   - Rebuild and restart services"
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"
