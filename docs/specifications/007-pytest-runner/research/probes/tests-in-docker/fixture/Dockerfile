FROM python:3.11-slim-bookworm
ENV PYTHONUNBUFFERED=1 PYTHONPATH=/deps
RUN pip install --no-cache-dir --target /deps pytest==8.4.2 "psycopg[binary]==3.2.10" pytest-xdist==3.8.0
WORKDIR /work
LABEL org.squeal.probe=tests-in-docker
