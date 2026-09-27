FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . ./

# Matches the app's own default (server.py reads $PORT, falling back to 8000).
# Platforms that inject their own PORT (Render, Railway, Fly, etc.) override
# this automatically; a plain `docker run` will correctly listen on 8000.
EXPOSE 8000

CMD ["python", "server.py"]
