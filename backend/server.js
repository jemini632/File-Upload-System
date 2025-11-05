const express = require('express');
const multer = require('multer');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const redis = require('redis');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Redis client setup
const redisClient = redis.createClient({ url: REDIS_URL });
redisClient.on('error', (err) => console.error('Redis Client Error:', err));
redisClient.on('connect', () => console.log('✅ Redis connected successfully'));

// Connect to Redis
(async () => {
  try {
    await redisClient.connect();
    console.log('✅ Redis client initialized');
  } catch (error) {
    console.error('❌ Redis connection failed:', error);
  }
})();

// Create uploads directory if it doesn't exist
(async () => {
  try {
    await fs.access(UPLOAD_DIR);
    console.log('✅ Uploads directory exists');
  } catch {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    console.log('✅ Created uploads directory');
  }
})();

// Middleware
app.use(cors());
app.use(express.json());

// Rate limiting configurations
const uploadLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 uploads per minute
  message: { error: 'Too many upload requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const downloadLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 50, // 50 downloads per minute
  message: { error: 'Too many download requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueId = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname);
    const originalName = path.basename(file.originalname, ext);
    cb(null, `${uniqueId}_${originalName}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/mpeg',
    'video/quicktime',
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, images, and videos are allowed.'));
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
});

// Helper function to get file metadata
async function getFileMetadata(filename) {
  const filePath = path.join(UPLOAD_DIR, filename);
  const stats = await fs.stat(filePath);
  const fileId = filename.split('_')[0];
  
  return {
    id: fileId,
    filename: filename.substring(filename.indexOf('_') + 1),
    storedFilename: filename,
    size: stats.size,
    uploadDate: stats.birthtime,
    mimetype: getMimeType(filename),
  };
}

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.mpeg': 'video/mpeg',
    '.mov': 'video/quicktime',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// Cache helper functions
async function getCachedData(key) {
  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Redis get error:', error);
    return null;
  }
}

async function setCachedData(key, data, ttl = 300) {
  try {
    await redisClient.setEx(key, ttl, JSON.stringify(data));
  } catch (error) {
    console.error('Redis set error:', error);
  }
}

async function deleteCachedData(key) {
  try {
    await redisClient.del(key);
  } catch (error) {
    console.error('Redis delete error:', error);
  }
}

// Routes

// POST /upload - Upload file
app.post('/api/upload', uploadLimiter, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileMetadata = await getFileMetadata(req.file.filename);
    
    // Cache the file metadata
    await setCachedData(`file:${fileMetadata.id}`, fileMetadata, 3600); // Cache for 1 hour
    
    // Invalidate the files list cache
    await deleteCachedData('files:list');

    console.log(`✅ File uploaded: ${fileMetadata.filename}`);

    res.status(200).json({
      message: 'File uploaded successfully',
      file: fileMetadata,
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// GET /download/:id - Download file with chunked streaming
app.get('/api/download/:id', downloadLimiter, async (req, res) => {
  try {
    const fileId = req.params.id;
    
    // Check cache first
    let fileMetadata = await getCachedData(`file:${fileId}`);
    
    if (!fileMetadata) {
      // Find file by ID
      const files = await fs.readdir(UPLOAD_DIR);
      const file = files.find(f => f.startsWith(fileId + '_'));
      
      if (!file) {
        return res.status(404).json({ error: 'File not found' });
      }
      
      fileMetadata = await getFileMetadata(file);
      await setCachedData(`file:${fileId}`, fileMetadata, 3600);
    }

    const filePath = path.join(UPLOAD_DIR, fileMetadata.storedFilename);
    
    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      await deleteCachedData(`file:${fileId}`);
      return res.status(404).json({ error: 'File not found' });
    }

    // Set headers
    res.setHeader('Content-Type', fileMetadata.mimetype);
    res.setHeader('Content-Disposition', `attachment; filename="${fileMetadata.filename}"`);
    res.setHeader('Content-Length', fileMetadata.size);

    // Stream the file in chunks
    const fileStream = require('fs').createReadStream(filePath, {
      highWaterMark: 64 * 1024, // 64KB chunks
    });

    fileStream.on('error', (error) => {
      console.error('Stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error streaming file' });
      }
    });

    console.log(`📥 Downloading: ${fileMetadata.filename}`);
    fileStream.pipe(res);
  } catch (error) {
    console.error('Download error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to download file' });
    }
  }
});

// GET /files - List all files with metadata
app.get('/api/files', generalLimiter, async (req, res) => {
  try {
    // Check cache first
    const cachedFiles = await getCachedData('files:list');
    
    if (cachedFiles) {
      console.log('📦 Serving files list from cache');
      return res.status(200).json({ files: cachedFiles, cached: true });
    }

    // Read files from directory
    const files = await fs.readdir(UPLOAD_DIR);
    
    const filesMetadata = await Promise.all(
      files
        .filter(f => f !== '.gitkeep')
        .map(async (file) => {
          try {
            return await getFileMetadata(file);
          } catch (error) {
            console.error(`Error getting metadata for ${file}:`, error);
            return null;
          }
        })
    );

    // Filter out any null values
    const validFiles = filesMetadata.filter(f => f !== null);
    
    // Sort by upload date (newest first)
    validFiles.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));

    // Cache the result for 5 minutes
    await setCachedData('files:list', validFiles, 300);

    console.log(`📋 Listed ${validFiles.length} files`);
    res.status(200).json({ files: validFiles, cached: false });
  } catch (error) {
    console.error('List files error:', error);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    redis: redisClient.isOpen,
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large. Maximum size is 100MB.' });
    }
    return res.status(400).json({ error: error.message });
  }
  
  res.status(500).json({ error: error.message || 'Internal server error' });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  await redisClient.quit();
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('🚀 ================================');
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🚀 API URL: http://localhost:${PORT}`);
  console.log(`🚀 Upload directory: ${UPLOAD_DIR}`);
  console.log('🚀 ================================');
  console.log('');
});