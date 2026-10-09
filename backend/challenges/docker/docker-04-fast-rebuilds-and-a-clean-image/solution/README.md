# Solution — Fast Rebuilds and a Clean Image

Two problems with one cause: `COPY . .` copies **everything** in the folder, before anything else.

- **Slow:** every edit to `app.py` changes that `COPY` layer, so every layer after it (including `pip install`) runs again.
- **Dirty:** `.git`, logs, tests, bytecode and `.env` (with a live payment key!) end up inside the image, where anyone who pulls it can read them.

Docs: [.dockerignore](https://docs.docker.com/build/concepts/context/#dockerignore-files) · [Build cache](https://docs.docker.com/build/cache/)

## See the problem

```bash
cd ~/order-processor
ls -A                                   # .env .git logs tests __pycache__ wheels ...
du -sh .git logs
docker build -t quickbyte/order-processor:1.5 .      # "transferring context: 9MB"
docker run --rm --entrypoint ls quickbyte/order-processor:1.5 -A /app
docker run --rm --entrypoint cat quickbyte/order-processor:1.5 /app/.env   # the key, leaked
```

## .dockerignore

```bash
nano ~/order-processor/.dockerignore
```

```text
.git
.env
logs
tests
__pycache__
*.pyc
Dockerfile
.dockerignore
```

`.dockerignore` filters the **build context**, the files the CLI sends to the builder. Excluded files can't be copied by any instruction, and the context upload gets smaller and faster.

## Reorder the Dockerfile

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
COPY wheels/ ./wheels/
RUN pip install --no-cache-dir --no-index --find-links=wheels -r requirements.txt \
    && rm -rf wheels

COPY app.py .

ENV APP_VERSION=v1.5
EXPOSE 8000

CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "2", "app:app"]
```

- Things that rarely change (requirements, wheels, the install) go **first**; the code that changes all the time goes **last**.
- Copy `app.py` by name: `/app` gets exactly what the app needs.
- `rm -rf wheels` in the **same** `RUN` keeps the wheels out of the final filesystem.

## Build and prove the cache works

```bash
docker build -t quickbyte/order-processor:1.5 ~/order-processor
docker run --rm --entrypoint ls quickbyte/order-processor:1.5 -A /app      # app.py requirements.txt
echo '# tweak' >> ~/order-processor/app.py
docker build --progress=plain -t quickbyte/order-processor:1.5 ~/order-processor 2>&1 | grep -A1 'pip install'
# #8 CACHED
```

Docker reuses a layer when its instruction **and everything before it** are unchanged. Only `COPY app.py` and what follows run again: a rebuild in about a second.

Then **Submit**.
