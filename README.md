# GrooveScope Backend

A cloud-based backend service that extracts audio from YouTube videos and generates peak data for waveform visualization using wavesurfer.js. Built for Chrome extension integration.

## Features

- 🎵 YouTube audio extraction via RapidAPI
- 📊 Peak data generation for wavesurfer.js
- 💾 Supabase integration for caching
- 🚀 Deployed on Render
- 🔒 CORS support for Chrome extensions
- ⚡ Rate limiting and security middleware
- 📈 Health monitoring and statistics

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: Supabase (PostgreSQL)
- **Deployment**: Render
- **API**: YouTube to MP3 (RapidAPI)
- **Audio Processing**: Custom peak extraction

## Quick Start

### 1. Prerequisites

- Node.js 18 or higher
- RapidAPI account with YouTube to MP3 API access
- Supabase project
- Render account (for deployment)

### 2. Setup

1. **Clone and install dependencies:**
   ```bash
   git clone <your-repo-url>
   cd groovescope-backend
   npm install
   ```

2. **Environment configuration:**
   ```bash
   cp env.example .env
   # Edit .env with your actual values
   ```

3. **Database setup:**
   - Create a new Supabase project
   - Run the SQL script from `database/supabase.sql` in your Supabase SQL editor
   - Copy your project URL and anon key to `.env`

4. **API setup:**
   - Sign up for RapidAPI
   - Subscribe to the [YouTube to MP3 API](https://rapidapi.com/marcocollatina/api/youtube-to-mp315)
   - Copy your API key to `.env`

### 3. Local Development

```bash
# Start development server
npm run dev

# Or start production server
npm start

# Health check
curl http://localhost:3000/api/health
```

## API Endpoints

### Core Endpoints

- `GET /` - Service information
- `GET /api/health` - Health check
- `GET /api/health/detailed` - Detailed health check

### Audio Processing

- `POST /api/audio/process` - Process YouTube video
  ```json
  {
    "youtubeUrl": "https://youtube.com/watch?v=VIDEO_ID",
    "quality": "medium"
  }
  ```

- `GET /api/audio/peaks/:videoId` - Get cached peaks data
- `DELETE /api/audio/cache/:videoId` - Clear cache for video
- `GET /api/audio/stats` - Processing statistics

### Example Request

```javascript
// Chrome extension example
fetch('https://your-backend.onrender.com/api/audio/process', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    youtubeUrl: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
    quality: 'medium'
  })
})
.then(response => response.json())
.then(data => {
  if (data.success) {
    // Use data.data.peaks with wavesurfer.js
    wavesurfer.load(null, data.data.peaks);
  }
});
```

## Deployment

### Render Deployment

1. **Connect your GitHub repository to Render**

2. **Set environment variables in Render dashboard:**
   - `RAPIDAPI_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `NODE_ENV=production`

3. **Deploy:**
   - Render will automatically deploy from `render.yaml`
   - Health checks will ensure service availability

### Manual Docker Deployment

```bash
# Build image
docker build -t groovescope-backend .

# Run container
docker run -p 3000:3000 \
  -e RAPIDAPI_KEY=your_key \
  -e SUPABASE_URL=your_url \
  -e SUPABASE_ANON_KEY=your_key \
  groovescope-backend
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RAPIDAPI_KEY` | Yes | Your RapidAPI key for YouTube to MP3 API |
| `SUPABASE_URL` | Yes | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Your Supabase anonymous key |
| `NODE_ENV` | No | Environment (development/production) |
| `PORT` | No | Server port (default: 3000) |
| `FRONTEND_URL` | No | Frontend URL for CORS |

### Audio Quality Options

- `low` - 128kbps
- `medium` - 192kbps (default)
- `high` - 320kbps

## Chrome Extension Integration

The backend is designed to work with Chrome extensions. CORS is configured to allow:

- `chrome-extension://*`
- `moz-extension://*`
- Localhost (for development)

### Extension Manifest v3 Example

```json
{
  "host_permissions": [
    "https://your-backend.onrender.com/*"
  ],
  "permissions": [
    "activeTab"
  ]
}
```

## Database Schema

The Supabase database includes:

- `audio_cache` - Cached peaks data and metadata
- `api_usage` - API usage tracking
- `system_health` - Health monitoring

See `database/supabase.sql` for the complete schema.

## Error Handling

The API returns structured error responses:

```json
{
  "error": "Error type",
  "message": "Human-readable error message",
  "retryAfter": 60
}
```

Common error codes:
- `400` - Invalid request
- `404` - Video not found
- `429` - Rate limit exceeded
- `500` - Server error

## Performance

- **Caching**: Results are cached in Supabase to avoid reprocessing
- **Rate Limiting**: 100 requests per 15 minutes per IP
- **Compression**: Gzip compression enabled
- **Security**: Helmet.js security headers

## Monitoring

- Health checks at `/api/health`
- Processing statistics at `/api/audio/stats`
- Automatic error logging
- Database health monitoring

## Development

### Project Structure

```
groovescope-backend/
├── routes/           # Express routes
├── services/         # Business logic
├── database/         # Database schemas
├── server.js         # Main server file
├── package.json      # Dependencies
├── render.yaml       # Render deployment
├── Dockerfile        # Docker configuration
└── README.md         # This file
```

### Adding New Features

1. Create route handlers in `routes/`
2. Add business logic to `services/`
3. Update database schema if needed
4. Add environment variables to `env.example`
5. Update this README

## Troubleshooting

### Common Issues

1. **API Key Issues**
   - Verify RapidAPI subscription
   - Check key in environment variables

2. **Database Connection**
   - Verify Supabase URL and keys
   - Check RLS policies

3. **CORS Errors**
   - Verify frontend URL in CORS configuration
   - Check Chrome extension permissions

### Debug Mode

Set `NODE_ENV=development` for detailed error messages.

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review API health at `/api/health/detailed`
3. Check server logs on Render dashboard
4. Verify all environment variables are set

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

---

Built with ❤️ for the GrooveScope project
