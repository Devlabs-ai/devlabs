FROM python:3.11-alpine
RUN apk add --no-cache gcc musl-dev postgresql-dev
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY seed_and_monitor.py .
CMD ["python", "seed_and_monitor.py"]
