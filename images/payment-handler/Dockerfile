FROM python:3.12-slim

ARG APP_VERSION=v1.0
ENV APP_VERSION=${APP_VERSION}

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --create-home --uid 1000 --shell /usr/sbin/nologin appuser

COPY app.py .

RUN chown -R appuser:appuser /app

EXPOSE 8000

USER 1000

CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "2", "app:app"]
