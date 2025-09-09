const axios = require('axios');
const { createTimer } = require('../utils/perf');

class YouTubeService {
  constructor() {
    this.rapidApiKey = process.env.RAPIDAPI_KEY;
    this.rapidApiHost = 'youtube-cdn-progress.p.rapidapi.com';
    this.baseUrl = 'https://youtube-cdn-progress.p.rapidapi.com';
    this.sseBaseUrl = 'https://cdn-ytb.zm.io.vn';
  }

  /**
   * Extract video ID from YouTube URL
   * @param {string} url - YouTube URL
   * @returns {string|null} - Video ID or null if invalid
   */
  extractVideoId(url) {
    try {
      const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
      const match = url.match(regex);
      return match ? match[1] : null;
    } catch (error) {
      console.error('Error extracting video ID:', error);
      return null;
    }
  }

  /**
   * Start conversion using the new YouTube CDN Progress API
   * @param {string} youtubeUrl - YouTube video URL
   * @param {string} quality - Audio quality (low, medium, high)
   * @returns {Object} - Conversion job information
   */
  async startConversion(youtubeUrl, quality = 'medium') {
    try {
      const timer = createTimer('youtube.startConversion');
      if (!this.rapidApiKey) {
        throw new Error('RapidAPI key not configured');
      }

      const videoId = this.extractVideoId(youtubeUrl);
      if (!videoId) {
        throw new Error('Invalid YouTube URL');
      }

      console.log(`Starting conversion for video: ${videoId} with new API`);
      timer.mark('validated');

      // Map quality to the new API format
      const apiQuality = this.mapQualityToAPI(quality);
      
      // Use the new API endpoint format
      const response = await axios.post(
        `${this.baseUrl}/audio?id=${videoId}&quality=${apiQuality}&ext=mp3`,
        {
          id: videoId,
          quality: apiQuality,
          ext: 'mp3'
        },
        {
          headers: {
            'X-RapidAPI-Key': this.rapidApiKey,
            'X-RapidAPI-Host': this.rapidApiHost,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );
      timer.mark('api response');

      if (!response.data) {
        throw new Error('No response data from YouTube API');
      }

      console.log('New API response:', JSON.stringify(response.data, null, 2));

      // Handle the new API response format
      const jobData = this.parseNewAPIResponse(response.data, videoId, quality);

      console.log(`Conversion job started for video: ${videoId}`);

      timer.end('parsed job');
      return jobData;

    } catch (error) {
      console.error('YouTube conversion start error:', error);
      try { createTimer('youtube.startConversion').end('error', { message: error.message }); } catch (_) {}

      // Handle specific RapidAPI errors
      if (error.response) {
        const status = error.response.status;
        const message = error.response.data?.message || error.message;

        if (status === 429) {
          throw new Error('Rate limit exceeded. Please try again later.');
        } else if (status === 403) {
          throw new Error('API access forbidden. Check your RapidAPI key.');
        } else if (status === 404) {
          throw new Error('Video not found or unavailable.');
        } else if (status >= 500) {
          throw new Error('YouTube service temporarily unavailable.');
        }

        throw new Error(`YouTube API error (${status}): ${message}`);
      }

      if (error.code === 'ECONNABORTED') {
        throw new Error('Request timeout. The video might be too long to process.');
      }

      throw error;
    }
  }

  /**
   * Download audio from YouTube video (legacy method - now uses async workflow)
   * @param {string} youtubeUrl - YouTube video URL
   * @param {string} quality - Audio quality (low, medium, high)
   * @returns {Object} - Download information
   */
  async downloadAudio(youtubeUrl, quality = 'medium') {
    try {
      if (!this.rapidApiKey) {
        throw new Error('RapidAPI key not configured');
      }

      const videoId = this.extractVideoId(youtubeUrl);
      if (!videoId) {
        throw new Error('Invalid YouTube URL');
      }

      console.log(`Requesting audio download for video: ${videoId}`);

      // Use the correct API endpoint with POST method and URL-encoded parameters
      const encodedUrl = encodeURIComponent(youtubeUrl);
      const response = await axios.post(
        `${this.baseUrl}/download?url=${encodedUrl}&format=mp3`,
        {}, // Empty body as required by the API
        {
          headers: {
            'X-RapidAPI-Key': this.rapidApiKey,
            'X-RapidAPI-Host': this.rapidApiHost,
            'Content-Type': 'application/json',
            'User-Agent': 'GrooveScope/1.0'
          },
          timeout: 30000 // 30 second timeout
        }
      );

      if (!response.data) {
        throw new Error('No response data from YouTube API');
      }

      // Check if the response contains error
      if (response.data.error) {
        throw new Error(`YouTube API error: ${response.data.error}`);
      }

      // Extract download information
      const downloadData = this.parseDownloadResponse(response.data);
      
      if (!downloadData.downloadUrl) {
        throw new Error('No download URL received from YouTube API');
      }

      // Handle async conversion - wait for the file to be ready
      let finalDownloadUrl = downloadData.downloadUrl;
      
      if (downloadData.status === 'CONVERTING') {
        console.log(`Video is converting, waiting for completion...`);
        finalDownloadUrl = await this.waitForConversion(downloadData.downloadUrl, downloadData.id);
      }

      console.log(`Successfully obtained download URL for video: ${videoId}`);

      return {
        videoId,
        downloadUrl: finalDownloadUrl,
        title: downloadData.title,
        duration: downloadData.duration,
        quality: quality,
        fileSize: downloadData.fileSize,
        conversionId: downloadData.id
      };

    } catch (error) {
      console.error('YouTube download error:', error);

      // Handle specific RapidAPI errors
      if (error.response) {
        const status = error.response.status;
        const message = error.response.data?.message || error.message;

        if (status === 429) {
          throw new Error('Rate limit exceeded. Please try again later.');
        } else if (status === 403) {
          throw new Error('API access forbidden. Check your RapidAPI key.');
        } else if (status === 404) {
          throw new Error('Video not found or unavailable.');
        } else if (status >= 500) {
          throw new Error('YouTube service temporarily unavailable.');
        }

        throw new Error(`YouTube API error (${status}): ${message}`);
      }

      if (error.code === 'ECONNABORTED') {
        throw new Error('Request timeout. The video might be too long to process.');
      }

      throw error;
    }
  }

  /**
   * Map quality string to new API parameter format
   * @param {string} quality - Quality level
   * @returns {string} - API quality parameter
   */
  mapQualityToAPI(quality) {
    const qualityMap = {
      'low': '128kbps',
      'medium': '192kbps', 
      'high': '320kbps'
    };
    return qualityMap[quality] || '192kbps';
  }

  /**
   * Map quality string to legacy API parameter (kept for compatibility)
   * @param {string} quality - Quality level
   * @returns {string} - API quality parameter
   */
  mapQuality(quality) {
    const qualityMap = {
      'low': '128',
      'medium': '192',
      'high': '320'
    };
    return qualityMap[quality] || '192';
  }

  /**
   * Parse response from new YouTube CDN Progress API
   * @param {Object} responseData - API response data
   * @param {string} videoId - Video ID
   * @param {string} quality - Quality level
   * @returns {Object} - Parsed job information
   */
  parseNewAPIResponse(responseData, videoId, quality) {
    try {
      // Handle the actual API response format from YouTube CDN Progress
      console.log('Parsing new API response:', JSON.stringify(responseData, null, 2));
      
      if (responseData.error) {
        throw new Error(responseData.error);
      }
      
      // Extract token from the download progress link
      const progressLink = responseData.linkDownloadProgress;
      const tokenMatch = progressLink ? progressLink.match(/token=([^&]+)/) : null;
      const token = tokenMatch ? tokenMatch[1] : videoId + '_' + Date.now();
      
      return {
        id: token,
        videoId: responseData.videoId || videoId,
        token: token,
        title: responseData.title || 'Unknown Title',
        duration: parseFloat(responseData.lengthSeconds) || null,
        quality: quality,
        format: 'mp3',
        status: 'ready', // This API provides immediate links
        // URLs provided by the API
        downloadUrl: responseData.linkDownload,
        streamUrl: responseData.linkStream,
        sseUrl: responseData.linkDownloadProgress,
        // Metadata
        metadata: {
          author: responseData.author,
          viewCount: responseData.viewCount,
          keywords: responseData.keywords,
          description: responseData.shortDescription,
          thumbnail: responseData.thumbnail?.thumbnails?.[0]?.url,
          channelId: responseData.channelId,
          isPrivate: responseData.isPrivate,
          duration: responseData.lengthSeconds
        },
        startedAt: new Date().toISOString()
      };

    } catch (error) {
      console.error('Error parsing new API response:', error);
      throw new Error('Failed to parse API response: ' + error.message);
    }
  }

  /**
   * Parse download response from legacy API (kept for compatibility)
   * @param {Object} responseData - API response data
   * @returns {Object} - Parsed download information
   */
  parseDownloadResponse(responseData) {
    try {
      console.log('Raw API response:', JSON.stringify(responseData, null, 2));

      // Handle the actual API response format
      return {
        id: responseData.id,
        downloadUrl: responseData.downloadUrl,
        status: responseData.status,
        title: responseData.title || 'Unknown Title',
        duration: responseData.duration || null,
        fileSize: responseData.fileSize || null,
        format: responseData.format,
        quality: responseData.quality,
        startAt: responseData.startAt,
        endAt: responseData.endAt
      };

    } catch (error) {
      console.error('Error parsing download response:', error);
      throw new Error('Failed to parse download response');
    }
  }

  /**
   * Monitor conversion progress using SSE (Server-Sent Events)
   * @param {string} sseUrl - SSE endpoint URL
   * @param {Function} progressCallback - Callback for progress updates
   * @returns {Promise<string>} - Final download URL
   */
  async monitorConversionProgress(sseUrl, progressCallback = null) {
    return new Promise((resolve, reject) => {
      const EventSource = require('eventsource');
      let timeoutId;
      
      console.log(`Starting SSE monitoring: ${sseUrl}`);
      
      const eventSource = new EventSource(sseUrl);
      
      // Set timeout for the entire process
      timeoutId = setTimeout(() => {
        eventSource.close();
        reject(new Error('Conversion timeout: Process took too long'));
      }, 300000); // 5 minute timeout
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('SSE Progress:', data);
          
          // Call progress callback if provided
          if (progressCallback) {
            progressCallback(data);
          }
          
          // Check if conversion is complete
          if (data.status === 'completed' && data.downloadUrl) {
            clearTimeout(timeoutId);
            eventSource.close();
            resolve(data.downloadUrl);
          } else if (data.status === 'error' || data.status === 'failed') {
            clearTimeout(timeoutId);
            eventSource.close();
            reject(new Error(data.message || 'Conversion failed'));
          }
          
        } catch (error) {
          console.error('Error parsing SSE data:', error);
        }
      };
      
      eventSource.onerror = (error) => {
        console.error('SSE Error:', error);
        clearTimeout(timeoutId);
        eventSource.close();
        reject(new Error('SSE connection failed'));
      };
    });
  }

