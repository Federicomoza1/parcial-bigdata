#!/usr/bin/env bash
set -euo pipefail

# Starts Backend (port 8000) and Frontend (port 3000) in the background on EC2.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f "config.yaml" ]; then
  echo "Copying config.example.yaml -> config.yaml (remember to edit your seed, IP, and S3 bucket!)"
  cp config.example.yaml config.yaml
fi

# Stop any previous instances
pkill -f "uvicorn backend.app:app" || true
pkill -f "frontend/server.py" || true

echo "Starting FastAPI backend on port 8000..."
nohup python3 -m uvicorn backend.app:app --host 0.0.0.0 --port 8000 --workers 1 > backend.log 2>&1 &

echo "Starting Frontend server on port 3000..."
nohup python3 frontend/server.py > frontend.log 2>&1 &

sleep 2
echo "Services started!"
echo "  Backend health:  $(curl -s http://127.0.0.1:8000/health || echo 'starting...')"
echo "  Frontend health: $(curl -s http://127.0.0.1:3000/health || echo 'starting...')"
