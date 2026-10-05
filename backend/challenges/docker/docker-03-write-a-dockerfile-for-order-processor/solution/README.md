# Solution — Write a Dockerfile for Order Processor

A **Dockerfile** is the recipe for an image: start from a base image, add files, run setup commands, and record how the app starts. `docker build` follows it top to bottom; every instruction becomes a **layer** stacked on the base.

Docs: [Dockerfile reference](https://docs.docker.com/reference/dockerfile/) · `docker build --help`

## Look at what you're packaging

```bash
cd ~/order-processor
ls                      # app.py  requirements.txt  wheels/
cat requirements.txt    # flask, gunicorn
ls wheels               # pre-downloaded packages: this box has no internet
```

## The Dockerfile

```bash
nano ~/order-processor/Dockerfile
```

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
COPY wheels/ ./wheels/
RUN pip install --no-cache-dir --no-index --find-links=wheels -r requirements.txt \
    && rm -rf wheels

COPY app.py .

ENV APP_VERSION=v1.3
EXPOSE 8000

CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "2", "app:app"]
```

- `FROM python:3.12-slim`: Debian with Python 3.12 and nothing else. Your layers go on top.
- `WORKDIR /app`: creates `/app` and makes it the current directory for the following instructions and for the running app.
- `COPY` paths on the left are relative to the **build context** (the folder you pass to `docker build`).
- `--no-index --find-links=wheels`: install only from the local folder, never from PyPI. Offline builds are reproducible: the same wheels every time.
- `ENV` is baked into the image; `docker run -e` can still override it.
- `EXPOSE` documents the port. It does **not** publish it; `-p` does that.
- `CMD [...]` (exec form) runs gunicorn as PID 1, so `docker stop`'s SIGTERM reaches it and it shuts down cleanly. Shell form (`CMD gunicorn ...`) puts `/bin/sh` in front, which swallows the signal; Docker then waits 10 s and kills it.

## Build

```bash
docker build -t quickbyte/order-processor:1.3 ~/order-processor
docker images quickbyte/order-processor
docker history quickbyte/order-processor:1.3    # one line per layer
```

The last argument is the build context: the folder whose files `COPY` can see.

## Run it

```bash
docker run -d --name op-13 -p 8081:8000 quickbyte/order-processor:1.3
curl http://127.0.0.1:8081/health
# {"status":"ok","version":"v1.3"}
docker logs op-13
```

## Changed something?

An image is immutable and a running container keeps the image it started from. After editing and rebuilding, replace the container:

```bash
docker build -t quickbyte/order-processor:1.3 ~/order-processor
docker rm -f op-13
docker run -d --name op-13 -p 8081:8000 quickbyte/order-processor:1.3
```

Then **Submit**. The grader also starts its own container from your image, so the image must work on its own.
