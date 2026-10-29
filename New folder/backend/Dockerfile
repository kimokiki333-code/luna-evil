FROM node:20-bookworm-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg fonts-noto-core fonts-noto-extra ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt
COPY server.mjs subtitle_worker.py ./
RUN mkdir -p /tmp/badr/uploads /tmp/badr/jobs
EXPOSE 8787
CMD ["node","server.mjs"]
