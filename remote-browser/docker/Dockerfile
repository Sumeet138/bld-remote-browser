# Chromium-only container for remote browser control.
# The Node.js backend runs on the host and connects via the published CDP port.
#
# Architecture note: socat proxy bridges the Docker NAT gap.
# Chromium listens on 127.0.0.1:9223 (loopback only).
# socat listens on 0.0.0.0:9222 and forwards to 9223,
# making all connections appear to Chromium as coming from localhost.
# See docs/ARCHITECTURE.md §4.1 for the Docker Desktop CDP problem and fix.

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    chromium \
    socat \
    curl \
    xvfb \
    fonts-liberation \
    fonts-noto-color-emoji \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -d /home/chromium chromium

COPY start.sh /start.sh
RUN chmod +x /start.sh

USER chromium
WORKDIR /home/chromium
RUN mkdir -p /home/chromium/data

# Published externally (socat listens here)
EXPOSE 9222

CMD ["/start.sh"]
