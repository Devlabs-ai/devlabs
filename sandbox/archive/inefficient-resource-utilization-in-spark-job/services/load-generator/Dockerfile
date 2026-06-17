FROM python:3.11-alpine
RUN apk add --no-cache py3-pip
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY app.py .
CMD ["python", "app.py"]