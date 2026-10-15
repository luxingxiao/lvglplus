FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55
RUN apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    cmake ninja-build gcc g++ python3 python3-venv iproute2 can-utils kmod \
    && rm -rf /var/lib/apt/lists/*
COPY requirements-build.txt /opt/lvglplus/requirements.txt
RUN python3 -m venv /opt/lvglplus/venv && /opt/lvglplus/venv/bin/pip install --no-cache-dir -r /opt/lvglplus/requirements.txt
ENV PATH="/opt/lvglplus/venv/bin:${PATH}"
WORKDIR /src
