FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ENV=production

WORKDIR /app

# Install deps first so the layer caches across source changes
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# AWS Lambda Web Adapter: a Lambda extension that implements the Lambda
# Runtime API and proxies invocations to the local uvicorn server, so
# this image runs unchanged both on Lambda and standalone (docker run).
# Outside Lambda the /opt/extensions dir is simply ignored.
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.8.4 \
    /lambda-adapter /opt/extensions/lambda-adapter

COPY app ./app

# Run as an unprivileged user, not root
RUN useradd --create-home --uid 1000 appuser && chown -R appuser:appuser /app
USER appuser

ENV PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,os,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8000')+'/healthz').status==200 else 1)"

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
