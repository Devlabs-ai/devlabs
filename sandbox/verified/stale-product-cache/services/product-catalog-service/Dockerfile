FROM python:3.11-alpine

RUN apk add --no-cache gcc musl-dev postgresql-dev libffi-dev

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 5000

CMD ["python", "app.py"]