  /**
   * Wait for video conversion to complete (legacy method)
   * @param {string} downloadUrl - The download URL to check
   * @param {string} conversionId - The conversion job ID
   * @returns {string} - Final download URL
   */
  async waitForConversion(downloadUrl, conversionId, maxAttempts = 30) {
    const timer = createTimer('youtube.waitForConversion', { enabled: process.env.PERF_LOGS === '1' });
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`Checking conversion status... Attempt ${attempt}/${maxAttempts}`);
        
        // Check if the file is ready by making a HEAD request
        const response = await axios.head(downloadUrl, { timeout: 10000 });
        
        if (response.status === 200) {
          console.log('✅ Conversion completed, file is ready!');
          timer.end(`ready at attempt ${attempt}`);
          return downloadUrl;
        }
        
      } catch (error) {
        // File not ready yet, wait and try again
        if (attempt < maxAttempts) {
          const waitTime = Math.min(5000, 1000 * attempt); // Progressive wait: 1s, 2s, 3s... up to 5s
          console.log(`File not ready, waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          timer.mark(`retry ${attempt}`);
        }
      }
    }
    
    timer.end('timeout');
    throw new Error('Conversion timeout: Video took too long to process');
  }

  /**
   * Validate YouTube URL
   * @param {string} url - URL to validate
   * @returns {boolean} - Whether URL is valid
   */
  isValidYouTubeUrl(url) {
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|v\/)|youtu\.be\/)[\w-]{11}(&.*)?$/;
    return youtubeRegex.test(url);
  }

  /**
   * Get video information without downloading
   * @param {string} youtubeUrl - YouTube video URL
   * @returns {Object} - Video information
   */
  async getVideoInfo(youtubeUrl) {
    try {
      const videoId = this.extractVideoId(youtubeUrl);
      if (!videoId) {
        throw new Error('Invalid YouTube URL');
      }

      // Note: This would require a different endpoint for just getting info
      // For now, we'll use the same endpoint but only extract metadata
      const response = await axios.get(`${this.baseUrl}/dl`, {
        params: {
          id: videoId,
          q: '128' // Use lowest quality for info request
        },
        headers: {
          'X-RapidAPI-Key': this.rapidApiKey,
          'X-RapidAPI-Host': this.rapidApiHost
        },
        timeout: 15000
      });

      const data = this.parseDownloadResponse(response.data);
      
      return {
        videoId,
        title: data.title,
        duration: data.duration,
        available: Boolean(data.downloadUrl)
      };

    } catch (error) {
      console.error('Video info error:', error);
      throw error;
    }
  }
}

module.exports = new YouTubeService();
