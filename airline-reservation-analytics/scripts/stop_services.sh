#!/usr/bin/env bash
set -euo pipefail

echo "Stopping backend and frontend services..."
pkill -f "uvicorn backend.app:app" || true
pkill -f "frontend/server.py" || true
echo "Stopped."
