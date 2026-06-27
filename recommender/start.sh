# Start the WebMedia Recommender API
# Usage: ./start.sh [port]

cd "$(dirname "$0")"
PORT=${1:-7860}

if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
else
    source venv/bin/activate
fi

echo "Starting Recommender API on port $PORT..."
python3 app.py --port "$PORT"
