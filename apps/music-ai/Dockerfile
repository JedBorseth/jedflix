FROM python:3.12-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
	PYTHONUNBUFFERED=1 \
	PIP_NO_CACHE_DIR=1 \
	HF_HOME=/models \
	HUGGINGFACE_HUB_CACHE=/models \
	TRANSFORMERS_CACHE=/models \
	HF_HUB_DISABLE_TELEMETRY=1

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates libgomp1 \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
	&& pip install --no-cache-dir torch==2.6.0 --extra-index-url https://download.pytorch.org/whl/cu124 \
	&& pip install --no-cache-dir -r /app/requirements.txt

COPY . /app
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
