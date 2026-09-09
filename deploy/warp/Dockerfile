FROM debian:trixie-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl gnupg dbus iproute2 socat \
	&& curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg \
		| gpg --dearmor -o /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg \
	&& echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ trixie main" \
		> /etc/apt/sources.list.d/cloudflare-client.list \
	&& apt-get update \
	&& apt-get install -y --no-install-recommends cloudflare-warp \
	&& rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh healthcheck.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/healthcheck.sh

# SOCKS5 is exposed only on the Compose network. Do not publish this port on the host.
EXPOSE 40000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
	CMD ["/usr/local/bin/healthcheck.sh"]

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
