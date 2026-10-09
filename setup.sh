#!/usr/bin/env bash
# setup.sh — Production Workspace bootstrap for Omarchy (Arch Linux)
# Usage:  bash setup.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

echo "==> Repo: $REPO_DIR"

# ---------------------------------------------------------------
# 1. System packages (Arch / Omarchy)
# ---------------------------------------------------------------
echo "==> Installing system dependencies (Tesseract + OpenCV libs)…"
sudo pacman -Syu --needed --noconfirm \
  python \
  python-pip \
  python-virtualenv \
  tesseract \
  tesseract-data-eng \
  opencv \
  python-numpy \
  base-devel \
  git \
  curl

# ---------------------------------------------------------------
# 2. Python virtual environment
# ---------------------------------------------------------------
VENV_DIR="$REPO_DIR/.venv"
if [ ! -d "$VENV_DIR" ]; then
  echo "==> Creating virtualenv at $VENV_DIR"
  python -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

echo "==> Upgrading pip / wheel / setuptools"
pip install --upgrade pip wheel setuptools

# ---------------------------------------------------------------
# 3. Python requirements
# ---------------------------------------------------------------
if [ -f requirements.txt ]; then
  echo "==> Installing Python requirements"
  pip install -r requirements.txt
else
  echo "!! requirements.txt not found — aborting"
  exit 1
fi

# ---------------------------------------------------------------
# 4. Data folders
# ---------------------------------------------------------------
mkdir -p data/uploads

# ---------------------------------------------------------------
# 5. .env bootstrap (if missing)
# ---------------------------------------------------------------
if [ ! -f .env ]; then
  echo "==> Creating .env from defaults"
  cat > .env << 'EOF'
PORT=5000
DB_PATH=data/workspace.db
USE_AGENT=1
AGENT_URL=https://flat-waterfall-436c.josephsanjari1996.workers.dev
# AGENT_TOKEN=
EOF
  chmod 600 .env
fi

# ---------------------------------------------------------------
# 6. Sanity check — confirm folder layout
# ---------------------------------------------------------------
echo "==> Verifying layout"
for f in index.html requirements.txt server/app.py server/db.py server/storyboard.py server/agent_proxy.py static/app.js static/style.css; do
  if [ -f "$f" ]; then
    echo "  ✓ $f"
  else
    echo "  ✗ MISSING: $f"
  fi
done

echo
echo "==============================================="
echo " ✅  Setup complete"
echo "==============================================="
echo
echo "To start the server:"
echo "    source .venv/bin/activate"
echo "    python server/app.py"
echo
echo "Then open: http://localhost:5000"