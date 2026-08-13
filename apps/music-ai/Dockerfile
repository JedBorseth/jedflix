FROM nvidia/cuda:12.4.1-base-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
	PYTHONUNBUFFERED=1 \
	PIP_NO_CACHE_DIR=1 \
	HF_HOME=/models \
	HUGGINGFACE_HUB_CACHE=/models \
	TRANSFORMERS_CACHE=/models \
	HF_HUB_DISABLE_TELEMETRY=1

RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 python3-pip python3-venv ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip3 install --no-cache-dir --upgrade pip \
	&& pip3 install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cu124 \
	&& pip3 install --no-cache-dir -r /app/requirements.txt

COPY . /app
EXPOSE 8000
CMD ["python3", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
