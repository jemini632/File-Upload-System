# File-Upload-System

A full-stack file upload system with REST API, Redis caching, rate limiting, and Docker support.

## Features

### Backend Features
- **REST API Endpoints**
  - `POST /api/upload` - Upload large files (PDF, images, videos)
  - `GET /api/download/:id` - Download files with chunked streaming
  - `GET /api/files` - List all uploaded files with metadata
  - `GET /api/health` - Health check endpoint

- **Rate Limiting**
  - Upload endpoint: 10 requests/minute
  - Download endpoint: 50 requests/minute
  - General endpoints: 100 requests/minute
  - IP-based rate limiting using `express-rate-limit`

- **Caching & Performance**
  - Redis integration for file metadata caching
  - Cached file list for frequently accessed data
  - Chunked streaming for large file downloads (64KB chunks)
  - Cache TTL: 1 hour for file metadata, 5 minutes for file lists

- **Security**
  - File type validation (PDF, images, videos only)
  - File size limit: 100MB
  - Non-root user in Docker container
  - CORS enabled for cross-origin requests

- **Dockerization**
  - Multi-stage Docker build for optimized image size
  - Docker Compose configuration with Redis
  - Health checks for both services
  - Persistent volume for uploads

### Frontend Features
- Modern React UI with Tailwind CSS
- Real-time upload progress tracking
- File list with metadata display
- Drag-and-drop file selection
- Download functionality
- Responsive design

## Project Structure

```
file-upload-system/
├── backend/
│   ├── server.js              # Main Express server
│   ├── package.json           # Backend dependencies
│   ├── Dockerfile            # Multi-stage Docker build
│   ├── docker-compose.yml    # Docker Compose configuration
│   ├── .dockerignore         # Docker ignore rules
│   └── uploads/              # Upload directory (created automatically)
│
└── frontend/
    ├── src/
    │   └── App.jsx           # React application
    ├── package.json          # Frontend dependencies
    └── public/
```

## Prerequisites

- Node.js 18+ and npm
- Docker and Docker Compose (for containerized deployment)
- Redis (or use Docker Compose)

## Installation & Setup

### Option 1: Local Development

#### Backend Setup

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Make sure Redis is running locally:
```bash
# Using Docker
docker run -d -p 6379:6379 redis:7-alpine

# Or install Redis locally
# Mac: brew install redis && redis-server
# Ubuntu: sudo apt-get install redis-server && redis-server
```

4. Start the backend server:

npm start


The server will start on `http://localhost:5000`

#### Frontend Setup

1. Navigate to the frontend directory:

cd frontend


2. Install dependencies:

npm install
```

3. Start the development server:

npm start
```

The React app will start on `http://localhost:3000`

### Option 2: Docker Deployment

1. Navigate to the backend directory:

cd backend
```

2. Build and start all services using Docker Compose:

docker-compose up --build
```

This will:
- Build the backend Docker image using multi-stage build
- Start Redis container
- Start the backend API container
- Create a Docker network for inter-service communication

3. Access the API at `http://localhost:5000`

4. To stop the services:

docker-compose down
```

5. To stop and remove volumes:

docker-compose down -v
```

## API Documentation

### Upload File
```http
POST /api/upload
Content-Type: multipart/form-data

Field: file (binary)
```

**Response:**
```json
{
  "message": "File uploaded successfully",
  "file": {
    "id": "abc123...",
    "filename": "document.pdf",
    "size": 1024000,
    "uploadDate": "2025-11-04T10:30:00.000Z",
    "mimetype": "application/pdf"
  }
}
```

### Download File
```http
GET /api/download/:id
```

**Response:** File stream with appropriate headers

### List Files
```http
GET /api/files
```

**Response:**
```json
{
  "files": [
    {
      "id": "abc123...",
      "filename": "document.pdf",
      "size": 1024000,
      "uploadDate": "2025-11-04T10:30:00.000Z",
      "mimetype": "application/pdf"
    }
  ],
  "cached": false
}
```

### Health Check
```http
GET /api/health
```

**Response:**
```json
{
  "status": "OK",
  "redis": true
}
```

## Rate Limiting

The API implements different rate limits for different endpoints:

- **Upload Endpoint**: 10 requests per minute per IP
- **Download Endpoint**: 50 requests per minute per IP
- **Other Endpoints**: 100 requests per minute per IP

When rate limit is exceeded, the API returns:
```json
{
  "error": "Too many requests, please try again later."
}
```

## Caching Strategy

### File Metadata Caching
- Individual file metadata is cached in Redis with a 1-hour TTL
- Cache key format: `file:{fileId}`
- Cache is populated on upload and first access
- Cache is invalidated when file is deleted

### File List Caching
- Complete file list is cached for 5 minutes
- Cache key: `files:list`
- Cache is invalidated on new uploads
- Reduces disk I/O for frequently accessed file listings

## Docker Multi-Stage Build

The Dockerfile uses a multi-stage build process to optimize image size:

1. **Builder Stage**: Installs all dependencies including devDependencies
2. **Production Stage**: 
   - Uses Alpine Linux for minimal size
   - Copies only production dependencies
   - Runs as non-root user for security
   - Includes health check

**Image Size Comparison:**
- Single-stage build: ~200MB
- Multi-stage build: ~120MB

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `5000` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `NODE_ENV` | Node environment | `development` |

## Supported File Types

- **Documents**: PDF
- **Images**: JPEG, PNG, GIF, WebP
- **Videos**: MP4, MPEG, QuickTime (MOV)

## File Size Limit

Maximum file size: **100MB**

## Security Considerations

1. **File Type Validation**: Only allowed file types can be uploaded
2. **Rate Limiting**: Prevents abuse and DDoS attacks
3. **Non-root User**: Docker container runs as non-root user
4. **File Size Limits**: Prevents storage exhaustion
5. **CORS**: Configured for cross-origin requests
6. **Error Handling**: Sensitive information is not exposed in error messages



## Monitoring

### Check Redis Cache
```bash
# Connect to Redis CLI
docker exec -it file-upload-redis redis-cli

# View all keys
KEYS *

# Get file metadata
GET file:{fileId}

# Check TTL
TTL file:{fileId}
```

### View Logs
```bash
# Backend logs
docker-compose logs -f backend

# Redis logs
docker-compose logs -f redis
```

## Performance Optimization

1. **Chunked Streaming**: Large files are streamed in 64KB chunks to reduce memory usage
2. **Redis Caching**: Frequently accessed metadata is cached to reduce disk I/O
3. **Multi-stage Build**: Optimized Docker image size for faster deployments
4. **Alpine Linux**: Minimal base image for reduced attack surface and size

## Troubleshooting

### Redis Connection Error
```bash
# Check if Redis is running
docker ps | grep redis

# Restart Redis
docker-compose restart redis
```

### Port Already in Use
```bash
# Change port in docker-compose.yml or .env file
PORT=5001
```

### Upload Directory Permissions
```bash
# Fix permissions
sudo chown -R $USER:$USER uploads/
chmod 755 uploads/
```

## Production Deployment

1. Set environment variables:
```bash
export NODE_ENV=production
export REDIS_URL=redis://your-redis-host:6379
```

2. Use a process manager like PM2:
```bash
npm install -g pm2
pm2 start server.js --name file-upload-api
```

3. Use nginx as reverse proxy for better performance
4. Enable HTTPS using Let's Encrypt
5. Set up monitoring and logging (e.g., Winston, Morgan)
6. Configure backup strategy for uploads directory

## License

MIT

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.