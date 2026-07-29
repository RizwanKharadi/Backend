#!/bin/zsh

# Individual Service Deployment Script for Heroku
set -e

echo "🚀 Deploying individual services to Heroku..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# App names
BACKEND_APP="finsync-backend"
FRONTEND_APP="finsync-frontend"
ML_APP="finsync-ml"

# Set MONGODB_URI in your environment before running — never commit credentials
if [[ -z "$MONGODB_URI" ]]; then
  print_error "Export MONGODB_URI before running this script."
  exit 1
fi

# Deploy Backend
print_status "Deploying Backend Service..."
cd backend

# Initialize git if not already done
if [ ! -d ".git" ]; then
    git init
    heroku git:remote -a $BACKEND_APP
fi

# Set MongoDB URI
print_status "Setting MongoDB Atlas URI..."
heroku config:set MONGODB_URI="$MONGODB_URI" -a $BACKEND_APP
heroku config:set LICENSE_ENFORCEMENT=true -a $BACKEND_APP

# Add and commit changes
git add .
git commit -m "Deploy backend to Heroku" || echo "No changes to commit"

# Push to Heroku
print_status "Pushing backend to Heroku..."
git push heroku master --force

print_success "Backend deployed successfully!"
cd ..

# Deploy Frontend (Next.js — frontend-nextjs/)
print_status "Deploying Frontend Service (Next.js)..."
cd frontend-nextjs

# Initialize git if not already done
if [ ! -d ".git" ]; then
    git init
    heroku git:remote -a $FRONTEND_APP
fi

# Set environment variables
print_status "Setting frontend environment variables..."
heroku config:set NEXT_PUBLIC_API_URL="https://finsync-backend-d34180691b06.herokuapp.com/api" -a $FRONTEND_APP

# Add and commit changes
git add .
git commit -m "Deploy frontend to Heroku" || echo "No changes to commit"

# Push to Heroku
print_status "Pushing frontend to Heroku..."
git push heroku master --force

print_success "Frontend deployed successfully!"
cd ..

# Deploy ML Service
print_status "Deploying ML Service..."
cd ml-service

# Initialize git if not already done
if [ ! -d ".git" ]; then
    git init
    heroku git:remote -a $ML_APP
fi

# Set buildpack
heroku buildpacks:set heroku/python -a $ML_APP

# Set environment variables
print_status "Setting ML service environment variables..."
heroku config:set DEBUG=false -a $ML_APP
heroku config:set HOST=0.0.0.0 -a $ML_APP
heroku config:set SECRET_KEY=$(openssl rand -base64 32) -a $ML_APP
heroku config:set MONGODB_URL="$MONGODB_URI" -a $ML_APP
heroku config:set BACKEND_API_URL="https://finsync-backend-d34180691b06.herokuapp.com/api" -a $ML_APP

# Add and commit changes
git add .
git commit -m "Deploy ML service to Heroku" || echo "No changes to commit"

# Push to Heroku
print_status "Pushing ML service to Heroku..."
git push heroku master --force

print_success "ML Service deployed successfully!"
cd ..

# Final summary
print_success "🎉 All services deployed successfully!"
echo ""
echo "📋 Application URLs:"
echo "  🖥️  Frontend:   https://finsync-frontend-62084a54426d.herokuapp.com/"
echo "  🔧 Backend:    https://finsync-backend-d34180691b06.herokuapp.com/"
echo "  🤖 ML Service: https://finsync-ml-2bba4152b555.herokuapp.com/"
echo ""
echo "🔍 Check deployment status:"
echo "  heroku logs --tail -a $BACKEND_APP"
echo "  heroku logs --tail -a $FRONTEND_APP"
echo "  heroku logs --tail -a $ML_APP"
echo ""
print_success "Deployment completed!"
