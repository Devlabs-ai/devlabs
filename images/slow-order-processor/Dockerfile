FROM python:3.12-slim

ARG APP_VERSION=1.0
ENV APP_VERSION=${APP_VERSION}
ENV BOOT_DELAY_SECONDS=25

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 8000

USER nobody

CMD ["./entrypoint.sh"]
